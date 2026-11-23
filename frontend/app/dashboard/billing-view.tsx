

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BillingBatchViewColumn,
  BillingBatchViewResponse,
  BillingFloorLayerReport,
  BillingFloorLayerRow,
  BillingFloorLayerSummary,
  BillingInvoiceRow,
  BillingRow,
  BillingViewId,
  fetchBillingBatchView,
  fetchBillingFloorLayerList,
  fetchBillingFloorLayerReport,
  fetchBillingInvoice,
  fetchBillingRows,
} from '../../lib/api';
import { getBillingViewTitle } from './view-titles';

export type { BillingViewId };

type BillingDataset = {
  overall: BillingRow[];
  pending: BillingRow[];
  sent: BillingRow[];
  billed: BillingRow[];
  latest: BillingRow[];
};

type ExportCell = string | number | boolean | null | undefined;
type ExportRow = Record<string, ExportCell>;

const EMPTY_DATASET: BillingDataset = {
  overall: [],
  pending: [],
  sent: [],
  billed: [],
  latest: [],
};

export { getBillingViewTitle };

export function BillingView({
  view,
  searchQuery,
  token,
  projectId,
  enabled,
}: {
  view: BillingViewId;
  searchQuery: string;
  token: string;
  projectId: string;
  enabled: boolean;
}) {
  const [data, setData] = useState<BillingDataset>(EMPTY_DATASET);
  const [invoiceRows, setInvoiceRows] = useState<BillingInvoiceRow[]>([]);
  const [batchNo, setBatchNo] = useState(5);
  const [loading, setLoading] = useState(true);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadBillingData() {
      if (!token || !projectId || !enabled) {
        setLoading(false);
        return;
      }

      if (
        view === 'billing-floor-layer' ||
        view === 'billing-batch-view'
      ) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const [overall, pending, sent, billed, latest] = await Promise.all([
          fetchBillingRows(token, projectId, 'billing-overall'),
          fetchBillingRows(token, projectId, 'billing-pending'),
          fetchBillingRows(token, projectId, 'billing-sent'),
          fetchBillingRows(token, projectId, 'billing-billed'),
          fetchBillingRows(token, projectId, 'billing-latest'),
        ]);

        setData({
          overall,
          pending,
          sent,
          billed,
          latest,
        });

        const latestBatchNo =
          latest[0]?.batchNo ||
          Math.max(1, ...billed.map((row) => Number(row.batchNo) || 0));

        setBatchNo(latestBatchNo || 5);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load billing data');
      } finally {
        setLoading(false);
      }
    }

    loadBillingData();
  }, [token, projectId, enabled, view]);

  useEffect(() => {
    async function loadInvoice() {
      if (
        view !== 'billing-invoice' ||
        !token ||
        !projectId ||
        !enabled ||
        !batchNo
      ) {
        return;
      }

      setInvoiceLoading(true);
      setError('');

      try {
        const rows = await fetchBillingInvoice(token, projectId, batchNo);
        setInvoiceRows(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load invoice');
      } finally {
        setInvoiceLoading(false);
      }
    }

    loadInvoice();
  }, [token, projectId, batchNo, enabled, view]);

  const activeRows = useMemo(() => {
    switch (view) {
      case 'billing-overall':
        return data.overall;
      case 'billing-pending':
        return data.pending;
      case 'billing-sent':
        return data.sent;
      case 'billing-billed':
        return data.billed;
      case 'billing-latest':
        return data.latest;
      case 'billing-invoice':
      case 'billing-floor-layer':
      case 'billing-batch-view':
        return [];
    }
  }, [data, view]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return activeRows;
    }

    return activeRows.filter((row) =>
      [
        row.application,
        row.flat,
        row.surfaceType,
        row.layerName,
        row.billingNumber,
        row.status,
        row.batch,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [activeRows, searchQuery]);

  if (!enabled) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-red-200">
        Billing Engine is not enabled for this project.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">
        Loading billing data...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {view === 'billing-invoice' && (
        <InvoiceBlock
          projectId={projectId}
          batchNo={batchNo}
          setBatchNo={setBatchNo}
          rows={invoiceRows}
          loading={invoiceLoading}
        />
      )}

      {view === 'billing-floor-layer' && (
        <FloorLayerBillingBlock
          token={token}
          projectId={projectId}
          searchQuery={searchQuery}
        />
      )}

      {view === 'billing-batch-view' && (
        <BillingBatchViewBlock
          token={token}
          projectId={projectId}
          searchQuery={searchQuery}
        />
      )}

      {view !== 'billing-invoice' &&
        view !== 'billing-floor-layer' &&
        view !== 'billing-batch-view' && (
          <BillingTable rows={filteredRows} view={view} projectId={projectId} />
        )}
    </div>
  );
}

