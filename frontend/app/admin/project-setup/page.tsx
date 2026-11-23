'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  createProjectSetupProject,
  fetchProjectSetupProjects,
  fetchProjectSetupStatus,
  importProjectSetupDataset,
  ProjectSetupProject,
  ProjectSetupStatus,
  User,
} from '../../../lib/api';

type DatasetKind = 'layers' | 'surfaces' | 'cost-boq';
type RowData = Record<string, unknown>;

type ParsedImport = {
  fileName: string;
  rows: RowData[];
  preview: RowData[];
  errors: string[];
};

const LAYER_HEADERS = [
  'layer_id',
  'flat_id',
  'layer_name',
  'block',
  'application',
  'flat',
  'order',
  'billable',
];

// Order stays available in the template, but it is optional.
// If blank or omitted, the backend stores order = 999.
const LAYER_REQUIRED_HEADERS = [
  'layer_id',
  'flat_id',
  'layer_name',
  'block',
  'application',
  'flat',
  'billable',
];

// Dimensions import follows indr.surface_number's 17 user-supplied columns.
// The six core fields are required; all eleven measurements are optional.
// Nothing is calculated or derived by ZOS; project_id is injected by ZOS.
const SURFACE_HEADERS = [
  'block',
  'application',
  'base',
  'wall',
  'surface_type',
  'total_area_sft',
  'length_positive',
  'width_positive',
  'height_positive',
  'positive_area',
  'length_negative',
  'width_negative',
  'height_negative',
  'negative_area',
  'length_2_negative',
  'width_2_negative',
  'height_2_negative',
];

// Only the core Surface Number fields are mandatory. The detailed dimension
// columns remain available in the template/import but may be blank or omitted.
const SURFACE_REQUIRED_HEADERS = [
  'block',
  'application',
  'base',
  'wall',
  'surface_type',
  'total_area_sft',
];

const SURFACE_TEMPLATE_HEADERS = [
  'block',
  'application',
  'base',
  'wall',
  'surface_type',
  'total_area_sft',
  'length(+ve)',
  'width(+ve)',
  'height(+ve)',
  'positive_area',
  'length(-ve)',
  'width(-ve)',
  'height(-ve)',
  'negative_area',
  'length_2(-ve)',
  'width_2(-ve)',
  'height_2(-ve)',
];

const SURFACE_HEADER_LABELS: Record<string, string> = {
  block: 'block',
  application: 'application',
  base: 'base',
  wall: 'wall',
  surface_type: 'surface_type',
  total_area_sft: 'total_area_sft',
  length_positive: 'length(+ve)',
  width_positive: 'width(+ve)',
  height_positive: 'height(+ve)',
  positive_area: 'positive_area',
  length_negative: 'length(-ve)',
  width_negative: 'width(-ve)',
  height_negative: 'height(-ve)',
  negative_area: 'negative_area',
  length_2_negative: 'length_2(-ve)',
  width_2_negative: 'width_2(-ve)',
  height_2_negative: 'height_2(-ve)',
};

const COST_BOQ_HEADERS = [
  'application',
  'layer',
  'productivity',
  'per_labour_cost',
  'material_name',
  'material_coverage',
  'material_rate_per_unit',
  'client_rate',
];

const COST_BOQ_REQUIRED_HEADERS = [
  'application',
  'layer',
];

const COST_BOQ_TEMPLATE_HEADERS = [
  'Application',
  'Layer',
  'Productivity',
  'Per Labour Cost',
  'Material Name',
  'Material Coverage',
  'Material Rate per Unit',
  'Client Rate',
];

const COST_BOQ_HEADER_LABELS: Record<string, string> = {
  application: 'Application',
  layer: 'Layer',
  productivity: 'Productivity',
  per_labour_cost: 'Per Labour Cost',
  material_name: 'Material Name',
  material_coverage: 'Material Coverage',
  material_rate_per_unit: 'Material Rate per Unit',
  client_rate: 'Client Rate',
};

