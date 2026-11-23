'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  fetchWorkOrderWorksheet,
  WorkOrderWorksheetResponse,
  WorkOrderWorksheetRow,
} from '../../lib/api';

type NumericKey =
  | 'targetLabourDays'
  | 'labourCost'
  | 'materialCost'
  | 'revenue'
  | 'margin';

type Totals = {
  targetLabourDays: number | null;
  labourCost: number | null;
  materialCost: number | null;
  totalCost: number | null;
  revenue: number | null;
  margin: number | null;
};

const formatNumber = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : value.toLocaleString('en-IN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

const formatMoney = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : `₹${formatNumber(value, digits)}`;

const formatCompactMoney = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  if (absolute >= 10_000_000)
    return `₹${formatNumber(value / 10_000_000, 2)} Cr`;
  if (absolute >= 100_000)
    return `₹${formatNumber(value / 100_000, 2)} L`;
  return formatMoney(value);
};

// A missing field must NOT silently become zero in a financial KPI.
const completeSum = (rows: WorkOrderWorksheetRow[], key: NumericKey) => {
  if (!rows.length || rows.some((row) => row[key] == null)) return null;
  return rows.reduce((total, row) => total + (row[key] as number), 0);
};

function totalsFor(rows: WorkOrderWorksheetRow[]): Totals {
  const labourCost = completeSum(rows, 'labourCost');
  const materialCost = completeSum(rows, 'materialCost');
  return {
    targetLabourDays: completeSum(rows, 'targetLabourDays'),
    labourCost,
    materialCost,
    totalCost:
      labourCost !== null && materialCost !== null
        ? labourCost + materialCost
        : null,
    revenue: completeSum(rows, 'revenue'),
    margin: completeSum(rows, 'margin'),
  };
}

function MetricCard({
  title,
  value,
  subtitle,
  tone,
}: {
  title: string;
  value: string;
  subtitle?: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3">
      <div className="text-[11px] font-medium text-slate-400">{title}</div>
      <div
        className={`mt-1 break-words font-mono text-[18px] font-bold sm:text-xl ${
          tone === 'positive'
            ? 'text-emerald-400'
            : tone === 'negative'
              ? 'text-rose-400'
              : 'text-white'
        }`}
      >
        {value}
      </div>
      {subtitle && <div className="mt-1 text-[11px] text-slate-500">{subtitle}</div>}
    </div>
  );
}

function CostComparisonChart({ rows }: { rows: WorkOrderWorksheetRow[] }) {
  // Keep the chart readable for projects with many application/layer variants.
  const shown = rows
    .filter((row) => row.area != null && row.area > 0)
    .slice()
    .sort((a, b) => {
      const aCost = ((a.labourCost ?? 0) + (a.materialCost ?? 0)) / (a.area || 1);
      const bCost = ((b.labourCost ?? 0) + (b.materialCost ?? 0)) / (b.area || 1);
      return bCost - aCost;
    })
    .slice(0, 12);
  const max = Math.max(
    1,
    ...shown.map((row) =>
      Math.max(
        row.clientRate ?? 0,
        ((row.labourCost ?? 0) + (row.materialCost ?? 0)) / (row.area || 1),
      ),
    ),
  );
  const top = 32;
  const rowHeight = 32;
  const left = 208;
  const chartWidth = 520;
  const width = 820;
  const height = top + shown.length * rowHeight + 28;

  if (!shown.length) {
    return <div className="p-6 text-sm text-slate-400">No layer area data to chart.</div>;
  }

  return (
    <div className="overflow-x-auto px-4 pb-4 pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-slate-400">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-blue-500" /> Labour / sq ft</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" /> Material / sq ft</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-cyan-300" /> Client rate / sq ft</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[620px] max-w-full"
        aria-label="Labour and material costs compared with client rate for up to 12 layer rows"
        role="img"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const x = left + fraction * chartWidth;
          return (
            <g key={fraction}>
              <line x1={x} y1={top - 5} x2={x} y2={height - 18} stroke="#334155" strokeDasharray="2 4" />
              <text x={x} y={15} fill="#94a3b8" fontSize="11" textAnchor="middle">
                {formatNumber(max * fraction, 2)}
              </text>
            </g>
          );
        })}
        {shown.map((row, index) => {
          const y = top + index * rowHeight;
          const labour = row.labourCost != null ? row.labourCost / (row.area || 1) : null;
          const material = row.materialCost != null ? row.materialCost / (row.area || 1) : null;
          const wageWidth = Math.max(0, (labour || 0) / max * chartWidth);
          const materialWidth = Math.max(0, (material || 0) / max * chartWidth);
          const marker = row.clientRate != null ? left + row.clientRate / max * chartWidth : null;
          const name = `${row.block ? `${row.block} · ` : ''}${row.layer || 'Unnamed layer'}`;
          return (
            <g key={`${name}-${index}`}>
              <title>{`${name} | Labour ₹${formatNumber(labour, 2)}/sq ft | Material ₹${formatNumber(material, 2)}/sq ft | Rate ${formatMoney(row.clientRate, 2)}/sq ft`}</title>
              <text x={left - 10} y={y + 15} textAnchor="end" fill="#cbd5e1" fontSize="11">
                {name.length > 29 ? `${name.slice(0, 28)}…` : name}
              </text>
              <rect x={left} y={y + 3} width={chartWidth} height={16} rx={3} fill="#1e293b" />
              {labour != null && <rect x={left} y={y + 3} width={wageWidth} height={16} fill="#3b82f6" />}
              {material != null && <rect x={left + wageWidth} y={y + 3} width={materialWidth} height={16} fill="#fbbf24" />}
              {marker != null && <line x1={marker} x2={marker} y1={y - 1} y2={y + 23} stroke="#67e8f9" strokeWidth={3} />}
            </g>
          );
        })}
        <text x={left + chartWidth / 2} y={height - 2} fill="#94a3b8" fontSize="11" textAnchor="middle">
          ₹ per sq ft
        </text>
      </svg>
      {rows.length > 12 && (
        <p className="mt-1 text-[11px] text-slate-500">Showing up to 12 costliest layer rows per sq ft; the worksheet includes all matching rows.</p>
      )}
    </div>
  );
}