const BILLING_BATCH_GROUPS = [
  {
    id: 'flat-staircase-walls',
    label: 'Flat + Staircase Walls',
    columnKeys: [
      'firstCoatPrimerCeiling',
      'firstCoatPrimerWall',
      'firstCoatPuttyCeiling',
      'firstCoatPuttyWall',
      'secondCoatPuttyCeiling',
      'secondCoatPuttyWall',
      'secondCoatPrimerCeiling',
      'secondCoatPrimerWall',
      'firstCoatPaintCeiling',
      'firstCoatPaintWall',
      'secondCoatPaintCeiling',
      'secondCoatPaintWall',
    ],
  },
  {
    id: 'balcony-utility-staircase-ceiling',
    label: 'Balcony / Utility / Staircase Ceiling',
    columnKeys: [
      'firstCoarsePuttyCeiling',
      'secondCoarsePuttyCeiling',
      'firstCoatPrimerCeiling',
      'firstCoatPuttyCeiling',
      'secondCoatPuttyCeiling',
      'secondCoatPrimerCeiling',
      'firstCoatPaintCeiling',
      'secondCoatPaintCeiling',
    ],
  },
  {
    id: 'balcony-utility-walls',
    label: 'Balcony / Utility Walls',
    columnKeys: [
      'firstCoatPrimerWall',
      'firstCoatPuttyWall',
      'secondCoatPuttyWall',
      'secondCoatPrimerWall',
      'firstCoatPaintWall',
      'secondCoatPaintWall',
    ],
  },
  {
    id: 'toilet-enamel',
    label: 'Toilet + Enamel',
    columnKeys: [
      'yellowZincPrimerWall',
      'firstCoatPaintCeiling',
      'firstCoatPaintWall',
      'secondCoatPaintCeiling',
      'secondCoatPaintWall',
    ],
  },
  {
    id: 'lobby-common-entrance-corridor',
    label: 'Lobby + Common Entrance + Corridor',
    columnKeys: [
      'firstCoatPrimerCeiling',
      'firstCoatPrimerWall',
      'firstCoatPaintCeiling',
      'firstCoatPaintWall',
      'secondCoatPaintCeiling',
      'secondCoatPaintWall',
    ],
  },
] as const;

type BillingBatchGroupId = (typeof BILLING_BATCH_GROUPS)[number]['id'];

type BillingApplicationFamily =
  | 'flat'
  | 'staircase'
  | 'balcony'
  | 'utility'
  | 'toilet'
  | 'enamel'
  | 'lobby'
  | 'common-entrance'
  | 'corridor'
  | 'other';

type ExplicitApplicationSurface = 'Ceiling' | 'Wall' | 'Combined';