function toProjectSetupDisplayMessage(message: string) {
  return message
    .replace(/Surface Number/g, 'Dimensions')
    .replace(/Cost \/ BOQ/g, 'Cost / Work Order')
    .replace(/\bBOQ\b/g, 'Work Order');
}

function getHeaders(kind: DatasetKind) {
  if (kind === 'layers') return LAYER_HEADERS;
  if (kind === 'surfaces') return SURFACE_HEADERS;
  return COST_BOQ_HEADERS;
}

function getHeaderLabel(kind: DatasetKind, header: string) {
  if (kind === 'surfaces') {
    return SURFACE_HEADER_LABELS[header] ?? header;
  }

  if (kind === 'cost-boq') {
    return COST_BOQ_HEADER_LABELS[header] ?? header;
  }

  return header;
}

function cleanHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeSurfaceHeader(value: unknown) {
  const raw = String(value ?? '').trim().toLowerCase();

  const exactAliases: Record<string, string> = {
    'length(+ve)': 'length_positive',
    'width(+ve)': 'width_positive',
    'height(+ve)': 'height_positive',
    'length(-ve)': 'length_negative',
    'width(-ve)': 'width_negative',
    'height(-ve)': 'height_negative',
    'length_2(-ve)': 'length_2_negative',
    'width_2(-ve)': 'width_2_negative',
    'height_2(-ve)': 'height_2_negative',
  };

  return exactAliases[raw] ?? cleanHeader(raw);
}

function normalizeRow(kind: DatasetKind, row: RowData) {
  const normalized: RowData = {};

  Object.entries(row).forEach(([key, value]) => {
    const normalizedKey =
      kind === 'surfaces' ? normalizeSurfaceHeader(key) : cleanHeader(key);
    normalized[normalizedKey] = value;
  });

  if (kind === 'surfaces') {
    // All 17 Dimensions columns are user inputs. Strip database-managed fields only.
    delete normalized.surface_id;
    delete normalized.row_id;
    delete normalized.created_at;
    delete normalized.updated_at;
  }

  if (kind === 'cost-boq') {
    // The user's current costing sheet labels Client Rate as simply "Rate".
    // Accept that existing sheet without making the calculated columns part of
    // the import contract.
    if (
      (normalized.client_rate === null ||
        normalized.client_rate === undefined ||
        String(normalized.client_rate).trim() === '') &&
      normalized.rate !== null &&
      normalized.rate !== undefined
    ) {
      normalized.client_rate = normalized.rate;
    }

    if (
      (normalized.layer === null ||
        normalized.layer === undefined ||
        String(normalized.layer).trim() === '') &&
      normalized.layer_name !== null &&
      normalized.layer_name !== undefined
    ) {
      normalized.layer = normalized.layer_name;
    }

    // Block is intentionally NOT part of the Cost/BOQ import contract.
    // ZOS derives it from indr.flat_area_summary for every generated flat row.
    delete normalized.block;
  }

  // project_id is always injected by the backend from the selected project.
  delete normalized.project_id;

  return normalized;
}