function CostStructureChart({ totals }: { totals: Totals }) {
  const labour = totals.labourCost;
  const material = totals.materialCost;
  const margin = totals.margin;
  if (labour == null || material == null || margin == null) {
    return <div className="p-6 text-sm text-slate-400">Cost structure is unavailable until labour, material and client-rate inputs are complete.</div>;
  }

  const segments = [
    { label: 'Labour', amount: Math.max(0, labour), color: '#3b82f6' },
    { label: 'Material', amount: Math.max(0, material), color: '#fbbf24' },
    { label: 'Margin', amount: Math.max(0, margin), color: '#10b981' },
  ];
  const positiveSum = segments.reduce((sum, item) => sum + item.amount, 0);
  const circumference = 2 * Math.PI * 68;
  let previous = 0;
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 px-4 py-5">
      <svg viewBox="0 0 210 210" className="h-52 w-52 shrink-0" role="img" aria-label="Labour cost, material cost and positive margin shares">
        <circle cx={105} cy={105} r={68} stroke="#334155" strokeWidth={27} fill="none" />
        {positiveSum > 0 && segments.map((part) => {
          const share = part.amount / positiveSum;
          const start = previous;
          previous += share;
          return (
            <circle
              key={part.label}
              cx={105}
              cy={105}
              r={68}
              fill="none"
              stroke={part.color}
              strokeWidth={27}
              strokeDasharray={`${share * circumference} ${circumference}`}
              strokeDashoffset={-start * circumference}
              transform="rotate(-90 105 105)"
            />
          );
        })}
        <text x={105} y={102} textAnchor="middle" fill="white" fontSize={20} fontWeight="bold">
          {totals.revenue ? `${formatNumber(margin / totals.revenue * 100, 1)}%` : '—'}
        </text>
        <text x={105} y={123} textAnchor="middle" fill="#94a3b8" fontSize={11}>Margin</text>
      </svg>
      <div className="min-w-[150px] space-y-3 text-xs">
        {segments.map((part) => (
          <div key={part.label} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: part.color }} />
            <div>
              <div className="font-semibold text-slate-200">{part.label}</div>
              <div className="text-slate-400">{formatCompactMoney(part.label === 'Margin' ? margin : part.amount)}</div>
            </div>
          </div>
        ))}
        {margin < 0 && <p className="text-rose-400">Negative margin is not represented in the doughnut share.</p>}
      </div>
    </div>
  );
}