function normalizeBillingApplication(application: string | null | undefined) {
  return String(application ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function getBillingApplicationFamily(
  application: string | null | undefined,
): BillingApplicationFamily {
  const normalized = normalizeBillingApplication(application);

  if (normalized.startsWith('FLAT')) return 'flat';
  if (normalized.startsWith('STAIRCASE')) return 'staircase';
  if (normalized.startsWith('BALCONY')) return 'balcony';
  if (normalized.startsWith('UTILITY')) return 'utility';
  if (normalized.startsWith('TOILET')) return 'toilet';
  if (normalized.startsWith('ENAMEL')) return 'enamel';
  if (normalized.startsWith('LOBBY')) return 'lobby';
  if (normalized.startsWith('COMMON ENTRANCE')) return 'common-entrance';
  if (normalized.startsWith('CORRIDOR')) return 'corridor';

  return 'other';
}

function getExplicitBillingApplicationSurface(
  application: string | null | undefined,
): ExplicitApplicationSurface {
  const normalized = normalizeBillingApplication(application);

  if (/\(\s*CEILING\s*\)/.test(normalized) || /\bCEILING\b/.test(normalized)) {
    return 'Ceiling';
  }

  if (/\(\s*WALLS?\s*\)/.test(normalized) || /\bWALLS?\b/.test(normalized)) {
    return 'Wall';
  }

  return 'Combined';
}

function isApplicationInBillingBatchGroup(
  groupId: BillingBatchGroupId,
  application: string | null | undefined,
) {
  const family = getBillingApplicationFamily(application);
  const explicitSurface = getExplicitBillingApplicationSurface(application);

  switch (groupId) {
    case 'flat-staircase-walls':
      return (
        family === 'flat' ||
        (family === 'staircase' && explicitSurface !== 'Ceiling')
      );

    case 'balcony-utility-staircase-ceiling':
      return (
        (family === 'balcony' ||
          family === 'utility' ||
          family === 'staircase') &&
        explicitSurface !== 'Wall'
      );

    case 'balcony-utility-walls':
      return (
        (family === 'balcony' || family === 'utility') &&
        explicitSurface !== 'Ceiling'
      );

    case 'toilet-enamel':
      return family === 'toilet' || family === 'enamel';

    case 'lobby-common-entrance-corridor':
      return (
        family === 'lobby' ||
        family === 'common-entrance' ||
        family === 'corridor'
      );
  }
}

function isBillingBatchCellNotApplicable(
  groupId: BillingBatchGroupId,
  application: string | null | undefined,
  column: BillingBatchViewColumn,
) {
  return (
    groupId === 'flat-staircase-walls' &&
    getBillingApplicationFamily(application) === 'staircase' &&
    column.surface === 'Ceiling'
  );
}

function BillingBatchViewBlock({
  token,
  projectId,
  searchQuery,
}: {
  token: string;
  projectId: string;
  searchQuery: string;
}) {
  const [data, setData] = useState<BillingBatchViewResponse | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<BillingBatchGroupId>(
    'flat-staircase-walls',
  );
  const [selectedApplications, setSelectedApplications] = useState<string[]>([]);
  const [selectedBatch, setSelectedBatch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadBatchView() {
      if (!token || !projectId) {
        return;
      }

      setLoading(true);
      setError('');

      try {
        const response = await fetchBillingBatchView(token, projectId);
        setData(response);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load Billing Batch View',
        );
      } finally {
        setLoading(false);
      }
    }

    loadBatchView();
  }, [token, projectId]);

  useEffect(() => {
    setSelectedApplications([]);
  }, [activeGroupId]);

  const activeGroup = useMemo(
    () =>
      BILLING_BATCH_GROUPS.find((group) => group.id === activeGroupId) ??
      BILLING_BATCH_GROUPS[0],
    [activeGroupId],
  );

  const activeColumns = useMemo(() => {
    const columnMap = new Map(
      (data?.columns ?? []).map((column) => [column.key, column]),
    );

    return activeGroup.columnKeys
      .map((key) => columnMap.get(key))
      .filter((column): column is BillingBatchViewColumn => Boolean(column));
  }, [activeGroup.columnKeys, data?.columns]);

  const groupRows = useMemo(
    () =>
      (data?.rows ?? []).filter((row) =>
        isApplicationInBillingBatchGroup(activeGroupId, row.application),
      ),
    [activeGroupId, data?.rows],
  );

  const availableApplications = useMemo(() => {
    const applications = new Set<string>();

    groupRows.forEach((row) => {
      const application = String(row.application ?? '').trim();
      if (application) {
        applications.add(application);
      }
    });

    return Array.from(applications).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }, [groupRows]);

  const filteredRows = useMemo(() => {
    const globalQuery = searchQuery.trim().toLowerCase();
    const selectedSet = new Set(selectedApplications);

    return groupRows.filter((row) => {
      const application = String(row.application ?? '').trim();
      const applicationLower = application.toLowerCase();
      const flatLower = String(row.flat ?? '').toLowerCase();

      if (selectedSet.size > 0 && !selectedSet.has(application)) {
        return false;
      }

      if (
        globalQuery &&
        !applicationLower.includes(globalQuery) &&
        !flatLower.includes(globalQuery)
      ) {
        return false;
      }

      return true;
    });
  }, [groupRows, searchQuery, selectedApplications]);

  const exportRows = useMemo<ExportRow[]>(() => {
    return filteredRows.map((row) => {
      const exportRow: ExportRow = {
        Flat: row.flat || '',
        Application: row.application || '',
      };

      activeColumns.forEach((column) => {
        const header = `${column.layerName} ${column.surface}`;
        const notApplicable = isBillingBatchCellNotApplicable(
          activeGroupId,
          row.application,
          column,
        );

        if (notApplicable) {
          exportRow[header] = 'N.A.';
          return;
        }

        const cell = row.cells[column.key] ?? { area: 0, batch: null };
        exportRow[header] = Number(cell.area) || 0;
      });

      return exportRow;
    });
  }, [activeColumns, activeGroupId, filteredRows]);

  const layerGroups = useMemo(() => {
    const groups: {
      layerName: string;
      columns: BillingBatchViewColumn[];
    }[] = [];

    for (const column of activeColumns) {
      const current = groups[groups.length - 1];

      if (current?.layerName === column.layerName) {
        current.columns.push(column);
      } else {
        groups.push({
          layerName: column.layerName,
          columns: [column],
        });
      }
    }

    return groups;
  }, [activeColumns]);

  function toggleApplication(application: string) {
    setSelectedApplications((current) =>
      current.includes(application)
        ? current.filter((value) => value !== application)
        : [...current, application],
    );
  }

  if (projectId !== 'park_heights') {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
        Billing Batch View is currently configured only for Park Heights.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">
        Loading Billing Batch View...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        {error}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <div className="border-b border-slate-800 px-4 pt-4">
        <span className="mb-2 block text-xs font-semibold text-slate-400">
          Application group
        </span>
        <div className="overflow-x-auto pb-3">
          <div className="flex min-w-max gap-2">
            {BILLING_BATCH_GROUPS.map((group) => {
              const active = group.id === activeGroupId;

              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setActiveGroupId(group.id)}
                  className={[
                    'whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-semibold transition-colors',
                    active
                      ? 'border-cyan-400/70 bg-cyan-400/15 text-cyan-200'
                      : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600 hover:bg-slate-800',
                  ].join(' ')}
                >
                  {group.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b border-slate-800 p-4">
        <div className="min-w-[280px] flex-1 sm:max-w-md">
          <span className="mb-1.5 block text-xs font-semibold text-slate-400">
            Application
          </span>

          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition-colors hover:border-slate-600 focus:border-cyan-500 [&::-webkit-details-marker]:hidden">
              <span className="truncate">
                {selectedApplications.length === 0
                  ? 'All applications'
                  : selectedApplications.length === 1
                    ? selectedApplications[0]
                    : `${selectedApplications.length} applications selected`}
              </span>
              <span className="text-slate-400 transition-transform group-open:rotate-180">
                ▾
              </span>
            </summary>

            <div className="absolute left-0 top-full z-[90] mt-2 w-full min-w-[320px] overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-200">
                    {activeGroup.label}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {availableApplications.length} applications
                  </div>
                </div>
                {selectedApplications.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedApplications([])}
                    className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-800"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto p-2">
                {availableApplications.map((application) => (
                  <label
                    key={application}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-200 hover:bg-slate-800/80"
                  >
                    <input
                      type="checkbox"
                      checked={selectedApplications.includes(application)}
                      onChange={() => toggleApplication(application)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900 accent-cyan-500"
                    />
                    <span>{application}</span>
                  </label>
                ))}

                {availableApplications.length === 0 && (
                  <div className="px-3 py-5 text-center text-xs text-slate-500">
                    No applications are mapped to this group.
                  </div>
                )}
              </div>
            </div>
          </details>
        </div>

        <label className="min-w-[180px]">
          <span className="mb-1.5 block text-xs font-semibold text-slate-400">
            Batch highlight
          </span>
          <select
            value={selectedBatch}
            onChange={(event) => setSelectedBatch(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
          >
            <option value="">All Batches</option>
            {(data?.batches ?? []).map((batch) => (
              <option key={batch} value={batch}>
                {batch}
              </option>
            ))}
          </select>
        </label>

        <ExportButtons
          rows={exportRows}
          fileName={`${toFilePart(projectId)}-billing-batch-${toFilePart(activeGroup.label)}`}
          sheetName={activeGroup.label}
        />

        <div className="ml-auto text-right text-xs text-slate-400">
          <div>
            Showing {filteredRows.length.toLocaleString('en-IN')} of{' '}
            {groupRows.length.toLocaleString('en-IN')} flats
          </div>
          {selectedBatch && (
            <div className="mt-1 flex items-center justify-end gap-2 text-amber-300">
              <span className="h-2.5 w-2.5 rounded-sm bg-amber-400/70" />
              Highlighting {selectedBatch}
            </div>
          )}
        </div>
      </div>

      <div className="max-h-[calc(100vh-315px)] min-h-[320px] overflow-auto overscroll-contain">
        <table
          className="w-full border-collapse text-xs"
          style={{ minWidth: `${310 + activeColumns.length * 125}px` }}
        >
          <thead className="text-slate-300">
            <tr className="h-10 border-b border-slate-800">
              <th
                rowSpan={2}
                className="sticky left-0 top-0 z-50 min-w-[120px] border-r border-slate-800 bg-slate-950 p-3 text-left"
              >
                Flat
              </th>
              <th
                rowSpan={2}
                className="sticky left-[120px] top-0 z-50 min-w-[190px] border-r border-slate-800 bg-slate-950 p-3 text-left"
              >
                Application
              </th>

              {layerGroups.map((group) => (
                <th
                  key={group.layerName}
                  colSpan={group.columns.length}
                  className="sticky top-0 z-40 border-r border-slate-800 bg-slate-950 p-3 text-center font-semibold text-slate-200"
                >
                  {group.layerName}
                </th>
              ))}
            </tr>

            <tr className="h-9 border-b border-slate-800 text-slate-400">
              {activeColumns.map((column) => (
                <th
                  key={column.key}
                  className="sticky top-10 z-30 min-w-[125px] border-r border-slate-800 bg-slate-950 px-3 py-2 text-right font-medium"
                >
                  {column.surface}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredRows.map((row) => (
              <tr
                key={`${activeGroupId}:${row.flat}:${row.application ?? ''}`}
                className="border-t border-slate-800 hover:bg-slate-800/30"
              >
                <td className="sticky left-0 z-10 border-r border-slate-800 bg-slate-900 p-3 font-semibold text-cyan-300">
                  {row.flat || '-'}
                </td>
                <td className="sticky left-[120px] z-10 border-r border-slate-800 bg-slate-900 p-3 text-slate-200">
                  {row.application || '-'}
                </td>

                {activeColumns.map((column) => {
                  const notApplicable = isBillingBatchCellNotApplicable(
                    activeGroupId,
                    row.application,
                    column,
                  );
                  const cell = row.cells[column.key] ?? {
                    area: 0,
                    batch: null,
                  };
                  const highlighted =
                    !notApplicable &&
                    Boolean(selectedBatch) &&
                    String(cell.batch ?? '').toLowerCase() ===
                      selectedBatch.toLowerCase();

                  if (notApplicable) {
                    return (
                      <td
                        key={column.key}
                        className="border-r border-slate-800 bg-slate-950/40 p-3 text-center font-semibold text-slate-500"
                        title="Not applicable in this group. Staircase ceiling is shown in the Ceiling group."
                      >
                        N.A.
                      </td>
                    );
                  }

                  return (
                    <td
                      key={column.key}
                      className={[
                        'border-r border-slate-800 p-3 text-right tabular-nums',
                        highlighted
                          ? 'bg-amber-400/20 font-semibold text-amber-200 ring-1 ring-inset ring-amber-400/50'
                          : cell.area > 0
                            ? 'text-slate-100'
                            : 'text-slate-500',
                      ].join(' ')}
                      title={
                        cell.batch
                          ? `${cell.batch} · ${formatNumber(cell.area)} sq ft`
                          : 'Not billed'
                      }
                    >
                      {formatNumber(cell.area)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {filteredRows.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-400">
            No Park Heights billing batch rows match the selected group and filters.
          </div>
        )}
      </div>
    </div>
  );
}

function FloorLayerBillingBlock({
  token,
  projectId,
  searchQuery,
}: {
  token: string;
  projectId: string;
  searchQuery: string;
}) {
  const [layers, setLayers] = useState<BillingFloorLayerSummary[]>([]);
  const [selectedLayer, setSelectedLayer] = useState('');
  const [report, setReport] = useState<BillingFloorLayerReport | null>(null);
  const [latestOnly, setLatestOnly] = useState(false);
  const [loadingLayers, setLoadingLayers] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadLayers() {
      if (!token || !projectId) {
        return;
      }

      setLoadingLayers(true);
      setError('');

      try {
        const layerList = await fetchBillingFloorLayerList(token, projectId);
        setLayers(layerList);

        if (!selectedLayer && layerList.length > 0) {
          setSelectedLayer(layerList[0].layerName);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load billing layers');
      } finally {
        setLoadingLayers(false);
      }
    }

    loadLayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, projectId]);

  useEffect(() => {
    async function loadReport() {
      if (!token || !projectId || !selectedLayer) {
        return;
      }

      setLoadingReport(true);
      setError('');

      try {
        const reportData = await fetchBillingFloorLayerReport(token, projectId, {
          layerName: selectedLayer,
        });
        setReport(reportData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load floor-wise billing report');
      } finally {
        setLoadingReport(false);
      }
    }

    loadReport();
  }, [token, projectId, selectedLayer]);

  const filteredSections = useMemo(() => {
    if (!report) {
      return [];
    }

    const query = searchQuery.trim().toLowerCase();

    return report.sections
      .map((section) => {
        let rows = section.rows;

        if (latestOnly) {
          rows = rows.filter((row) => row.isLatestBatch);
        }

        if (query) {
          rows = rows.filter((row) =>
            [
              section.sectionTitle,
              row.description,
              row.application,
              row.flat,
              row.layerName,
              row.batchSummary,
              row.ceilingBatch,
              row.wallBatch,
              row.ceilingBillingNumber,
              row.wallBillingNumber,
            ]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(query)),
          );
        }

        return {
          ...section,
          rows,
          totals: calculateSectionTotals(rows),
          hasLatestBatchRows: rows.some((row) => row.isLatestBatch),
        };
      })
      .filter((section) => section.rows.length > 0);
  }, [report, searchQuery, latestOnly]);

  const floorExportRows = useMemo<ExportRow[]>(
    () =>
      filteredSections.flatMap((section) => [
        ...section.rows.map((row, index) => ({
          Section: section.sectionTitle,
          'SL NO': index + 1,
          Description: row.description || '',
          Unit: row.unit || 'Sqm',
          Nos: Number(row.nos) || 0,
          Ceiling: Number(row.ceilingArea) || 0,
          Wall: Number(row.wallArea) || 0,
          Batch: row.batchSummary || '',
          Remark: row.rowHighlight || '',
        })),
        {
          Section: section.sectionTitle,
          'SL NO': '',
          Description: 'Total QTY.',
          Unit: '',
          Nos: '',
          Ceiling: section.totals.ceilingArea,
          Wall: section.totals.wallArea,
          Batch: section.totals.totalArea,
          Remark: '',
        },
      ]),
    [filteredSections],
  );

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Billing Engine / Floor Wise Report
            </p>
            <h3 className="mt-1 font-display text-lg font-semibold">
              Layer-wise floor billing table
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              This view follows your Excel format: floor section, flat/corridor
              description, unit, ceiling, wall, batch and latest-billed highlight.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <ExportButtons
              rows={floorExportRows}
              fileName={`${toFilePart(projectId)}-floor-wise-${toFilePart(selectedLayer)}`}
              sheetName="Floor Wise Billing"
            />

            <div>
              <label className="mb-1 block text-[11px] text-slate-500">
                Select Layer
              </label>
              <select
                value={selectedLayer}
                onChange={(event) => setSelectedLayer(event.target.value)}
                disabled={loadingLayers}
                className="min-w-52 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              >
                {layers.map((layer) => (
                  <option key={layer.layerName} value={layer.layerName}>
                    {layer.layerName}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={latestOnly}
                onChange={(event) => setLatestOnly(event.target.checked)}
                className="accent-emerald-500"
              />
              Latest billed only
            </label>
          </div>
        </div>
      </div>

      {loadingReport ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
          Loading floor-wise billing report...
        </div>
      ) : filteredSections.length > 0 ? (
        filteredSections.map((section) => (
          <FloorLayerSectionTable
            key={`${section.sectionTitle}-${section.layerName}-${section.floorNo}`}
            sectionTitle={section.sectionTitle}
            rows={section.rows}
            totals={section.totals}
          />
        ))
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400">
          No floor-wise billing rows found for this layer/search.
        </div>
      )}
    </div>
  );
}

function FloorLayerSectionTable({
  sectionTitle,
  rows,
  totals,
}: {
  sectionTitle: string;
  rows: BillingFloorLayerRow[];
  totals: {
    ceilingArea: number;
    wallArea: number;
    totalArea: number;
  };
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <div className="border-b border-slate-800 bg-slate-900 px-4 py-3">
        <h3 className="text-center font-display text-sm font-semibold text-emerald-200">
          {sectionTitle}
        </h3>
      </div>

      <div className="overflow-auto">
        <table className="min-w-[900px] w-full border-collapse text-xs">
          <thead>
            <tr className="bg-amber-300 text-slate-950">
              <th className="border border-slate-700 p-2 text-center">SL NO</th>
              <th className="border border-slate-700 p-2 text-center">Description</th>
              <th className="border border-slate-700 p-2 text-center">Unit</th>
              <th className="border border-slate-700 p-2 text-center">Nos</th>
              <th className="border border-slate-700 p-2 text-center">Ceiling</th>
              <th className="border border-slate-700 p-2 text-center">Wall</th>
              <th className="border border-slate-700 p-2 text-center">Batch</th>
              <th className="border border-slate-700 p-2 text-center">Remark</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.application}-${row.flat}-${row.layerName}-${row.description}-${index}`}
                className={`border-t border-slate-800 ${
                  row.isLatestBatch
                    ? 'bg-emerald-500/15 text-emerald-50'
                    : 'text-slate-200'
                }`}
              >
                <td className="border border-slate-800 p-2 text-center font-mono">
                  {index + 1}
                </td>
                <td className="border border-slate-800 p-2 text-center font-mono">
                  {row.description || '-'}
                </td>
                <td className="border border-slate-800 p-2 text-center">
                  {row.unit || 'Sqm'}
                </td>
                <td className="border border-slate-800 p-2 text-center font-mono">
                  {row.nos ? formatNumber(row.nos) : ''}
                </td>
                <td className="border border-slate-800 p-2 text-right font-mono">
                  {formatNumber(row.ceilingArea)}
                </td>
                <td className="border border-slate-800 p-2 text-right font-mono">
                  {formatNumber(row.wallArea)}
                </td>
                <td className="border border-slate-800 p-2 text-center font-mono">
                  {row.batchSummary || '-'}
                </td>
                <td className="border border-slate-800 p-2 text-center text-emerald-300">
                  {row.rowHighlight || ''}
                </td>
              </tr>
            ))}

            <tr className="bg-yellow-300 font-semibold text-slate-950">
              <td className="border border-slate-700 p-2" colSpan={3} />
              <td className="border border-slate-700 p-2 text-center">Total QTY.</td>
              <td className="border border-slate-700 p-2 text-right font-mono">
                {formatNumber(totals.ceilingArea)}
              </td>
              <td className="border border-slate-700 p-2 text-right font-mono">
                {formatNumber(totals.wallArea)}
              </td>
              <td className="border border-slate-700 p-2 text-center font-mono">
                {formatNumber(totals.totalArea)}
              </td>
              <td className="border border-slate-700 p-2" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvoiceBlock({
  projectId,
  batchNo,
  setBatchNo,
  rows,
  loading,
}: {
  projectId: string;
  batchNo: number;
  setBatchNo: (value: number) => void;
  rows: BillingInvoiceRow[];
  loading: boolean;
}) {
  const exportRows: ExportRow[] = rows.map((row) => ({
    'Sl No': row.slNo,
    'Description of the work': row.descriptionOfTheWork,
    Surface: row.surface,
    Unit: row.unit,
    Rate: row.rate,
    'Quantity Previous': row.quantityPrevious,
    'Quantity Current': row.quantityCurrent,
    'Quantity Cumulative': row.quantityCumulative,
    'Amount Previous': row.amountPrevious,
    'Amount Current': row.amountCurrent,
    'Amount Cumulative': row.amountCumulative,
  }));

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
        <div>
          <h3 className="font-semibold">Invoice Summary</h3>
          <p className="text-xs text-slate-400">
            Previous, current and cumulative billing for selected batch.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <ExportButtons
            rows={exportRows}
            fileName={`${toFilePart(projectId)}-invoice-batch-${batchNo}`}
            sheetName={`Invoice Batch ${batchNo}`}
          />

          <div>
            <label className="mb-1 block text-xs text-slate-400">Batch No.</label>
            <input
            type="number"
            min={1}
            value={batchNo}
            onChange={(event) => setBatchNo(Number(event.target.value) || 1)}
              className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-5 text-sm text-slate-400">Loading invoice...</div>
      ) : (
        <div className="overflow-auto">
          <table className="min-w-[1100px] w-full border-collapse text-xs">
            <thead className="bg-slate-950 text-left text-slate-400">
              <tr>
                <th className="p-3">Sl No</th>
                <th className="p-3">Description</th>
                <th className="p-3">Surface</th>
                <th className="p-3">Unit</th>
                <th className="p-3">Rate</th>
                <th className="p-3">Qty Prev</th>
                <th className="p-3">Qty Current</th>
                <th className="p-3">Qty Cum</th>
                <th className="p-3">Amt Prev</th>
                <th className="p-3">Amt Current</th>
                <th className="p-3">Amt Cum</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr key={row.slNo} className="border-t border-slate-800">
                  <td className="p-3">{row.slNo}</td>
                  <td className="p-3">{row.descriptionOfTheWork}</td>
                  <td className="p-3">{row.surface}</td>
                  <td className="p-3">{row.unit}</td>
                  <td className="p-3">{formatNumber(row.rate)}</td>
                  <td className="p-3">{formatNumber(row.quantityPrevious)}</td>
                  <td className="p-3">{formatNumber(row.quantityCurrent)}</td>
                  <td className="p-3">{formatNumber(row.quantityCumulative)}</td>
                  <td className="p-3">{formatCurrency(row.amountPrevious)}</td>
                  <td className="p-3">{formatCurrency(row.amountCurrent)}</td>
                  <td className="p-3">{formatCurrency(row.amountCumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-400">
              No invoice rows found for this batch.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type BillingColumnKey =
  | 'application'
  | 'flat'
  | 'surfaceType'
  | 'layerName'
  | 'billed'
  | 'billingNumber'
  | 'billingDate'
  | 'rate'
  | 'billingArea'
  | 'amount'
  | 'status'
  | 'batch';

const HIDDEN_COLUMNS_BY_VIEW: Record<BillingViewId, BillingColumnKey[]> = {
  'billing-overall': ['rate', 'billingArea', 'amount'],

  'billing-pending': [
    'billed',
    'billingNumber',
    'billingDate',
    'rate',
    'billingArea',
    'amount',
    'batch',
  ],

  'billing-sent': [
    'billingNumber',
    'rate',
    'billingArea',
    'amount',
    'batch',
  ],

  'billing-billed': ['rate', 'billingArea', 'amount'],

  'billing-latest': [],

  'billing-invoice': [],

  'billing-floor-layer': [],
  'billing-batch-view': [],
};

function BillingTable({
  rows,
  view,
  projectId,
}: {
  rows: BillingRow[];
  view: BillingViewId;
  projectId: string;
}) {
  const hiddenColumns = new Set(HIDDEN_COLUMNS_BY_VIEW[view]);

  const columns: {
    key: BillingColumnKey;
    label: string;
    render: (row: BillingRow) => ReactNode;
  }[] = [
    {
      key: 'application',
      label: 'Application',
      render: (row) => row.application || '-',
    },
    {
      key: 'flat',
      label: 'Flat',
      render: (row) => row.flat || '-',
    },
    {
      key: 'surfaceType',
      label: 'Surface Type',
      render: (row) => row.surfaceType || '-',
    },
    {
      key: 'layerName',
      label: 'Layer Name',
      render: (row) => row.layerName || '-',
    },
    {
      key: 'billed',
      label: 'Billed',
      render: (row) => (row.billed ? 'Y' : 'N'),
    },
    {
      key: 'billingNumber',
      label: 'Billing Number',
      render: (row) => row.billingNumber || '-',
    },
    {
      key: 'billingDate',
      label: 'Billing Date',
      render: (row) => row.billingDate || '-',
    },
    {
      key: 'rate',
      label: 'Rate',
      render: (row) => formatNumber(row.rate),
    },
    {
      key: 'billingArea',
      label: 'Billing Area',
      render: (row) => formatNumber(row.billingArea),
    },
    {
      key: 'amount',
      label: 'Amount',
      render: (row) => formatCurrency(getAmount(row)),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => row.status || '-',
    },
    {
      key: 'batch',
      label: 'Batch',
      render: (row) => row.batch || '-',
    },
  ];

  const visibleColumns = columns.filter(
    (column) => !hiddenColumns.has(column.key),
  );

  const exportRows: ExportRow[] = rows.map((row) =>
    Object.fromEntries(
      visibleColumns.map((column) => [
        column.label,
        getBillingExportValue(row, column.key),
      ]),
    ),
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
        <div>
          <h3 className="font-semibold">Billing Rows</h3>
          <p className="mt-1 text-xs text-slate-400">
            Export includes the rows currently shown after search.
          </p>
        </div>

        <ExportButtons
          rows={exportRows}
          fileName={`${toFilePart(projectId)}-${toFilePart(getBillingViewTitle(view))}`}
          sheetName={getBillingViewTitle(view)}
        />
      </div>

      <div className="overflow-auto">
        <table className="min-w-[1100px] w-full border-collapse text-xs">
          <thead className="bg-slate-950 text-left text-slate-400">
            <tr>
              {visibleColumns.map((column) => (
                <th key={column.key} className="p-3">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-800">
                {visibleColumns.map((column) => (
                  <td key={column.key} className="p-3">
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-400">
            No billing rows found.
          </div>
        )}
      </div>
    </div>
  );
}

function ExportButtons({
  rows,
  fileName,
  sheetName,
}: {
  rows: ExportRow[];
  fileName: string;
  sheetName: string;
}) {
  const [exporting, setExporting] = useState<'csv' | 'excel' | null>(null);
  const disabled = rows.length === 0 || exporting !== null;

  async function handleExcelExport() {
    try {
      setExporting('excel');
      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet['!cols'] = getWorksheetColumnWidths(rows);

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        sheetName.slice(0, 31),
      );
      XLSX.writeFile(workbook, `${withDate(fileName)}.xlsx`);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div>
      <p className="mb-1 text-[11px] text-slate-500">Export table</p>
      <div className="flex overflow-hidden rounded-lg border border-slate-700">
        <button
          type="button"
          disabled={disabled}
          onClick={() => exportCsv(rows, withDate(fileName))}
          className="bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          CSV
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={handleExcelExport}
          className="border-l border-slate-700 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {exporting === 'excel' ? 'Exporting...' : 'Excel'}
        </button>
      </div>
    </div>
  );
}

function exportCsv(rows: ExportRow[], fileName: string) {
  if (rows.length === 0) {
    return;
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) =>
      headers.map((header) => escapeCsvCell(row[header])).join(','),
    ),
  ];

  downloadBlob(
    new Blob([`\uFEFF${lines.join('\r\n')}`], {
      type: 'text/csv;charset=utf-8',
    }),
    `${fileName}.csv`,
  );
}

function escapeCsvCell(value: ExportCell) {
  const text = value === null || value === undefined ? '' : String(value);
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getWorksheetColumnWidths(rows: ExportRow[]) {
  if (rows.length === 0) {
    return [];
  }

  return Object.keys(rows[0]).map((header) => {
    const longestValue = rows.reduce(
      (longest, row) =>
        Math.max(longest, String(row[header] ?? '').length),
      header.length,
    );

    return { wch: Math.min(Math.max(longestValue + 2, 10), 40) };
  });
}

function withDate(fileName: string) {
  return `${fileName}-${new Date().toISOString().slice(0, 10)}`;
}

function toFilePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'billing';
}

function getBillingExportValue(
  row: BillingRow,
  key: BillingColumnKey,
): ExportCell {
  switch (key) {
    case 'application':
      return row.application || '';
    case 'flat':
      return row.flat || '';
    case 'surfaceType':
      return row.surfaceType || '';
    case 'layerName':
      return row.layerName || '';
    case 'billed':
      return row.billed ? 'Yes' : 'No';
    case 'billingNumber':
      return row.billingNumber || '';
    case 'billingDate':
      return row.billingDate || '';
    case 'rate':
      return Number(row.rate) || 0;
    case 'billingArea':
      return Number(row.billingArea) || 0;
    case 'amount':
      return getAmount(row);
    case 'status':
      return row.status || '';
    case 'batch':
      return row.batch || '';
  }
}

function calculateSectionTotals(rows: BillingFloorLayerRow[]) {
  return rows.reduce(
    (totals, row) => ({
      ceilingArea: totals.ceilingArea + (Number(row.ceilingArea) || 0),
      wallArea: totals.wallArea + (Number(row.wallArea) || 0),
      totalArea: totals.totalArea + (Number(row.totalArea) || 0),
    }),
    {
      ceilingArea: 0,
      wallArea: 0,
      totalArea: 0,
    },
  );
}

function getAmount(row: BillingRow) {
  return (Number(row.rate) || 0) * (Number(row.billingArea) || 0);
}

function formatCurrency(value: number) {
  return `₹${Math.round(value || 0).toLocaleString('en-IN')}`;
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  });
}