function validateRows(kind: DatasetKind, rows: RowData[]) {
  const errors: string[] = [];
  const requiredHeaders =
    kind === 'cost-boq'
      ? COST_BOQ_REQUIRED_HEADERS
      : kind === 'surfaces'
        ? SURFACE_REQUIRED_HEADERS
        : kind === 'layers'
          ? LAYER_REQUIRED_HEADERS
          : getHeaders(kind);
  const requiredValues =
    kind === 'cost-boq'
      ? [
          'application',
          'layer',
        ]
      : requiredHeaders;

  if (!rows.length) return ['No data rows were found in the first worksheet.'];

  const available = new Set(Object.keys(rows[0] || {}));
  const missingHeaders = requiredHeaders.filter((header) => !available.has(header));
  if (missingHeaders.length) {
    errors.push(
      `Missing columns: ${missingHeaders
        .map((header) => getHeaderLabel(kind, header))
        .join(', ')}`,
    );
    return errors;
  }

  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const missing = requiredValues.filter((header) => {
      const value = row[header];
      return value === null || value === undefined || String(value).trim() === '';
    });

    if (missing.length && errors.length < 20) {
      errors.push(
        `Row ${rowNumber}: missing ${missing
          .map((header) => getHeaderLabel(kind, header))
          .join(', ')}`,
      );
    }

    if (kind === 'layers') {
      const orderRaw = String(row.order ?? '').trim();
      if (orderRaw) {
        const order = Number(row.order);
        if (!Number.isFinite(order) && errors.length < 20) {
          errors.push(`Row ${rowNumber}: order must be numeric when provided`);
        }
      }

      const billable = String(row.billable ?? '').trim().toLowerCase();
      if (
        !['true', 'false', 'yes', 'no', 'y', 'n', '1', '0'].includes(billable) &&
        typeof row.billable !== 'boolean' &&
        errors.length < 20
      ) {
        errors.push(`Row ${rowNumber}: billable must be TRUE/FALSE, YES/NO or 1/0`);
      }

      // Keep this case-sensitive to match the PostgreSQL text primary key.
      const key = String(row.layer_id ?? '').trim();
      if (key && seen.has(key) && errors.length < 20) {
        errors.push(`Row ${rowNumber}: duplicate layer_id ${row.layer_id}`);
      }
      if (key) seen.add(key);

      return;
    }

    if (kind === 'surfaces') {
      const surfaceType = String(row.surface_type ?? '').trim().toLowerCase();
      if (
        surfaceType &&
        !['ceiling', 'wall'].includes(surfaceType) &&
        errors.length < 20
      ) {
        errors.push(`Row ${rowNumber}: surface_type must be ceiling or wall`);
      }

      const totalArea = Number(row.total_area_sft);
      if ((!Number.isFinite(totalArea) || totalArea < 0) && errors.length < 20) {
        errors.push(
          `Row ${rowNumber}: total_area_sft must be a non-negative number`,
        );
      }

      const optionalNumericColumns = [
        'length_positive',
        'width_positive',
        'height_positive',
        'positive_area',
        'length_negative',
        'width_negative',
        'height_negative',
        'negative_area',
        'length_2_negative',
        'width_2_negative',
        'height_2_negative',
      ];

      optionalNumericColumns.forEach((column) => {
        const rawValue = row[column];
        if (
          rawValue === null ||
          rawValue === undefined ||
          String(rawValue).trim() === ''
        ) {
          return;
        }

        const value = Number(rawValue);
        if ((!Number.isFinite(value) || value < 0) && errors.length < 20) {
          errors.push(
            `Row ${rowNumber}: ${getHeaderLabel(kind, column)} must be a non-negative number when provided`,
          );
        }
      });

      const key = [row.application, row.base, row.wall]
        .map((value) => String(value ?? '').trim().toUpperCase())
        .join('|');
      if (key && seen.has(key) && errors.length < 20) {
        errors.push(
          `Row ${rowNumber}: duplicate application + base + wall combination`,
        );
      }
      if (key) seen.add(key);

      return;
    }

    const productivityRaw = String(row.productivity ?? '').trim();
    if (productivityRaw) {
      const productivity = Number(row.productivity);
      if ((!Number.isFinite(productivity) || productivity <= 0) && errors.length < 20) {
        errors.push(
          `Row ${rowNumber}: Productivity must be greater than 0 when provided`,
        );
      }
    }

    const perLabourCostRaw = String(row.per_labour_cost ?? '').trim();
    if (perLabourCostRaw) {
      const perLabourCost = Number(row.per_labour_cost);
      if ((!Number.isFinite(perLabourCost) || perLabourCost < 0) && errors.length < 20) {
        errors.push(
          `Row ${rowNumber}: Per Labour Cost must be a non-negative number when provided`,
        );
      }
    }

    const clientRateRaw = String(row.client_rate ?? '').trim();
    if (clientRateRaw) {
      const clientRate = Number(row.client_rate);
      if ((!Number.isFinite(clientRate) || clientRate < 0) && errors.length < 20) {
        errors.push(`Row ${rowNumber}: Client Rate must be a non-negative number when provided`);
      }
    }

    const materialName = String(row.material_name ?? '').trim();
    const materialCoverageRaw = String(row.material_coverage ?? '').trim();
    const materialRateRaw = String(row.material_rate_per_unit ?? '').trim();

    if (materialName) {
      const materialCoverage = Number(row.material_coverage);
      const materialRate = Number(row.material_rate_per_unit);

      if (
        (!materialCoverageRaw ||
          !Number.isFinite(materialCoverage) ||
          materialCoverage <= 0) &&
        errors.length < 20
      ) {
        errors.push(
          `Row ${rowNumber}: Material Coverage must be greater than 0 when Material Name is provided`,
        );
      }

      if (
        (!materialRateRaw || !Number.isFinite(materialRate) || materialRate < 0) &&
        errors.length < 20
      ) {
        errors.push(
          `Row ${rowNumber}: Material Rate per Unit must be a non-negative number when Material Name is provided`,
        );
      }
    } else if ((materialCoverageRaw || materialRateRaw) && errors.length < 20) {
      errors.push(
        `Row ${rowNumber}: Material Name is required when material coverage or rate is provided`,
      );
    }

    // material_master permits one Active row per Application + Layer.
    const key = [row.application, row.layer]
      .map((value) => String(value ?? '').trim().toUpperCase())
      .join('|');

    if (key && seen.has(key) && errors.length < 20) {
      errors.push(`Row ${rowNumber}: duplicate Application + Layer combination`);
    }
    if (key) seen.add(key);
  });

  return errors;
}