export function WorkOrderWorksheet({
  token,
  projectId,
}: {
  token: string;
  projectId: string;
}) {
  const [response, setResponse] = useState<WorkOrderWorksheetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [application, setApplication] = useState('');
  const [block, setBlock] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setApplication('');
    setBlock('');
    setSearch('');
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !token) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchWorkOrderWorksheet(token, projectId)
      .then((data) => { if (!cancelled) setResponse(data); })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load Work Order costing');
          setResponse(null);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, token, reload]);

  const allRows = response?.rows ?? [];
  const applications = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.application).filter((item): item is string => !!item))).sort(),
    [allRows],
  );
  const activeApplication = applications.includes(application) ? application : (applications[0] ?? '');
  const blocks = useMemo(
    () => Array.from(new Set(allRows.filter((row) => row.application === activeApplication).map((row) => row.block).filter((item): item is string => !!item))).sort(),
    [allRows, activeApplication],
  );
  const activeBlock = block && blocks.includes(block) ? block : '';
  const scopedRows = useMemo(
    () => allRows.filter((row) => row.application === activeApplication && (!activeBlock || row.block === activeBlock)),
    [allRows, activeApplication, activeBlock],
  );
  const visibleRows = useMemo(
    () => scopedRows.filter((row) => `${row.block || ''} ${row.layer || ''} ${row.materialName || ''}`.toLowerCase().includes(search.trim().toLowerCase())),
    [scopedRows, search],
  );
  // KPIs/charts reflect Application + Block, not the free-text table search.
  const totals = useMemo(() => totalsFor(scopedRows), [scopedRows]);
  const areaRows = response?.areas ?? [];
  const applicationArea = areaRows.filter((row) => row.application === activeApplication && (!activeBlock || row.block === activeBlock));
  const uniqueArea = applicationArea.length && applicationArea.every((r) => r.area !== null)
    ? applicationArea.reduce((sum, row) => sum + (row.area || 0), 0)
    : null;
  const marginPercentage = totals.revenue && totals.margin !== null
    ? totals.margin / totals.revenue * 100
    : null;

  const tableHeading = 'sticky top-0 z-10 whitespace-nowrap border-b border-slate-700 bg-slate-950 px-3 py-2.5 text-left text-[11px] font-semibold text-slate-300';
  const tableCell = 'whitespace-nowrap border-b border-slate-800 px-3 py-2 font-mono text-xs text-slate-200';
  const inputStyle = 'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-500';

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">Work Order &amp; Costing</h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Project-specific costing worksheet from imported Work Order data. Display only — changes to rates and material inputs remain in Project Setup.
          </p>
        </div>
        <button type="button" onClick={() => setReload((count) => count + 1)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800">
          Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div>}
      {loading && <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">Loading Work Order costing...</div>}

      {!loading && !error && response && !allRows.length && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
          <p className="font-semibold text-white">No Work Order costing data imported yet.</p>
          <p className="mt-2 text-sm text-slate-400">Use Admin → Project Setup → Cost / Work Order Data to import Application and Layer costing information for this project.</p>
        </div>
      )}

      {!loading && !error && response && allRows.length > 0 && (
        <>
          {response.source === 'legacy-boq-costing' && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
              Park Heights is using the existing legacy costing view. Productivity, labour cost, coverage and other fields not provided by that view are shown as —; they are not invented.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {applications.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => { setApplication(name); setBlock(''); setSearch(''); }}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${activeApplication === name ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Block
              <select value={activeBlock} onChange={(event) => setBlock(event.target.value)} className={inputStyle}>
                <option value="">All blocks</option>
                {blocks.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs text-slate-400">
              Search worksheet
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Layer or material..." className={inputStyle} />
            </label>
            <span className="pb-2 text-xs text-slate-500">{scopedRows.length.toLocaleString('en-IN')} costing rows</span>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <MetricCard title="Size Area" value={uniqueArea != null ? `${formatNumber(uniqueArea, 2)} SFT` : '—'} subtitle="Unique flats in selected scope" />
            <MetricCard title="Target Labour Days" value={formatNumber(totals.targetLabourDays, 2)} subtitle="Area ÷ productivity" />
            <MetricCard title="Labour Cost" value={formatCompactMoney(totals.labourCost)} />
            <MetricCard title="Material Cost" value={formatCompactMoney(totals.materialCost)} />
            <MetricCard title="Total Cost" value={formatCompactMoney(totals.totalCost)} />
            <MetricCard title="Revenue" value={formatCompactMoney(totals.revenue)} subtitle="Using imported client rates" />
            <MetricCard title="Margin" value={formatCompactMoney(totals.margin)} subtitle={marginPercentage === null ? 'Awaiting complete costing inputs' : `${formatNumber(marginPercentage, 1)}% of revenue`} tone={totals.margin == null ? undefined : totals.margin < 0 ? 'negative' : 'positive'} />
          </div>

          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-xs leading-relaxed text-sky-200">
            <strong>Current formulas:</strong> Labour days = area ÷ productivity · Labour cost = days × per labour cost · Material required = area ÷ coverage · Material cost = required × rate · Revenue = area × client rate · Margin = revenue − labour − material. Consumption % is not yet captured by the Work Order import. A dash means the value is unavailable, not zero. Area is based on imported Dimensions; separately awarded Work Order quantities are not stored yet.
          </div>

          <section className="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
              <div>
                <h4 className="text-sm font-bold text-white">Costing sheet — {activeApplication}</h4>
                <p className="mt-1 text-xs text-slate-500">Read-only • Project: {projectId} • {activeBlock || 'All blocks'}</p>
              </div>
              <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-400">
                {visibleRows.length.toLocaleString('en-IN')} shown
              </span>
            </div>
            <div className="max-h-[650px] min-w-0 overflow-auto">
              <table className="w-max min-w-full border-collapse text-left">
                <thead>
                  <tr>
                    {[
                      'Block', 'Application Area', 'Layer', 'Size Area (SFT)', 'Productivity',
                      'Target Labour Days', 'Per Labour Cost', 'Labour Cost', 'Material Name',
                      'Consumption %', 'Material Coverage', 'Material Rate', 'Material Required',
                      'Material Cost PSFT', 'Material Cost', 'Client Rate PSFT', 'Revenue', 'Margin',
                    ].map((label) => <th key={label} className={tableHeading}>{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, index) => (
                    <tr key={`${row.application}-${row.block}-${row.layer}-${row.materialName}-${index}`} className="hover:bg-slate-800/50">
                      <td className={tableCell}>{row.block || '—'}</td>
                      <td className={tableCell}>{row.application || '—'}</td>
                      <td className={`${tableCell} font-semibold`}>{row.layer || '—'}</td>
                      <td className={`${tableCell} text-right`}>{formatNumber(row.area, 2)}</td>
                      <td className={`${tableCell} text-right`}>{formatNumber(row.productivity, 2)}</td>
                      <td className={`${tableCell} text-right`}>{formatNumber(row.targetLabourDays, 2)}</td>
                      <td className={`${tableCell} text-right`}>{formatMoney(row.perLabourCost, 2)}</td>
                      <td className={`${tableCell} text-right`}>{formatMoney(row.labourCost, 2)}</td>
                      <td className={tableCell}>{row.materialName || '—'}</td>
                      <td className={`${tableCell} text-right`}>{formatNumber(row.consumptionPct, 1)}</td>
                      <td className={`${tableCell} text-right`}>{formatNumber(row.materialCoverage, 2)}</td>
                      <td className={`${tableCell} text-right`}>{formatMoney(row.materialRatePerUnit, 2)}</td>
                      <td className={`${tableCell} text-right`}>{formatNumber(row.materialRequired, 2)}</td>
                      <td className={`${tableCell} text-right`}>{formatMoney(row.materialCostPerSft, 2)}</td>
                      <td className={`${tableCell} text-right`}>{formatMoney(row.materialCost, 2)}</td>
                      <td className={`${tableCell} text-right`}>{formatMoney(row.clientRate, 2)}</td>
                      <td className={`${tableCell} text-right`}>{formatMoney(row.revenue, 2)}</td>
                      <td className={`${tableCell} text-right ${row.margin != null && row.margin < 0 ? 'text-rose-400' : ''}`}>{formatMoney(row.margin, 2)}</td>
                    </tr>
                  ))}
                  {!visibleRows.length && <tr><td colSpan={18} className="p-6 text-center text-sm text-slate-400">No rows match the search.</td></tr>}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-950 font-bold text-white">
                    <td colSpan={5} className="px-3 py-3 text-xs">Total · {scopedRows.length} costing rows</td>
                    <td className="px-3 py-3 text-right text-xs">{formatNumber(totals.targetLabourDays, 2)}</td>
                    <td />
                    <td className="px-3 py-3 text-right text-xs">{formatMoney(totals.labourCost)}</td>
                    <td colSpan={6} />
                    <td className="px-3 py-3 text-right text-xs">{formatMoney(totals.materialCost)}</td>
                    <td />
                    <td className="px-3 py-3 text-right text-xs">{formatMoney(totals.revenue)}</td>
                    <td className="px-3 py-3 text-right text-xs">{formatMoney(totals.margin)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <section className="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <div className="border-b border-slate-800 px-4 py-3 text-sm font-semibold">Cost vs client rate by layer (₹/SFT)</div>
              <CostComparisonChart rows={scopedRows} />
            </section>
            <section className="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <div className="border-b border-slate-800 px-4 py-3 text-sm font-semibold">Cost structure</div>
              <CostStructureChart totals={totals} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