function downloadTemplate(kind: DatasetKind) {
  let worksheet: XLSX.WorkSheet;
  let sheetName: string;
  let fileName: string;

  if (kind === 'layers') {
    worksheet = XLSX.utils.json_to_sheet(
      [
        {
          layer_id: 'JF-0001-01',
          flat_id: 'FJ-0001',
          layer_name: '1st Coat Primer',
          block: 'Block-J',
          application: 'Flat-J',
          flat: '1',
          order: 1,
          billable: true,
        },
      ],
      { header: LAYER_HEADERS },
    );
    sheetName = 'Layers';
    fileName = 'ZOS_Layer_Import_Template.xlsx';
  } else if (kind === 'surfaces') {
    worksheet = XLSX.utils.aoa_to_sheet([SURFACE_TEMPLATE_HEADERS]);
    sheetName = 'Dimensions';
    fileName = 'ZOS_Dimensions_Import_Template.xlsx';
  } else {
    worksheet = XLSX.utils.aoa_to_sheet([
      COST_BOQ_TEMPLATE_HEADERS,
      [
        'FLAT-J',
        '1st Coat Primer',
        7432,
        800,
        'Dulux Promise SmartChoice Interior Primer',
        180,
        79.7,
        2,
      ],
      [
        'FLAT-J',
        'Basic Sanding',
        1239,
        800,
        '',
        '',
        '',
        0,
      ],
    ]);
    sheetName = 'Cost Work Order';
    fileName = 'ZOS_Cost_Work_Order_Import_Template.xlsx';
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, fileName);
}

function ImportCard({
  title,
  description,
  kind,
  currentCount,
  projectId,
  token,
  onImported,
}: {
  title: string;
  description: string;
  kind: DatasetKind;
  currentCount: number;
  projectId: string;
  token: string;
  onImported: () => Promise<void>;
}) {
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const headers = getHeaders(kind);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setReading(true);
    setError('');
    setMessage('');

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error('The workbook has no worksheets');

      const rawRows = XLSX.utils.sheet_to_json<RowData>(workbook.Sheets[sheetName], {
        defval: '',
        raw: true,
      });
      const rows = rawRows.map((row) => normalizeRow(kind, row)).filter((row) =>
        Object.values(row).some((value) => String(value ?? '').trim() !== ''),
      );
      const errors = validateRows(kind, rows);

      setParsed({
        fileName: file.name,
        rows,
        preview: rows.slice(0, 8),
        errors,
      });
    } catch (err) {
      setParsed(null);
      setError(err instanceof Error ? err.message : 'Failed to read spreadsheet');
    } finally {
      setReading(false);
    }
  }

  async function confirmImport() {
    if (!parsed || parsed.errors.length || !projectId || !token) return;

    const replacementText =
      kind === 'cost-boq'
        ? `Import ${parsed.rows.length.toLocaleString(
            'en-IN',
          )} Cost / Work Order rows?\n\nOnly matching Application + Layer records will be replaced. All unrelated existing Work Order, material, productivity and flat × layer costing records will remain unchanged.`
        : kind === 'surfaces'
          ? `Append ${parsed.rows.length.toLocaleString(
              'en-IN',
            )} Dimensions rows?\n\nExisting Dimensions rows will NOT be deleted or updated. Rows whose Application + Base + Wall already exist for this project will be skipped.`
          : kind === 'layers'
            ? `Append ${parsed.rows.length.toLocaleString(
                'en-IN',
              )} Layer rows?\n\nExisting Layer rows will NOT be deleted or updated. Rows whose layer_id or Application + Flat + Layer already exist will be skipped.`
            : currentCount
              ? `This will replace ${currentCount.toLocaleString('en-IN')} existing ${title.toLowerCase()} rows for this project. Continue?`
              : `Import ${parsed.rows.length.toLocaleString('en-IN')} rows for this project?`;

    if (!window.confirm(replacementText)) return;

    setImporting(true);
    setError('');
    setMessage('');
    try {
      const result = await importProjectSetupDataset(
        token,
        projectId,
        kind,
        parsed.rows,
      );
      if (kind === 'cost-boq') {
        setMessage(
          `${result.importedRows.toLocaleString('en-IN')} Cost / Work Order template rows processed. ` +
            `${(result.boqRows ?? 0).toLocaleString('en-IN')} Work Order rows written, ` +
            `${(result.materialRows ?? 0).toLocaleString('en-IN')} active material rows written, ` +
            `${(result.productivityRows ?? 0).toLocaleString('en-IN')} productivity rows written, and ` +
            `${(result.generatedRows ?? 0).toLocaleString('en-IN')} flat × layer costing rows generated.`,
        );
      } else {
        setMessage(`${result.importedRows.toLocaleString('en-IN')} rows imported successfully.`);
      }
      setParsed(null);
      await onImported();
    } catch (err) {
      setError(
        err instanceof Error
          ? toProjectSetupDisplayMessage(err.message)
          : 'Import failed',
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 p-5">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-semibold">{title}</h2>
            <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-400">
              {currentCount.toLocaleString('en-IN')} current rows
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">{description}</p>
          <p className="mt-1 text-xs text-cyan-300">
            project_id is injected by ZOS from the selected project and is not taken from the spreadsheet.
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadTemplate(kind)}
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-cyan-400 hover:text-cyan-300"
        >
          Download Template
        </button>
      </div>

      <div className="p-5">
        <label className="inline-flex cursor-pointer items-center rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
          {reading ? 'Reading...' : 'Choose Excel / CSV'}
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            disabled={reading || importing}
            onChange={handleFile}
          />
        </label>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {message && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            {message}
          </div>
        )}

        {parsed && (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">File</p>
                <p className="mt-1 truncate text-sm text-slate-200">{parsed.fileName}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Rows</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {parsed.rows.length.toLocaleString('en-IN')}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Validation</p>
                <p className={`mt-1 text-sm font-semibold ${parsed.errors.length ? 'text-red-300' : 'text-emerald-300'}`}>
                  {parsed.errors.length ? `${parsed.errors.length} issue(s)` : 'Ready to import'}
                </p>
              </div>
            </div>

            {parsed.errors.length > 0 && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                <p className="text-sm font-semibold text-red-200">Fix these issues before importing</p>
                <ul className="mt-2 space-y-1 text-xs text-red-300">
                  {parsed.errors.slice(0, 20).map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-950 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    {headers.map((header) => (
                      <th key={header} className="whitespace-nowrap px-3 py-2.5">
                        {getHeaderLabel(kind, header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.preview.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-slate-800">
                      {headers.map((header) => (
                        <td key={header} className="whitespace-nowrap px-3 py-2.5 text-slate-300">
                          {String(row[header] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-amber-300">
                {kind === 'cost-boq'
                  ? 'Import mode: Update matching Application + Layer records only. Unrelated existing Work Order, material, productivity and flat × layer costing records are preserved.'
                  : kind === 'surfaces'
                    ? 'Import mode: Append only. Existing Dimensions rows are preserved; matching Application + Base + Wall rows are skipped.'
                    : kind === 'layers'
                      ? 'Import mode: Append only. Existing Layer rows are preserved; matching layer_id or Application + Flat + Layer rows are skipped.'
                      : `Import mode: Replace all existing ${title.toLowerCase()} rows for the selected project in one database transaction.`}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setParsed(null)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmImport}
                  disabled={Boolean(parsed.errors.length) || importing}
                  className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {importing
                    ? 'Importing...'
                    : kind === 'cost-boq'
                      ? 'Update & Import'
                      : kind === 'surfaces' || kind === 'layers'
                        ? 'Append & Import'
                        : currentCount
                          ? 'Replace & Import'
                          : 'Import Data'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function AdminProjectSetupPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [projects, setProjects] = useState<ProjectSetupProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [status, setStatus] = useState<ProjectSetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [creating, setCreating] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const savedToken = localStorage.getItem('zos_access_token');
      const savedUser = localStorage.getItem('zos_user');
      if (!savedToken || !savedUser) {
        router.replace('/');
        return;
      }

      let parsedUser: User;
      try {
        parsedUser = JSON.parse(savedUser) as User;
      } catch {
        router.replace('/');
        return;
      }

      if (String(parsedUser.role || '').trim().toLowerCase() !== 'admin') {
        router.replace('/dashboard');
        return;
      }

      setToken(savedToken);
      try {
        const rows = await fetchProjectSetupProjects(savedToken);
        if (cancelled) return;
        setProjects(rows);
        if (rows.length) setSelectedProjectId(rows[0].projectId);
      } catch (err) {
        if (!cancelled) {
          setError(
          err instanceof Error
            ? toProjectSetupDisplayMessage(err.message)
            : 'Failed to load Project Setup',
        );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    initialize();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!token || !selectedProjectId) {
      setStatus(null);
      return;
    }

    let cancelled = false;
    fetchProjectSetupStatus(token, selectedProjectId)
      .then((row) => {
        if (!cancelled) setStatus(row);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? toProjectSetupDisplayMessage(err.message)
              : 'Failed to load project status',
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, token]);

  async function refreshStatus() {
    if (!token || !selectedProjectId) return;
    setStatus(await fetchProjectSetupStatus(token, selectedProjectId));
  }

  async function createProject() {
    if (!token) return;
    const projectName = newProjectName.trim();
    const projectId = newProjectId.trim().toLowerCase();
    if (!projectName || !projectId) {
      setError('Project name and project ID are required.');
      return;
    }

    setCreating(true);
    setError('');
    try {
      const created = await createProjectSetupProject(token, {
        projectName,
        projectId,
      });
      const rows = await fetchProjectSetupProjects(token);
      setProjects(rows);
      setSelectedProjectId(created.projectId);
      setNewProjectName('');
      setNewProjectId('');
      setShowCreate(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? toProjectSetupDisplayMessage(err.message)
          : 'Failed to create project',
      );
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        Loading Project Setup...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-300">Administration</p>
            <h1 className="mt-1 font-display text-3xl font-bold">Project Setup</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Onboard Layer, Dimensions and Cost / Work Order master data into the existing ZOS project data model. Cost / Work Order import also generates the project-scoped ideal Flat × Layer costing plan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/admin/users')}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-cyan-500/50 hover:bg-slate-900 hover:text-cyan-300"
            >
              User Management
            </button>
            <button
              type="button"
              className="rounded-lg border border-cyan-500/50 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-300"
              aria-current="page"
            >
              Project Setup
            </button>
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-900"
            >
              Back to Dashboard
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="mb-5 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[280px] flex-1">
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Project</label>
              <select
                value={selectedProjectId}
                onChange={(event) => {
                  setSelectedProjectId(event.target.value);
                  setError('');
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-cyan-400"
              >
                {projects.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.projectName} ({project.projectId})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
              className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-300 hover:bg-cyan-500/15"
            >
              + Create New Project
            </button>
          </div>

          {showCreate && (
            <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4 md:grid-cols-[1fr_1fr_auto]">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Project Name</label>
                <input
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  placeholder="Adarsh Park Heights"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Project ID</label>
                <input
                  value={newProjectId}
                  onChange={(event) =>
                    setNewProjectId(
                      event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, '_')
                        .replace(/_+/g, '_')
                        .replace(/^_+/, ''),
                    )
                  }
                  placeholder="park_heights"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-400"
                />
              </div>
              <button
                type="button"
                onClick={createProject}
                disabled={creating}
                className="self-end rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          )}

          {selectedProject && (
            <div className="mt-4 flex flex-wrap gap-3 text-xs">
              <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-slate-300">
                Selected: <strong className="text-white">{selectedProject.projectName}</strong>
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-slate-300">
                project_id: <strong className="font-mono text-cyan-300">{selectedProject.projectId}</strong>
              </span>
            </div>
          )}
        </section>

        {!selectedProjectId ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-500">
            Create or select a project to start importing data.
          </div>
        ) : (
          <div className="space-y-5">
            <ImportCard
              title="Layer Data"
              description="Imports layer_id, flat_id, layer_name, block, application, flat and billable into indr.layer. order is optional; blank or omitted order defaults to 999. Layer import is append-only: existing rows are preserved and matching layer_id or Application + Flat + Layer rows are skipped. New layers start with wkdpct = 0."
              kind="layers"
              currentCount={status?.layerCount ?? 0}
              projectId={selectedProjectId}
              token={token}
              onImported={refreshStatus}
            />

            <ImportCard
              title="Dimensions Data"
              description="Imports Dimensions data. Required: block, application, base, wall, surface_type and total_area_sft. Optional: length(+ve), width(+ve), height(+ve), positive_area, length(-ve), width(-ve), height(-ve), negative_area, length_2(-ve), width_2(-ve) and height_2(-ve). ZOS only adds project_id automatically."
              kind="surfaces"
              currentCount={status?.surfaceCount ?? 0}
              projectId={selectedProjectId}
              token={token}
              onImported={refreshStatus}
            />

            <ImportCard
              title="Cost / Work Order Data"
              description="Imports Application and Layer, with optional Productivity (one labour's 8-hour daily productivity), Per Labour Cost, Material Name, Material Coverage, Material Rate per Unit and Client Rate. Block is not imported; ZOS derives Block and flat area from Flat Area Summary. Matching Application + Layer records are updated in Work Order, Material Master and Productivity Master while unrelated existing records are preserved. Productivity Master receives Machine, Manual and Both rows only when Productivity is provided. Flat × Layer costing is regenerated only for the imported Application + Layer combinations."
              kind="cost-boq"
              currentCount={status?.boqCount ?? 0}
              projectId={selectedProjectId}
              token={token}
              onImported={refreshStatus}
            />

            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
                <div className="rounded-xl bg-slate-950 p-3">
                  <p className="text-slate-500">Flat Area Summary</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {(status?.flatAreaCount ?? 0).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-950 p-3">
                  <p className="text-slate-500">Work Order Rows</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {(status?.boqCount ?? 0).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-950 p-3">
                  <p className="text-slate-500">Active Materials</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {(status?.materialCount ?? 0).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-950 p-3">
                  <p className="text-slate-500">Productivity Rows</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {(status?.productivityCount ?? 0).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-950 p-3">
                  <p className="text-slate-500">Flat × Layer Costing</p>
                  <p className="mt-1 text-lg font-semibold text-cyan-300">
                    {(status?.costingCount ?? 0).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}