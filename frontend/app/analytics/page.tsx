'use client';

import {
  Fragment,
  Suspense,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ChangeEvent, Dispatch, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, SetStateAction } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  clearEntryReview,
  fetchAnalyticsOptions,
  fetchAnalyticsReport,
  fetchEntryReview,
  fetchExecutiveSummary,
  refreshAnalytics,
  updateEntryReview,
} from '../../lib/analyticsApi';
import type {
  AnalyticsOptions,
  AnalyticsReportResponse,
  AnalyticsReportRow,
  ApplicationSummaryRow,
  BudgetCostControlApplicationRow,
  BudgetCostControlFlatLayerRow,
  DailyProfitTrendRow,
  DateTimelineApplicationRow,
  DateTimelineEntryRow,
  DateTimelineRow,
  EntryReviewFilters,
  EntryReviewPainterReportRow,
  EntryReviewResponse,
  EntryReviewRow,
  ExecutiveSummaryFilters,
  ExecutiveSummaryResponse,
  FlatSummaryRow,
  TrendAnalysisCell,
} from '../../lib/analyticsApi';
import type { User } from '../../lib/api';
import { projects } from '../../lib/projects';

const emptyOptions: AnalyticsOptions = {
  applications: [],
  blocks: [],
  flats: [],
  workLayers: [],
  filterRelations: [],
  profitability: ['all', 'profit', 'loss', 'break_even'],
  billing: ['all', 'billable', 'non_billable'],
};

const emptySummary: ExecutiveSummaryResponse = {
  recordCount: 0,
  kpis: {
    applications: 0,
    flatsWorked: 0,
    totalArea: 0,
    executedArea: 0,
    clientValue: 0,
    labourCost: 0,
    materialCost: 0,
    netProfit: 0,
    profitMargin: 0,
    productivity: 0,
    labourDays: 0,
    flatsInProfit: 0,
    flatsInLoss: 0,
    nonBillableOperationalWork: 0,
    nonBillableEntries: 0,
    flatsBelow50Productivity: 0,
    flatsBelow60Productivity: 0,
    flatsWithLayersToBook: 0,
    targetBookedDays: 0,
    actualBookedTargetedDays: 0,
    bookedVsTarget: 0,
    bookedTargetUsePct: 0,
    untargetedDays: 0,
    labourValueGap: 0,
  },
  applicationSummary: [],
  flatSummary: [],
  dailyProfitTrend: [],
  dateTimeline: [],
  trendAnalysis: { availableMonths: [], rows: [] },
  budgetCostControl: {
    applicationSummary: [],
    flatDrilldownRows: [],
    trendRows: [],
  },
};

type CostSpineInput = {
  labour: number;
  material: number;
  revenue: number;
  netProfit: number;
};

type AnalyticsTabId =
  | 'executive'
  | 'flats'
  | 'trend'
  | 'targets'
  | 'timeline'
  | 'pl'
  | 'productivity'
  | 'cost'
  | 'budget';

type AnalyticsNavTabId = AnalyticsTabId | 'report' | 'review';

const ANALYTICS_PREFETCH_ORDER: AnalyticsTabId[] = [
  'executive',
  'targets',
  'timeline',
  'pl',
  'productivity',
  'cost',
  'flats',
  'trend',
  'budget',
];

function analyticsSectionCacheKey(
  projectId: string,
  section: string,
  filters: ExecutiveSummaryFilters,
) {
  const ordered = {
    block: filters.block || '',
    application: filters.application || '',
    flat: filters.flat || '',
    workLayer: filters.workLayer || '',
    from: filters.from || '',
    to: filters.to || '',
    profitability: filters.profitability || 'all',
    billing: filters.billing || 'all',
    search: filters.search || '',
  };

  return `${projectId}::${section}::${JSON.stringify(ordered)}`;
}

function normalizeAnalyticsSummary(
  summaryData: ExecutiveSummaryResponse,
): ExecutiveSummaryResponse {
  return {
    ...emptySummary,
    ...summaryData,
    kpis: {
      ...emptySummary.kpis,
      ...summaryData.kpis,
    },
    applicationSummary: summaryData.applicationSummary || [],
    flatSummary: summaryData.flatSummary || [],
    dailyProfitTrend: summaryData.dailyProfitTrend || [],
    dateTimeline: summaryData.dateTimeline || [],
    trendAnalysis: summaryData.trendAnalysis || emptySummary.trendAnalysis,
    budgetCostControl:
      summaryData.budgetCostControl || emptySummary.budgetCostControl,
  };
}

function formatNumber(value: number) {
  return Math.round(Number(value) || 0).toLocaleString('en-IN');
}

function formatDecimal(value: number, digits = 1) {
  const numberValue = Number(value) || 0;
  return numberValue.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCurrency(value: number) {
  const numberValue = Math.round(Number(value) || 0);
  const sign = numberValue < 0 ? '-' : '';
  return `${sign}₹${Math.abs(numberValue).toLocaleString('en-IN')}`;
}

function formatCurrencyOrDash(value: number) {
  const numberValue = Math.round(Number(value) || 0);
  return numberValue === 0 ? '—' : formatCurrency(numberValue);
}

function formatMoneyPerSqft(value: number) {
  const numberValue = Number(value) || 0;
  const sign = numberValue < 0 ? '-' : '';
  return `${sign}₹${Math.abs(numberValue).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`;
}


function parseMultiValue(value?: string) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.toLowerCase() !== 'all');
}

function multiValueLabel(value?: string, emptyLabel = 'All') {
  const values = parseMultiValue(value);
  if (values.length === 0) return emptyLabel;
  if (values.length === 1) return values[0];
  return `${values.length} selected`;
}

function filterButtonLabel(label: string, value?: string) {
  const values = parseMultiValue(value);
  if (values.length === 0) return label;
  if (values.length === 1) return values[0];
  return `${values.length} selected`;
}

function joinMultiValue(values: string[]) {
  return values
    .map((item) => item.trim())
    .filter(Boolean)
    .join(',');
}

function normalizeFilterValue(value: string) {
  return String(value || '').trim().toLowerCase();
}

function matchesSelectedFilter(value: string, selectedValues: string[]) {
  if (!selectedValues.length) return true;
  const normalizedValue = normalizeFilterValue(value);
  return selectedValues.some((selected) => normalizeFilterValue(selected) === normalizedValue);
}

function uniqueSortedValues(values: string[], fallbackValues: string[] = []) {
  const map = new Map<string, string>();

  [...values, ...fallbackValues].forEach((value) => {
    const label = String(value || '').trim();
    if (!label) return;
    const key = normalizeFilterValue(label);
    if (!map.has(key)) map.set(key, label);
  });

  return Array.from(map.values()).sort(naturalCompare);
}

function keepValidMultiValue(value: string | undefined, validValues: string[]) {
  const validSet = new Set(validValues.map(normalizeFilterValue));
  return joinMultiValue(
    parseMultiValue(value).filter((item) => validSet.has(normalizeFilterValue(item))),
  );
}

function toMultiSelectOptions(values: string[]) {
  return values.map((item) => ({ label: item, value: item }));
}

type MultiSelectOption = { label: string; value: string };

function SearchableMultiSelect({
  filterKey,
  label,
  value,
  options,
  allLabel,
  onChange,
  onApply,
  openFilterKey,
  setOpenFilterKey,
  className = '',
}: {
  filterKey: string;
  label: string;
  value?: string;
  options: MultiSelectOption[];
  allLabel: string;
  onChange: (value: string) => void;
  onApply: () => void;
  openFilterKey: string | null;
  setOpenFilterKey: Dispatch<SetStateAction<string | null>>;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const open = openFilterKey === filterKey;
  const selectedValues = parseMultiValue(value);
  const selectedSet = new Set(selectedValues);
  const panelId = `aph-multi-panel-${filterKey}`;

  const visibleOptions = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const visibleSelectedCount = visibleOptions.filter((option) => selectedSet.has(option.value)).length;
  const allVisibleSelected = visibleOptions.length > 0 && visibleSelectedCount === visibleOptions.length;

  function closeDropdown(returnFocus = false) {
    setOpenFilterKey((current) => (current === filterKey ? null : current));
    if (returnFocus) {
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
  }

  function updatePanelPosition() {
    const root = rootRef.current;
    const trigger = triggerRef.current;
    const panel = panelRef.current;

    if (!root || !trigger || !panel) return;

    const rootRect = root.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const safeGap = 10;

    let left = 0;
    const overflowRight = triggerRect.left + panelRect.width + safeGap - viewportWidth;

    if (overflowRight > 0) {
      left = Math.max(safeGap - rootRect.left, -overflowRight);
    }

    const spaceBelow = viewportHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    const shouldOpenUp = spaceBelow < panelRect.height + 12 && spaceAbove > spaceBelow;

    setPanelStyle(
      shouldOpenUp
        ? { left, top: 'auto', bottom: 'calc(100% + 6px)' }
        : { left, top: 'calc(100% + 6px)', bottom: 'auto' },
    );
  }

  function toggleOption(optionValue: string) {
    const next = new Set(selectedValues);
    if (next.has(optionValue)) next.delete(optionValue);
    else next.add(optionValue);
    onChange(joinMultiValue(Array.from(next)));
  }

  function toggleVisibleSelection() {
    const next = new Set(selectedValues);

    if (allVisibleSelected) {
      visibleOptions.forEach((option) => next.delete(option.value));
    } else {
      visibleOptions.forEach((option) => next.add(option.value));
    }

    onChange(joinMultiValue(Array.from(next)));
  }

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }

    const frame = window.requestAnimationFrame(updatePanelPosition);

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target)) return;
      closeDropdown(false);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeDropdown(true);
    }

    function handleScroll(event: Event) {
      const target = event.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      closeDropdown(false);
    }

    function handleResize() {
      closeDropdown(false);
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filterKey]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(updatePanelPosition);
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, visibleOptions.length]);

  return (
    <div ref={rootRef} className={`aph-field aph-multi-field ${className}`}>
      <span>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpenFilterKey((current) => (current === filterKey ? null : filterKey))}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpenFilterKey((current) => (current === filterKey ? null : filterKey));
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            closeDropdown(true);
          }
        }}
        className="aph-multi-button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={panelId}
        title={multiValueLabel(value, allLabel)}
      >
        <span className="aph-multi-button-main">
          <span className="aph-multi-button-label">{filterButtonLabel(label, value)}</span>
        </span>
        <span className="aph-multi-button-state" aria-hidden="true">
          {selectedValues.length > 0 && <span className="aph-multi-count">{selectedValues.length}</span>}
          <span className={open ? 'aph-multi-chevron aph-multi-chevron-open' : 'aph-multi-chevron'}>▾</span>
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className="aph-multi-panel"
          style={panelStyle}
          role="listbox"
          aria-label={label}
        >
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the list"
            className="aph-multi-search"
            autoComplete="off"
          />

          <div className="aph-multi-options">
            {visibleOptions.length > 0 && (
              <label
                className={allVisibleSelected ? 'aph-multi-option aph-multi-option-selected' : 'aph-multi-option'}
              >
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected;
                  }}
                  onChange={toggleVisibleSelection}
                />
                <span>Select all</span>
              </label>
            )}

            {visibleOptions.map((option) => {
              const selected = selectedSet.has(option.value);
              return (
                <label
                  key={option.value}
                  className={selected ? 'aph-multi-option aph-multi-option-selected' : 'aph-multi-option'}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleOption(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}

            {visibleOptions.length === 0 && (
              <p className="px-2 py-3 text-xs text-slate-500">No options found.</p>
            )}
          </div>

          <div className="aph-multi-footer">
            <button type="button" onClick={() => onChange('')} disabled={selectedValues.length === 0}>Clear</button>
            <button
              type="button"
              onClick={() => {
                closeDropdown(true);
                onApply();
              }}
              className="aph-multi-add-btn"
            >
              Apply filter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


type CsvCell = string | number | null | undefined;

function slugForFileName(value: string) {
  const slug = String(value || 'analytics-table')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return slug || 'analytics-table';
}

function csvEscape(value: CsvCell) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function cleanCsvNumber(value: string) {
  const text = String(value || '').trim();
  if (!text || text === '—') return '';

  const noComma = text.replace(/,/g, '').replace(/\s+/g, '');
  const currencyMatch = noComma.match(/^(-?)₹(-?\d+(?:\.\d+)?)$/);
  if (currencyMatch) return `${currencyMatch[1]}${currencyMatch[2]}`;

  const percentMatch = noComma.match(/^(-?\d+(?:\.\d+)?)%$/);
  if (percentMatch) return percentMatch[1];

  const plainNumberMatch = noComma.match(/^-?\d+(?:\.\d+)?$/);
  if (plainNumberMatch) return noComma;

  return text;
}

function tableToCsv(table: HTMLTableElement) {
  const headerCells = Array.from(table.querySelectorAll('thead th'));
  const headers = headerCells.map((cell) =>
    String(cell.textContent || '')
      .replace(/[▲▼]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );

  const rows = Array.from(table.querySelectorAll('tbody tr'))
    .filter((row) => !row.querySelector('td[colspan]'))
    .map((row) =>
      Array.from(row.querySelectorAll('td')).map((cell, cellIndex) => {
        const clone = cell.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('button, svg').forEach((node) => node.remove());
        const text = String(clone.textContent || '').replace(/\s+/g, ' ').trim();
        return cellIndex === 0 ? text : cleanCsvNumber(text);
      }),
    );

  return [headers, ...rows]
    .map((row) => row.map((value) => csvEscape(value)).join(','))
    .join('\r\n');
}

function downloadCsvText(filename: string, csvText: string) {
  const blob = new Blob([`\ufeff${csvText}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function installStickyTableShells(root: HTMLElement) {
  const tables = Array.from(root.querySelectorAll('table')) as HTMLTableElement[];

  tables.forEach((table) => {
    table.classList.add('aph-freeze-table');

    const host = table.parentElement as HTMLElement | null;
    if (!host) return;

    host.classList.add('aph-table-scroll');
  });
}

function installCsvDownloads(root: HTMLElement, activeTab: string) {
  installStickyTableShells(root);

  const tables = Array.from(root.querySelectorAll('table')) as HTMLTableElement[];

  tables.forEach((table, index) => {
    const host = table.parentElement;
    if (!host) return;

    host.classList.add('aph-table-scroll');

    if (host.dataset.zosCsvReady === 'true') return;

    const validRows = Array.from(table.querySelectorAll('tbody tr')).filter(
      (row) => !row.querySelector('td[colspan]'),
    ).length;
    if (!validRows) return;

    host.dataset.zosCsvReady = 'true';

    const section = table.closest('section');
    const sectionTitle =
      section?.querySelector('h2')?.textContent?.trim() ||
      table.closest('[data-csv-title]')?.getAttribute('data-csv-title') ||
      activeTab;

    const footer = document.createElement('div');
    footer.className =
      'zos-table-csv-footer flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500';

    const rowText = document.createElement('span');
    rowText.className = 'font-mono';
    rowText.textContent = `${validRows.toLocaleString('en-IN')} row${validRows === 1 ? '' : 's'}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className =
      'ml-auto rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-orange-400 hover:text-orange-600';
    button.textContent = 'Download CSV';

    button.addEventListener('click', () => {
      const csv = tableToCsv(table);
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `zos-${slugForFileName(activeTab)}-${slugForFileName(
        sectionTitle || 'table',
      )}-${index + 1}-${stamp}.csv`;
      downloadCsvText(filename, csv);
    });

    footer.appendChild(rowText);
    footer.appendChild(button);
    host.insertAdjacentElement('afterend', footer);
  });
}


function safeDivide(numerator: number, denominator: number) {
  const den = Number(denominator) || 0;
  if (den === 0) return 0;
  return (Number(numerator) || 0) / den;
}

function profitClass(value: number) {
  if (value > 0) return 'text-emerald-700';
  if (value < 0) return 'text-red-700';
  return 'text-slate-900';
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/**
 * Analytics layer classification rule.
 *
 * Billable layers:
 * - 1st Coat Putty
 * - 2nd Coat Putty
 * - 1st Coat Primer
 * - 2nd Coat Primer
 * - 1st Coat Paint
 * - 2nd Coat Paint
 *
 * Every other layer is treated as operational (OPS) for Analytics UI/table
 * classification. Matching is case-insensitive and whitespace-normalized.
 */
const ANALYTICS_BILLABLE_LAYER_NAMES = new Set([
  '1st coat putty',
  '2nd coat putty',
  '1st coat primer',
  '2nd coat primer',
  '1st coat paint',
  '2nd coat paint',
]);

function normalizeAnalyticsLayerName(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isAnalyticsBillableLayer(workLayer: string | null | undefined) {
  return ANALYTICS_BILLABLE_LAYER_NAMES.has(normalizeAnalyticsLayerName(workLayer));
}

function layerOrderValue(row: { layerOrder?: number; workLayer?: string }) {
  const value = Number(row.layerOrder);
  return Number.isFinite(value) && value >= 0 ? value : 999;
}

function compareLayerOrder(
  a: { layerOrder?: number; workLayer?: string },
  b: { layerOrder?: number; workLayer?: string },
) {
  const orderCompare = layerOrderValue(a) - layerOrderValue(b);
  if (orderCompare) return orderCompare;
  return naturalCompare(a.workLayer || '', b.workLayer || '');
}

function floorLabel(flatId: string) {
  const matches = String(flatId || '').match(/\d+/g);
  if (!matches?.length) return '';

  const lastNumber = matches[matches.length - 1];
  if (lastNumber.length < 3) return '';

  const floor = Number(lastNumber.slice(0, lastNumber.length - 2));
  if (!Number.isFinite(floor)) return '';

  return `F${floor}`;
}

function KpiCard({
  label,
  value,
  sub,
  valueClassName = '',
}: {
  label: string;
  value: string;
  sub: string;
  valueClassName?: string;
}) {
  return (
    <div className="border border-slate-200 bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 font-mono text-2xl font-semibold text-slate-950 ${valueClassName}`}
      >
        {value}
      </p>
      <p className="mt-1 font-mono text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

function CostVsRevenueSpine({ labour, material, revenue, netProfit }: CostSpineInput) {
  const totalCost = Math.max(0, Number(labour || 0) + Number(material || 0));
  const safeRevenue = Math.max(0, Number(revenue || 0));
  const base = Math.max(safeRevenue, totalCost, 1);

  const labourWidth = Math.min(100, (Math.max(0, Number(labour || 0)) / base) * 100);
  const materialWidth = Math.min(
    100,
    (Math.max(0, Number(material || 0)) / base) * 100,
  );
  const profitWidth = Math.max(0, (Math.max(0, Number(netProfit || 0)) / base) * 100);
  const overCostWidth = Math.max(0, ((totalCost - safeRevenue) / base) * 100);

  return (
    <div
      className="relative h-2 w-full min-w-[130px] overflow-hidden rounded-sm bg-slate-100"
      title={`Labour ${formatCurrency(labour)} · Material ${formatCurrency(
        material,
      )} · Revenue ${formatCurrency(revenue)} · Net profit ${formatCurrency(netProfit)}`}
    >
      <div className="flex h-full">
        <span className="h-full bg-blue-400" style={{ width: `${labourWidth}%` }} />
        <span className="h-full bg-orange-400" style={{ width: `${materialWidth}%` }} />
        <span className="h-full bg-emerald-600" style={{ width: `${profitWidth}%` }} />
      </div>
      {overCostWidth > 0 && (
        <span
          className="absolute right-0 top-0 h-full bg-red-500/80"
          style={{ width: `${overCostWidth}%` }}
        />
      )}
    </div>
  );
}


function targetVarianceClass(value: number) {
  if (value > 0) return 'text-red-600';
  if (value < 0) return 'text-emerald-600';
  return 'text-slate-500';
}

function targetUseClass(value: number) {
  if (value > 100) return 'text-red-600';
  if (value > 0) return 'text-emerald-600';
  return 'text-slate-500';
}

function TargetUseBar({ value }: { value: number }) {
  if (!Number.isFinite(value) || value <= 0) {
    return <span className="text-slate-400 dark:text-slate-500">—</span>;
  }

  const isOver = value > 100;
  const width = Math.min(value, 100);

  return (
    <div className="flex min-w-[112px] items-center justify-end gap-2">
      <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full ${isOver ? 'bg-red-600' : 'bg-emerald-600'}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={`min-w-[42px] text-right ${targetUseClass(value)}`}>
        {formatDecimal(value, 0)}%
      </span>
    </div>
  );
}

function bookedDaysValue(row: { bookedDays?: number; labourDays?: number }) {
  return Number(row.bookedDays || row.labourDays || 0);
}

function ApplicationSummaryTable({ rows }: { rows: ApplicationSummaryRow[] }) {
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-lg font-bold text-slate-950">Application summary</h2>
      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[2100px] border-collapse text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              {['Application','Flats','Entries','Area','Labour Days','Target / Flat','Target (Booked)','Actual (Booked)','VS Target','Target Use','Untargeted Days','Labour','Material','Revenue','Net Profit','Margin','Productivity','Profit / Sqft'].map((label, index) => (
                <th key={label} className={`border-b border-slate-200 px-3 py-3 font-semibold ${index === 0 ? 'text-left' : 'text-right'}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono text-slate-950">
            {rows.length === 0 ? (
              <tr><td colSpan={18} className="px-3 py-8 text-center text-sm text-slate-500">No application data found for the selected filters.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.application} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 text-left font-sans font-semibold">{row.application || 'Unassigned'}</td>
                <td className="px-3 py-2 text-right">{formatNumber(row.flats)}</td>
                <td className="px-3 py-2 text-right">{formatNumber(row.entries)}</td>
                <td className="px-3 py-2 text-right">{formatNumber(row.area)}</td>
                <td className="px-3 py-2 text-right">{formatDecimal(row.labourDays, 1)}</td>
                <td className="px-3 py-2 text-right">{row.targetPerFlat > 0 ? formatDecimal(row.targetPerFlat, 1) : '—'}</td>
                <td className="px-3 py-2 text-right">{row.targetBooked > 0 ? formatDecimal(row.targetBooked, 1) : '—'}</td>
                <td className="px-3 py-2 text-right">{row.actualBooked > 0 ? formatDecimal(row.actualBooked, 1) : '—'}</td>
                <td className={`px-3 py-2 text-right ${targetVarianceClass(row.bookedVsTarget)}`}>{row.targetBooked > 0 ? `${row.bookedVsTarget > 0 ? '+' : ''}${formatDecimal(row.bookedVsTarget, 1)}` : '—'}</td>
                <td className="px-3 py-2 text-right"><TargetUseBar value={row.bookedTargetUsePct} /></td>
                <td className="px-3 py-2 text-right">{row.untargetedDays > 0 ? formatDecimal(row.untargetedDays, 1) : '—'}</td>
                <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.labour)}</td>
                <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.material)}</td>
                <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.revenue)}</td>
                <td className={`px-3 py-2 text-right ${profitClass(row.netProfit)}`}>{formatCurrency(row.netProfit)}</td>
                <td className={`px-3 py-2 text-right ${profitClass(row.margin)}`}>{row.revenue > 0 ? `${formatDecimal(row.margin, 1)}%` : '—'}</td>
                <td className="px-3 py-2 text-right">{row.productivity > 0 ? formatNumber(row.productivity) : '—'}</td>
                <td className={`px-3 py-2 text-right ${profitClass(row.profitPerSqft)}`}>{row.area > 0 ? formatMoneyPerSqft(row.profitPerSqft) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type FlatBulkCommand = {
  id: number;
  open: boolean;
};

const FlatSummaryRowView = memo(function FlatSummaryRowView({
  row,
  bulkCommand,
  loadDetails,
}: {
  row: FlatSummaryRow;
  bulkCommand: FlatBulkCommand;
  loadDetails?: (row: FlatSummaryRow) => Promise<FlatSummaryRow['details']>;
}) {
  const key = `${row.application}__${row.flatId}`;
  const [isOpen, setIsOpen] = useState(false);
  const [detailRows, setDetailRows] = useState<FlatSummaryRow['details']>(row.details || []);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    requestRef.current += 1;
    setIsOpen(false);
    setIsLoadingDetails(false);
    setDetailRows(row.details || []);
  }, [row]);

  useEffect(() => {
    if (!bulkCommand.id) return;
    setIsOpen(bulkCommand.open);
  }, [bulkCommand]);

  const sortedDetails = useMemo(() => {
    if (!isOpen || !detailRows.length) return [];
    return [...detailRows].sort((a, b) => {
      const layerCompare = compareLayerOrder(a, b);
      if (layerCompare) return layerCompare;
      return String(a.workDate || '').localeCompare(String(b.workDate || ''));
    });
  }, [detailRows, isOpen]);

  const planRows = useMemo(() => {
    const map = new Map<string, {
      workLayer: string; layerOrder: number; isBillable: boolean; area: number; labourDays: number;
      targetDays: number; labour: number; material: number; revenue: number; profit: number; entries: number;
    }>();
    sortedDetails.forEach((detail) => {
      const k = normalizeAnalyticsLayerName(detail.workLayer) || detail.workLayer;
      const current = map.get(k) || {
        workLayer: detail.workLayer, layerOrder: layerOrderValue(detail), isBillable: isAnalyticsBillableLayer(detail.workLayer),
        area: 0, labourDays: 0, targetDays: 0, labour: 0, material: 0, revenue: 0, profit: 0, entries: 0,
      };
      current.layerOrder = Math.min(current.layerOrder, layerOrderValue(detail));
      current.targetDays = Math.max(current.targetDays, Number(detail.targetDays || 0));
      if (detail.workDate) {
        current.area += Number(detail.area || 0);
        current.labourDays += bookedDaysValue(detail);
        current.labour += Number(detail.labour || 0);
        current.material += Number(detail.material || 0);
        current.revenue += Number(detail.revenue || 0);
        current.profit += Number(detail.profit || 0);
        current.entries += Math.max(1, Number(detail.entries || 0));
      }
      map.set(k, current);
    });
    return [...map.values()].sort(compareLayerOrder);
  }, [sortedDetails]);

  const historyRows = useMemo(
    () => sortedDetails.filter((detail) => Boolean(detail.workDate)),
    [sortedDetails],
  );

  const historyRowsAnnotated = useMemo(() => {
    const seen = new Set<string>();
    return historyRows.map((detail) => {
      const layerKey = normalizeAnalyticsLayerName(detail.workLayer);
      const firstForLayer = !seen.has(layerKey);
      seen.add(layerKey);
      return { detail, firstForLayer };
    });
  }, [historyRows]);

  const toggle = useCallback(() => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen && loadDetails && !(row.details || []).length && !detailRows.length && !isLoadingDetails) {
      const requestId = ++requestRef.current;
      setIsLoadingDetails(true);
      void loadDetails(row)
        .then((details) => { if (requestId === requestRef.current) setDetailRows(details || []); })
        .finally(() => { if (requestId === requestRef.current) setIsLoadingDetails(false); });
    }
  }, [detailRows.length, isLoadingDetails, isOpen, loadDetails, row]);

  const targetBooked = Number(row.targetBooked || 0);
  const actualBooked = Number(row.actualBooked || 0);
  const bookedVariance = Number(row.bookedVsTarget || (actualBooked - targetBooked));
  const bookedUse = Number(row.bookedTargetUsePct || (targetBooked > 0 ? actualBooked * 100 / targetBooked : 0));

  return (
    <>
      <tr onClick={toggle} className="cursor-pointer border-b border-slate-100 bg-white hover:bg-slate-50">
        <td className="px-3 py-3 text-left font-sans font-bold">
          <span className="mr-2 text-blue-400">{isOpen ? '▼' : '▶'}</span>{row.flatId || '-'}
          {floorLabel(row.flatId) && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{floorLabel(row.flatId)}</span>}
        </td>
        <td className="px-3 py-3 text-left"><CostVsRevenueSpine labour={row.labour} material={row.material} revenue={row.revenue} netProfit={row.netProfit} /></td>
        <td className="px-3 py-3 text-right font-bold">{formatNumber(row.area)}</td>
        <td className="px-3 py-3 text-right font-bold">{actualBooked > 0 ? formatDecimal(actualBooked, 1) : '—'}</td>
        <td className="px-3 py-3 text-right font-bold">{targetBooked > 0 ? formatDecimal(targetBooked, 1) : '—'}</td>
        <td className={`px-3 py-3 text-right font-bold ${targetVarianceClass(bookedVariance)}`}>{targetBooked > 0 ? `${bookedVariance > 0 ? '+' : ''}${formatDecimal(bookedVariance, 1)}` : '—'}</td>
        <td className="px-3 py-3 text-right font-bold"><TargetUseBar value={bookedUse} /></td>
        <td className="px-3 py-3 text-right font-bold">{formatCurrency(row.labour)}</td>
        <td className="px-3 py-3 text-right font-bold">{formatCurrency(row.material)}</td>
        <td className="px-3 py-3 text-right font-bold">{formatCurrency(row.revenue)}</td>
        <td className={`px-3 py-3 text-right font-bold ${profitClass(row.netProfit)}`}>{formatCurrency(row.netProfit)}</td>
        <td className={`px-3 py-3 text-right font-bold ${profitClass(row.margin)}`}>{formatDecimal(row.margin, 1)}%</td>
        <td className="px-3 py-3 text-right font-bold">{row.productivity > 0 ? formatNumber(row.productivity) : '—'}</td>
        <td className="px-3 py-3 text-right font-bold">{formatNumber(row.entryCount || row.entries || 0)}</td>
        <td className="px-3 py-3 text-right font-bold">{formatNumber(row.bookedLayers)}/{formatNumber(row.totalLayers)}{row.bookedLayers < row.totalLayers && <span className="ml-2 rounded bg-orange-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase text-orange-700">Open</span>}</td>
      </tr>

      {isOpen && isLoadingDetails && <tr><td colSpan={15} className="px-3 py-3 pl-8 text-sm text-slate-500">Loading flat details…</td></tr>}

      {isOpen && !isLoadingDetails && (
        <>
          <tr className="bg-slate-100 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <td colSpan={15} className="px-3 py-2 pl-8 text-left font-bold">Layer plan · every planned layer, including work not started</td>
          </tr>
          <tr className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-400">
            <td className="px-3 py-2 pl-8 text-left">Work layer</td><td className="px-3 py-2 text-left">Status</td><td className="px-3 py-2 text-right">Area</td>
            <td className="px-3 py-2 text-right">Actual days</td><td className="px-3 py-2 text-right">Target</td><td className="px-3 py-2 text-right">Variance</td><td className="px-3 py-2 text-right">Target use</td>
            <td className="px-3 py-2 text-right">Labour</td><td className="px-3 py-2 text-right">Material</td><td className="px-3 py-2 text-right">Revenue</td><td className="px-3 py-2 text-right">Profit</td><td className="px-3 py-2 text-right">Margin</td><td className="px-3 py-2 text-right">Productivity</td><td className="px-3 py-2 text-right">Entries</td><td />
          </tr>
          {planRows.map((plan) => {
            const variance = plan.labourDays - plan.targetDays;
            const use = plan.targetDays > 0 ? plan.labourDays * 100 / plan.targetDays : 0;
            const margin = plan.revenue > 0 ? plan.profit * 100 / plan.revenue : 0;
            const status = plan.targetDays <= 0 ? 'No target' : plan.labourDays <= 0 ? 'To start' : use > 100.5 ? 'Over' : use < 99.5 ? 'Under' : 'On target';
            return <tr key={`${key}-plan-${plan.workLayer}`} className="border-b border-slate-100 bg-slate-50/40 text-slate-700">
              <td className="px-3 py-2 pl-8 text-left font-sans">{plan.workLayer}{!plan.isBillable && <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-orange-700">Ops</span>}</td>
              <td className="px-3 py-2 text-left font-sans"><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${status === 'Over' ? 'bg-red-50 text-red-700' : status === 'Under' ? 'bg-emerald-50 text-emerald-700' : status === 'To start' ? 'bg-slate-100 text-slate-500' : status === 'No target' ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'}`}>{status}</span></td>
              <td className="px-3 py-2 text-right">{plan.area > 0 ? formatNumber(plan.area) : '—'}</td>
              <td className="px-3 py-2 text-right">{plan.labourDays > 0 ? formatDecimal(plan.labourDays, 1) : '—'}</td>
              <td className="px-3 py-2 text-right">{plan.targetDays > 0 ? formatDecimal(plan.targetDays, 1) : '—'}</td>
              <td className={`px-3 py-2 text-right ${targetVarianceClass(variance)}`}>{plan.targetDays > 0 ? `${variance > 0 ? '+' : ''}${formatDecimal(variance, 1)}` : '—'}</td>
              <td className="px-3 py-2 text-right"><TargetUseBar value={use} /></td>
              <td className="px-3 py-2 text-right">{formatCurrencyOrDash(plan.labour)}</td><td className="px-3 py-2 text-right">{formatCurrencyOrDash(plan.material)}</td><td className="px-3 py-2 text-right">{formatCurrencyOrDash(plan.revenue)}</td>
              <td className={`px-3 py-2 text-right ${profitClass(plan.profit)}`}>{formatCurrency(plan.profit)}</td><td className={`px-3 py-2 text-right ${profitClass(margin)}`}>{plan.revenue > 0 ? `${formatDecimal(margin, 1)}%` : '—'}</td>
              <td className="px-3 py-2 text-right">{plan.labourDays > 0 && plan.area > 0 ? formatNumber(plan.area / plan.labourDays) : '—'}</td><td className="px-3 py-2 text-right">{plan.entries || '—'}</td><td />
            </tr>;
          })}
          <tr className="border-b border-slate-200 bg-slate-100 font-mono font-bold text-slate-900">
            <td className="px-3 py-2 pl-8 text-left font-sans">Flat budget total</td><td /><td className="px-3 py-2 text-right">{formatNumber(row.area)}</td><td className="px-3 py-2 text-right">{actualBooked > 0 ? formatDecimal(actualBooked,1) : '—'}</td><td className="px-3 py-2 text-right">{row.targetPerFlat > 0 ? formatDecimal(row.targetPerFlat,1) : '—'}</td><td className={`px-3 py-2 text-right ${targetVarianceClass(bookedVariance)}`}>{targetBooked > 0 ? `${bookedVariance > 0 ? '+' : ''}${formatDecimal(bookedVariance,1)}` : '—'}</td><td className="px-3 py-2 text-right"><TargetUseBar value={bookedUse}/></td><td className="px-3 py-2 text-right">{formatCurrency(row.labour)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.material)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.revenue)}</td><td className={`px-3 py-2 text-right ${profitClass(row.netProfit)}`}>{formatCurrency(row.netProfit)}</td><td className={`px-3 py-2 text-right ${profitClass(row.margin)}`}>{formatDecimal(row.margin,1)}%</td><td className="px-3 py-2 text-right">{row.productivity > 0 ? formatNumber(row.productivity) : '—'}</td><td className="px-3 py-2 text-right">{row.entryCount || row.entries || '—'}</td><td />
          </tr>

          <tr className="bg-slate-100 text-[10px] uppercase tracking-[0.14em] text-slate-500"><td colSpan={15} className="px-3 py-2 pl-8 text-left font-bold">Work history by date</td></tr>
          <tr className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-400">
            <td className="px-3 py-2 pl-8 text-left">Date</td><td className="px-3 py-2 text-left">Work layer</td><td className="px-3 py-2 text-right">Area</td><td className="px-3 py-2 text-right">Labour days</td><td className="px-3 py-2 text-right">Layer target</td><td /><td /><td className="px-3 py-2 text-right">Labour</td><td className="px-3 py-2 text-right">Material</td><td className="px-3 py-2 text-right">Revenue</td><td className="px-3 py-2 text-right">Profit</td><td className="px-3 py-2 text-right">Margin</td><td className="px-3 py-2 text-right">Productivity</td><td /><td />
          </tr>
          {historyRowsAnnotated.map(({ detail, firstForLayer }, index) => <tr key={`${key}-hist-${detail.workDate}-${detail.workLayer}-${index}`} className="border-b border-slate-100 bg-white text-slate-700">
            <td className="px-3 py-2 pl-8 text-left">{shortDateLabel(detail.workDate)}</td><td className="px-3 py-2 text-left font-sans">{detail.workLayer}{!isAnalyticsBillableLayer(detail.workLayer) && <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-orange-700">Ops</span>}{detail.targetDays <= 0 && <span className="ml-2 rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-orange-700">No target</span>}{detail.materialNames ? <span className="block text-[10px] text-slate-400">{detail.materialNames}</span> : null}</td>
            <td className="px-3 py-2 text-right">{formatNumber(detail.area)}</td><td className="px-3 py-2 text-right">{bookedDaysValue(detail) > 0 ? formatDecimal(bookedDaysValue(detail),1) : '—'}</td><td className="px-3 py-2 text-right">{detail.targetDays > 0 ? (firstForLayer ? formatDecimal(detail.targetDays,1) : '↳') : '—'}</td><td /><td /><td className="px-3 py-2 text-right">{formatCurrencyOrDash(detail.labour)}</td><td className="px-3 py-2 text-right">{formatCurrencyOrDash(detail.material)}</td><td className="px-3 py-2 text-right">{formatCurrencyOrDash(detail.revenue)}</td><td className={`px-3 py-2 text-right ${profitClass(detail.profit)}`}>{formatCurrency(detail.profit)}</td><td className={`px-3 py-2 text-right ${profitClass(detail.margin)}`}>{detail.revenue > 0 ? `${formatDecimal(detail.margin,1)}%` : '—'}</td><td className="px-3 py-2 text-right">{detail.productivity > 0 ? formatNumber(detail.productivity) : '—'}</td><td /><td />
          </tr>)}
          {historyRows.length === 0 && <tr><td colSpan={15} className="px-3 py-3 pl-8 text-sm text-slate-500">No work-history entries for this flat yet.</td></tr>}
        </>
      )}
    </>
  );
});

function FlatSummaryTable({
  rows,
  heading = 'Flat-wise analysis',
  sub = 'Application wise flat summary from the same filtered analytics source.',
  showControls = true,
  loadDetails,
}: {
  rows: FlatSummaryRow[];
  heading?: string;
  sub?: string;
  showControls?: boolean;
  loadDetails?: (row: FlatSummaryRow) => Promise<FlatSummaryRow['details']>;
}) {
  const [bulkCommand, setBulkCommand] = useState<FlatBulkCommand>({
    id: 0,
    open: false,
  });

  const groupedRows = useMemo(() => {
    const map = new Map<string, FlatSummaryRow[]>();

    rows.forEach((row) => {
      const application = row.application || 'Unassigned';
      const current = map.get(application) || [];
      current.push(row);
      map.set(application, current);
    });

    return Array.from(map.entries())
      .sort(([a], [b]) => naturalCompare(a, b))
      .map(([application, items]) => ({
        application,
        items: items.sort((a, b) => naturalCompare(a.flatId, b.flatId)),
        totals: items.reduce(
          (acc, item) => ({
            area: acc.area + item.area,
            labourDays: acc.labourDays + item.labourDays,
            bookedDays: acc.bookedDays + bookedDaysValue(item),
            targetDays: acc.targetDays + Number(item.targetDays || 0),
            targetBooked: acc.targetBooked + Number(item.targetBooked || 0),
            actualBooked: acc.actualBooked + Number(item.actualBooked || 0),
            untargetedDays: acc.untargetedDays + Number(item.untargetedDays || 0),
            labourValueGap: acc.labourValueGap + Number(item.labourValueGap || 0),
            entries: acc.entries + Number(item.entryCount || item.entries || 0),
            labour: acc.labour + item.labour,
            material: acc.material + item.material,
            revenue: acc.revenue + item.revenue,
            netProfit: acc.netProfit + item.netProfit,
          }),
          { area: 0, labourDays: 0, bookedDays: 0, targetDays: 0, targetBooked: 0, actualBooked: 0, untargetedDays: 0, labourValueGap: 0, entries: 0, labour: 0, material: 0, revenue: 0, netProfit: 0 },
        ),
      }));
  }, [rows]);

  function openAllFlats() {
    setBulkCommand((current) => ({ id: current.id + 1, open: true }));
  }

  function closeAllFlats() {
    setBulkCommand((current) => ({ id: current.id + 1, open: false }));
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">{heading}</h2>
          <p className="text-sm text-slate-500">{sub}</p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <i className="h-2.5 w-2.5 rounded-sm bg-blue-400" /> Labour
          </span>
          <span className="flex items-center gap-1">
            <i className="h-2.5 w-2.5 rounded-sm bg-orange-400" /> Material
          </span>
          <span className="flex items-center gap-1">
            <i className="h-2.5 w-2.5 rounded-sm bg-emerald-600" /> Profit
          </span>
          <span className="flex items-center gap-1">
            <i className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Cost above revenue
          </span>
        </div>
      </div>

      {showControls && rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={openAllFlats}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-slate-600 hover:border-orange-400"
          >
            Open all flats
          </button>
          <button
            type="button"
            onClick={closeAllFlats}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-slate-600 hover:border-orange-400"
          >
            Close all
          </button>
          <span className="text-slate-500">
            Click any flat to see date-reported layer calculations.
          </span>
        </div>
      )}

      {groupedRows.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No flat summary data found for the selected filters.
        </div>
      ) : (
        <div className="space-y-5">
          {groupedRows.map((group) => {
            const cost = group.totals.labour + group.totals.material;
            const margin =
              group.totals.revenue > 0
                ? (group.totals.netProfit * 100) / group.totals.revenue
                : 0;

            return (
              <div
                key={group.application}
                className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 px-4 py-3">
                  <h3 className="font-bold text-slate-950">{group.application}</h3>
                  <span className="font-mono text-xs text-slate-500">
                    {formatNumber(group.items.length)} flats · {formatNumber(group.totals.entries)} entries
                  </span>
                  <div className="ml-auto flex flex-wrap gap-4 font-mono text-xs text-slate-500">
                    <span>
                      Area <b className="text-slate-950">{formatNumber(group.totals.area)}</b>
                    </span>
                    <span>
                      Revenue{' '}
                      <b className="text-slate-950">{formatCurrency(group.totals.revenue)}</b>
                    </span>
                    <span>
                      Cost <b className="text-slate-950">{formatCurrency(cost)}</b>
                    </span>
                    <span>
                      Profit{' '}
                      <b className={profitClass(group.totals.netProfit)}>
                        {formatCurrency(group.totals.netProfit)}
                      </b>
                    </span>
                    <span>
                      Margin{' '}
                      <b className={profitClass(margin)}>{formatDecimal(margin, 1)}%</b>
                    </span>
                  </div>
                </div>
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-mono text-[11px] text-slate-500">
                  Target / flat <b className="text-slate-950">{group.items[0]?.targetPerFlat > 0 ? formatDecimal(group.items[0].targetPerFlat, 1) : '—'}</b> · Target booked <b className="text-slate-950">{group.totals.targetBooked > 0 ? formatDecimal(group.totals.targetBooked, 1) : '—'}</b> · Actual on targeted layers <b className="text-slate-950">{group.totals.actualBooked > 0 ? formatDecimal(group.totals.actualBooked, 1) : '—'}</b> · Vs target <b className={targetVarianceClass(group.totals.actualBooked - group.totals.targetBooked)}>{group.totals.targetBooked > 0 ? `${group.totals.actualBooked - group.totals.targetBooked > 0 ? '+' : ''}${formatDecimal(group.totals.actualBooked - group.totals.targetBooked, 1)} d` : '—'}</b> · Labour value of gap <b className={profitClass(-group.totals.labourValueGap)}>{formatCurrency(group.totals.labourValueGap)}</b> · Untargeted labour <b className="text-slate-950">{group.totals.untargetedDays > 0 ? `${formatDecimal(group.totals.untargetedDays, 1)} d` : '—'}</b>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1580px] border-collapse text-sm">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      <tr>
                        <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold">
                          Flat ▲
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold">
                          Cost vs Revenue
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">
                          Area
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">
                          Booked Days
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">
                          Target (Booked)
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">
                          VS Target
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">
                          Target Use
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">
                          Labour
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">
                          Material
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">
                          Revenue
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">
                          Net Profit
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">
                          Margin
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">
                          Productivity
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">
                          Entries
                        </th>
                        <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">
                          Layers Booked
                        </th>
                      </tr>
                    </thead>

                    <tbody className="font-mono text-slate-950">
                      {group.items.map((row) => (
                        <FlatSummaryRowView
                          key={`${row.application}__${row.flatId}`}
                          row={row}
                          bulkCommand={bulkCommand}
                          loadDetails={loadDetails}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function shortDateLabel(value: string) {
  if (!value) return '-';

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });
}

function ProfitByFlatChart({ rows }: { rows: FlatSummaryRow[] }) {
  const chartRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => b.netProfit - a.netProfit);
    const best = sorted.slice(0, 8);
    const worst = [...sorted]
      .reverse()
      .filter((row) => row.netProfit < 0)
      .slice(0, 5);

    const seen = new Set<string>();

    return [...best, ...worst]
      .filter((row) => {
        const key = `${row.application}__${row.flatId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((row) => ({
        label: `${row.application} · ${row.flatId}`,
        value: row.netProfit,
        labourDays: bookedDaysValue(row),
      }));
  }, [rows]);

  const maxValue = Math.max(1, ...chartRows.map((row) => Math.abs(row.value)));

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-950">Profit by flat</h3>
        <span className="font-mono text-[11px] text-slate-500">best 8 · worst 5</span>
      </div>

      {chartRows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">No flat profit data found.</div>
      ) : (
        <div className="space-y-2">
          {chartRows.map((row) => {
            const width = Math.min(50, (Math.abs(row.value) / maxValue) * 50);

            return (
              <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_132px_120px] items-center gap-3 text-sm">
                <div className="truncate font-medium text-slate-950" title={row.label}>
                  {row.label}
                </div>
                <div className="relative h-4 overflow-hidden rounded-sm bg-slate-100">
                  <span className="absolute left-1/2 top-0 h-full w-px bg-red-300" />
                  <span
                    className={`absolute top-0 h-full rounded-sm ${
                      row.value >= 0 ? 'bg-emerald-600' : 'bg-red-500'
                    }`}
                    style={
                      row.value >= 0
                        ? { left: '50%', width: `${width}%` }
                        : { left: `${50 - width}%`, width: `${width}%` }
                    }
                  />
                </div>
                <div className="text-right font-mono leading-4">
                  <div className={profitClass(row.value)}>{formatCurrency(row.value)}</div>
                  <div className="text-[10px] text-slate-500">
                    {formatDecimal(row.labourDays, 1)} labour days
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RevenueSplitByApplicationChart({ rows }: { rows: ApplicationSummaryRow[] }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-950">Revenue split by application</h3>
        <span className="font-mono text-[11px] text-slate-500">
          labour · material · profit · cost above revenue
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">No application revenue data found.</div>
      ) : (
        <div className="space-y-3">
          {[...rows].sort((a, b) => naturalCompare(a.application, b.application)).map((row) => {
            const totalCost = Math.max(0, row.labour + row.material);
            const base = Math.max(row.revenue, totalCost, 1);
            const labourWidth = Math.max(0, (row.labour / base) * 100);
            const materialWidth = Math.max(0, (row.material / base) * 100);
            const profitValue = Math.max(row.netProfit, 0);
            const costAboveRevenue = Math.max(totalCost - row.revenue, 0);
            const profitWidth = Math.max(0, (profitValue / base) * 100);
            const uncoveredWidth = Math.max(0, (costAboveRevenue / base) * 100);

            return (
              <div
                key={row.application}
                className="grid grid-cols-[150px_minmax(120px,1fr)_minmax(240px,auto)] items-center gap-3 text-sm"
              >
                <div className="truncate font-medium text-slate-950" title={row.application}>
                  {row.application || '-'}
                </div>

                <div
                  className="flex h-4 overflow-hidden rounded-sm bg-slate-100"
                  title={`Labour ${formatCurrency(row.labour)} · Material ${formatCurrency(
                    row.material,
                  )} · Profit ${formatCurrency(profitValue)} · Cost above revenue ${formatCurrency(
                    costAboveRevenue,
                  )} · Labour days ${formatDecimal(row.labourDays, 1)}`}
                >
                  <span className="h-full bg-blue-400" style={{ width: `${labourWidth}%` }} />
                  <span className="h-full bg-orange-400" style={{ width: `${materialWidth}%` }} />
                  <span className="h-full bg-emerald-600" style={{ width: `${profitWidth}%` }} />
                  <span className="h-full bg-red-500" style={{ width: `${uncoveredWidth}%` }} />
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] leading-4 text-slate-600">
                  <span className="whitespace-nowrap">
                    <span className="text-blue-600">Labour</span> {formatCurrency(row.labour)}
                  </span>
                  <span className="whitespace-nowrap">
                    <span className="text-orange-600">Material</span> {formatCurrency(row.material)}
                  </span>
                  <span className="whitespace-nowrap">
                    <span className="text-emerald-700">Profit</span> {formatCurrency(profitValue)}
                  </span>
                  <span className="whitespace-nowrap">
                    <span className="text-red-600">Cost above</span> {formatCurrency(costAboveRevenue)}
                  </span>
                  <span className="whitespace-nowrap col-span-2">
                    <span className="text-slate-500">Labour days</span> {formatDecimal(row.labourDays, 1)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-blue-400" /> Labour</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-orange-400" /> Material</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-600" /> Profit</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Cost above revenue</span>
      </div>
    </div>
  );
}

function DailyProfitTrendChart({ rows }: { rows: DailyProfitTrendRow[] }) {
  const chart = useMemo(() => {
    const sortedRows = [...rows].sort((a, b) => a.workDate.localeCompare(b.workDate));
    const width = 860;
    const height = 320;
    const paddingLeft = 44;
    const paddingRight = 44;
    const paddingTop = 52;
    const paddingBottom = 54;
    const values = sortedRows.map((row) => row.profit);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const span = max - min || 1;

    const x = (index: number) =>
      paddingLeft +
      (sortedRows.length <= 1
        ? 0
        : (index / (sortedRows.length - 1)) * (width - paddingLeft - paddingRight));

    const y = (value: number) =>
      paddingTop + (1 - (value - min) / span) * (height - paddingTop - paddingBottom);

    const path = sortedRows
      .map((row, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(row.profit).toFixed(1)}`)
      .join(' ');

    const baseY = y(0);
    const areaPath = sortedRows.length
      ? `${path} L${x(sortedRows.length - 1).toFixed(1)},${baseY.toFixed(1)} L${x(0).toFixed(1)},${baseY.toFixed(1)} Z`
      : '';

    return { sortedRows, width, height, path, areaPath, zeroY: baseY, x, y };
  }, [rows]);

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-950">Daily profit trend</h3>
        <span className="font-mono text-[11px] text-slate-500">
          {formatNumber(chart.sortedRows.length)} work days
        </span>
      </div>

      {chart.sortedRows.length < 2 ? (
        <div className="py-8 text-center text-sm text-slate-500">Not enough dated rows for a trend.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              className="h-[380px] w-full min-w-[860px] overflow-visible"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="Daily profit trend"
            >
              <path d={chart.areaPath} fill="var(--chart-area)" />
              <line
                x1="28"
                x2={chart.width - 28}
                y1={chart.zeroY}
                y2={chart.zeroY}
                stroke="var(--chart-grid)"
                strokeDasharray="4 4"
              />
              <path d={chart.path} fill="none" stroke="var(--aph-ink)" strokeWidth="2.4" />
              {chart.sortedRows.map((row, index) => {
                const costAboveRevenue = Math.max(row.labour + row.material - row.revenue, 0);
                const pointY = chart.y(row.profit);
                const labelOffset = index % 2 === 0 ? -24 : 28;
                const rawLabelY = pointY + labelOffset;
                const labelY = Math.max(18, Math.min(chart.height - 72, rawLabelY));

                return (
                  <g key={row.workDate}>
                    <circle
                      cx={chart.x(index)}
                      cy={pointY}
                      r="4.5"
                      fill={row.profit >= 0 ? 'var(--aph-pos)' : 'var(--aph-neg)'}
                      stroke="var(--aph-surface)"
                      strokeWidth="2"
                    />

                    <text
                      x={chart.x(index)}
                      y={labelY}
                      textAnchor="middle"
                      className={row.profit >= 0 ? 'aph-chart-value-pos' : 'aph-chart-value-neg'}
                    >
                      {formatCurrency(row.profit)}
                    </text>

                    <text
                      x={chart.x(index)}
                      y={chart.height - 14}
                      textAnchor="middle"
                      className="aph-chart-date-label"
                    >
                      {shortDateLabel(row.workDate)}
                    </text>

                    <title>{`${shortDateLabel(row.workDate)} · Labour days ${formatDecimal(
                      bookedDaysValue(row),
                      1,
                    )} · Labour ${formatCurrency(
                      row.labour,
                    )} · Material ${formatCurrency(row.material)} · Profit ${formatCurrency(
                      row.profit,
                    )} · Cost above revenue ${formatCurrency(costAboveRevenue)}`}</title>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="mt-4 overflow-x-auto rounded-md border border-slate-100">
            <table className="w-full min-w-[760px] border-collapse font-mono text-[11px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                  <th className="px-3 py-2 text-right font-semibold">Labour Days</th>
                  <th className="px-3 py-2 text-right font-semibold">Labour</th>
                  <th className="px-3 py-2 text-right font-semibold">Material</th>
                  <th className="px-3 py-2 text-right font-semibold">Profit</th>
                  <th className="px-3 py-2 text-right font-semibold">Cost above revenue</th>
                </tr>
              </thead>
              <tbody>
                {chart.sortedRows.map((row) => {
                  const costAboveRevenue = Math.max(row.labour + row.material - row.revenue, 0);

                  return (
                    <tr key={`daily-values-${row.workDate}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-left text-slate-700">{shortDateLabel(row.workDate)}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{formatDecimal(bookedDaysValue(row), 1)}</td>
                      <td className="px-3 py-2 text-right text-blue-600">{formatCurrencyOrDash(row.labour)}</td>
                      <td className="px-3 py-2 text-right text-orange-600">{formatCurrencyOrDash(row.material)}</td>
                      <td className={`px-3 py-2 text-right ${profitClass(row.profit)}`}>
                        {formatCurrency(row.profit)}
                      </td>
                      <td className="px-3 py-2 text-right text-red-600">
                        {formatCurrencyOrDash(costAboveRevenue)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}


function fullDateLabel(value: string) {
  if (!value) return '-';

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

type DateTimelineSortKey =
  | 'workDate'
  | 'flats'
  | 'layers'
  | 'area'
  | 'labourDays'
  | 'labour'
  | 'materialUsed'
  | 'material'
  | 'revenue'
  | 'profit'
  | 'productivity';

type DateTimelineSort = {
  key: DateTimelineSortKey;
  direction: 'asc' | 'desc';
};

const dateTimelineColumns: {
  key: DateTimelineSortKey;
  label: string;
  align: 'left' | 'right';
}[] = [
  { key: 'workDate', label: 'Date', align: 'left' },
  { key: 'flats', label: 'Flats', align: 'right' },
  { key: 'layers', label: 'Layers', align: 'right' },
  { key: 'area', label: 'Area', align: 'right' },
  { key: 'labourDays', label: 'Labour Days', align: 'right' },
  { key: 'labour', label: 'Labour', align: 'right' },
  { key: 'materialUsed', label: 'Material Used', align: 'right' },
  { key: 'material', label: 'Material', align: 'right' },
  { key: 'revenue', label: 'Revenue', align: 'right' },
  { key: 'profit', label: 'Profit', align: 'right' },
  { key: 'productivity', label: 'Productivity', align: 'right' },
];

function getDateTimelineSortValue(row: DateTimelineRow, key: DateTimelineSortKey) {
  if (key === 'workDate') return new Date(`${row.workDate}T00:00:00`).getTime() || 0;
  return Number(row[key] || 0);
}

function DateTimelineHeader({
  column,
  sort,
  onSort,
}: {
  column: (typeof dateTimelineColumns)[number];
  sort: DateTimelineSort;
  onSort: (key: DateTimelineSortKey) => void;
}) {
  const active = sort.key === column.key;

  return (
    <th
      className={`border-b border-slate-200 px-3 py-3 font-semibold ${
        column.align === 'left' ? 'text-left' : 'text-right'
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={`inline-flex items-center gap-1 uppercase tracking-[0.14em] hover:text-orange-500 ${
          column.align === 'right' ? 'justify-end' : ''
        }`}
      >
        {column.label}
        {active && <span className="text-orange-500">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}

function DateTimelineValueCells({
  item,
}: {
  item:
    | DateTimelineRow
    | DateTimelineApplicationRow
    | DateTimelineEntryRow;
}) {
  return (
    <>
      <td className="px-3 py-2 text-right">{formatNumber(item.area)}</td>
      <td className="px-3 py-2 text-right">{formatDecimal(bookedDaysValue(item), 1)}</td>
      <td className="px-3 py-2 text-right">{formatCurrencyOrDash(item.labour)}</td>
      <td className="px-3 py-2 text-right">
        {Number(item.materialUsed || 0) > 0 ? formatDecimal(item.materialUsed, 2) : '—'}
      </td>
      <td className="px-3 py-2 text-right">{formatCurrencyOrDash(item.material)}</td>
      <td className="px-3 py-2 text-right">{formatCurrencyOrDash(item.revenue)}</td>
      <td className={`px-3 py-2 text-right ${profitClass(item.profit)}`}>
        {formatCurrency(item.profit)}
      </td>
      <td className="px-3 py-2 text-right">{formatNumber(item.productivity)}</td>
    </>
  );
}

function DateTimelineTable({ rows }: { rows: DateTimelineRow[] }) {
  const [sort, setSort] = useState<DateTimelineSort>({
    key: 'workDate',
    direction: 'desc',
  });
  const [openDates, setOpenDates] = useState<Set<string>>(new Set());

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const first = getDateTimelineSortValue(a, sort.key);
      const second = getDateTimelineSortValue(b, sort.key);
      const result = first === second ? 0 : first > second ? 1 : -1;
      return sort.direction === 'asc' ? result : -result;
    });
  }, [rows, sort]);

  function sortBy(key: DateTimelineSortKey) {
    setSort((current) => {
      if (current.key === key) {
        return {
          key,
          direction: current.direction === 'asc' ? 'desc' : 'asc',
        };
      }

      return {
        key,
        direction: key === 'workDate' ? 'desc' : 'desc',
      };
    });
  }

  function toggleDate(workDate: string) {
    setOpenDates((current) => {
      const next = new Set(current);
      if (next.has(workDate)) next.delete(workDate);
      else next.add(workDate);
      return next;
    });
  }

  function setDateOrder(direction: 'asc' | 'desc') {
    setSort({ key: 'workDate', direction });
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Date-wise work timeline</h2>
          <p className="text-sm text-slate-500">
            {formatNumber(rows.length)} work days · click a date to see application, flat and layer entries.
          </p>
        </div>

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setDateOrder('desc')}
            className={`rounded px-3 py-2 text-sm font-semibold ${
              sort.key === 'workDate' && sort.direction === 'desc'
                ? 'bg-slate-950 text-white'
                : 'border border-slate-300 bg-white text-slate-600'
            }`}
          >
            Newest first
          </button>
          <button
            type="button"
            onClick={() => setDateOrder('asc')}
            className={`rounded px-3 py-2 text-sm font-semibold ${
              sort.key === 'workDate' && sort.direction === 'asc'
                ? 'bg-slate-950 text-white'
                : 'border border-slate-300 bg-white text-slate-600'
            }`}
          >
            Oldest first
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1180px] border-collapse text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              {dateTimelineColumns.map((column) => (
                <DateTimelineHeader
                  key={column.key}
                  column={column}
                  sort={sort}
                  onSort={sortBy}
                />
              ))}
            </tr>
          </thead>

          <tbody className="font-mono text-slate-950">
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-sm text-slate-500">
                  No date timeline data found for the selected filters.
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => {
                const isOpen = openDates.has(row.workDate);

                return (
                  <Fragment key={row.workDate}>
                    <tr
                      onClick={() => toggleDate(row.workDate)}
                      className="cursor-pointer border-b border-slate-100 bg-white hover:bg-slate-50"
                    >
                      <td className="px-3 py-2 text-left font-bold">
                        <span className="mr-2 text-blue-400">{isOpen ? '▼' : '▶'}</span>
                        {fullDateLabel(row.workDate)}
                      </td>
                      <td className="px-3 py-2 text-right">{formatNumber(row.flats)}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(row.layers)}</td>
                      <DateTimelineValueCells item={row} />
                    </tr>

                    {isOpen &&
                      row.applications.map((application) => (
                        <Fragment key={`${row.workDate}-${application.application}`}>
                          <tr
                            className="border-b border-slate-100 bg-white"
                          >
                            <td className="px-3 py-2 pl-8 text-left font-sans font-bold">
                              {application.application}
                            </td>
                            <td className="px-3 py-2 text-right">{formatNumber(application.flats)}</td>
                            <td className="px-3 py-2 text-right">{formatNumber(application.layers)}</td>
                            <DateTimelineValueCells item={application} />
                          </tr>

                          {application.entries.map((entry) => (
                            <tr
                              key={`${row.workDate}-${application.application}-${entry.flatId}-${entry.workLayer}`}
                              className="border-b border-slate-100 bg-slate-50/50 text-slate-700"
                            >
                              <td className="px-3 py-2 pl-12 text-left font-sans">
                                <b className="text-slate-950">{entry.flatId || '-'}</b>
                                <span className="text-slate-400"> · {entry.workLayer || '-'}</span>
                                {entry.materialNames && <span className="block pl-1 text-[10px] text-slate-400">{entry.materialNames}</span>}
                                {!isAnalyticsBillableLayer(entry.workLayer) && (
                                  <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-orange-700">
                                    Ops
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-400">—</td>
                              <td className="px-3 py-2 text-right text-slate-400">—</td>
                              <DateTimelineValueCells item={entry} />
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExecutiveCharts({
  applicationRows,
  flatRows,
  dailyRows,
}: {
  applicationRows: ApplicationSummaryRow[];
  flatRows: FlatSummaryRow[];
  dailyRows: DailyProfitTrendRow[];
}) {
  return (
    <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ProfitByFlatChart rows={flatRows} />
      <RevenueSplitByApplicationChart rows={applicationRows} />
      <div className="xl:col-span-2">
        <DailyProfitTrendChart rows={dailyRows} />
      </div>
    </section>
  );
}


function FlatProfitRankingChart({
  title,
  note,
  rows,
}: {
  title: string;
  note: string;
  rows: FlatSummaryRow[];
}) {
  const maxValue = Math.max(1, ...rows.map((row) => Math.abs(row.netProfit)));

  return (
    <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-950">{title}</h3>
        <span className="font-mono text-[11px] text-slate-500">{note}</span>
      </div>

      {rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">No flat data found.</div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => {
            const width = Math.min(100, (Math.abs(row.netProfit) / maxValue) * 100);

            return (
              <div
                key={`${title}-${row.application}-${row.flatId}`}
                className="grid grid-cols-[minmax(0,1fr)_minmax(160px,0.9fr)_minmax(118px,auto)] items-center gap-3 text-sm"
              >
                <div className="truncate font-medium text-slate-950" title={`${row.application} · ${row.flatId}`}>
                  {row.application} · {row.flatId}
                </div>

                <div className="relative h-4 overflow-hidden rounded-sm bg-slate-100">
                  <span className="absolute left-1/2 top-0 h-full w-px bg-slate-300" />
                  <span
                    className={`absolute top-0 h-full rounded-sm ${
                      row.netProfit >= 0 ? 'bg-emerald-600' : 'bg-red-500'
                    }`}
                    style={
                      row.netProfit >= 0
                        ? { left: '50%', width: `${width / 2}%` }
                        : { left: `${50 - width / 2}%`, width: `${width / 2}%` }
                    }
                  />
                </div>

                <div className="text-right font-mono leading-4">
                  <div className={profitClass(row.netProfit)}>{formatCurrency(row.netProfit)}</div>
                  <div className="text-[10px] text-slate-500">
                    {formatDecimal(row.labourDays, 1)} labour days
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


type ProfitLossFlatSortKey =
  | 'name'
  | 'area'
  | 'labourDays'
  | 'targetDays'
  | 'vsTarget'
  | 'targetUsePct'
  | 'labour'
  | 'material'
  | 'revenue'
  | 'netProfit'
  | 'margin'
  | 'profitPerSqft'
  | 'layersBooked';

type ProfitLossLayerSortKey =
  | 'workLayer'
  | 'entries'
  | 'area'
  | 'labourDays'
  | 'targetDays'
  | 'vsTarget'
  | 'targetUsePct'
  | 'labour'
  | 'material'
  | 'revenue'
  | 'profit'
  | 'margin'
  | 'productivity';

type ProfitLossEntrySortKey =
  | 'flat'
  | 'workDate'
  | 'workLayer'
  | 'area'
  | 'labourDays'
  | 'targetDays'
  | 'vsTarget'
  | 'targetUsePct'
  | 'labour'
  | 'material'
  | 'revenue'
  | 'loss';

type SortDirection = 'asc' | 'desc';

type ProfitLossLayerRow = {
  workLayer: string;
  layerOrder: number;
  entries: number;
  isBillable: boolean;
  area: number;
  labourDays: number;
  bookedDays: number;
  targetDays: number;
  vsTarget: number;
  targetUsePct: number;
  labour: number;
  material: number;
  revenue: number;
  profit: number;
  margin: number;
  productivity: number;
};

type ProfitLossEntryRow = {
  application: string;
  flatId: string;
  workDate: string;
  workLayer: string;
  isBillable: boolean;
  area: number;
  labourDays: number;
  bookedDays: number;
  targetDays: number;
  vsTarget: number;
  targetUsePct: number;
  labour: number;
  material: number;
  revenue: number;
  profit: number;
  productivity: number;
};

function nextSortDirection(
  currentKey: string,
  newKey: string,
  currentDirection: SortDirection,
  defaultDirection: SortDirection = 'desc',
) {
  if (currentKey === newKey) return currentDirection === 'asc' ? 'desc' : 'asc';
  return defaultDirection;
}

function SortButton({
  label,
  active,
  direction,
  onClick,
  align = 'right',
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 uppercase tracking-[0.14em] hover:text-orange-500 ${
        align === 'right' ? 'justify-end' : ''
      }`}
    >
      {label}
      {active && <span className="text-orange-500">{direction === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );
}

function ProfitLossTableHeader({
  label,
  align = 'right',
  active,
  direction,
  onClick,
}: {
  label: string;
  align?: 'left' | 'right';
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <th
      className={`border-b border-slate-200 px-3 py-3 font-semibold ${
        align === 'left' ? 'text-left' : 'text-right'
      }`}
    >
      <SortButton
        label={label}
        align={align}
        active={active}
        direction={direction}
        onClick={onClick}
      />
    </th>
  );
}

function ProfitLossStatusTag({ workLayer }: { workLayer: string }) {
  const isBillable = isAnalyticsBillableLayer(workLayer);

  return isBillable ? (
    <span className="aph-status-badge aph-status-info ml-2">
      Billable
    </span>
  ) : (
    <span className="aph-status-badge aph-status-warning ml-2">
      Ops
    </span>
  );
}

function getFlatSortValue(row: FlatSummaryRow, key: ProfitLossFlatSortKey) {
  if (key === 'name') return `${row.application} · ${row.flatId}`;
  if (key === 'layersBooked') return row.totalLayers > 0 ? row.bookedLayers / row.totalLayers : 0;
  if (key === 'labourDays') return bookedDaysValue(row);
  if (key === 'targetDays') return Number(row.targetDays || 0);
  if (key === 'vsTarget') return Number(row.vsTarget || 0);
  if (key === 'targetUsePct') return Number(row.targetUsePct || 0);
  return Number(row[key] || 0);
}

function FlatProfitabilityRankingTable({ rows }: { rows: FlatSummaryRow[] }) {
  const [sort, setSort] = useState<{ key: ProfitLossFlatSortKey; direction: SortDirection }>({
    key: 'netProfit',
    direction: 'desc',
  });

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const first = getFlatSortValue(a, sort.key);
      const second = getFlatSortValue(b, sort.key);
      const result =
        typeof first === 'string' || typeof second === 'string'
          ? naturalCompare(String(first), String(second))
          : Number(first) === Number(second)
            ? 0
            : Number(first) > Number(second)
              ? 1
              : -1;
      return sort.direction === 'asc' ? result : -result;
    });
  }, [rows, sort]);

  function sortBy(key: ProfitLossFlatSortKey) {
    setSort((current) => ({
      key,
      direction: nextSortDirection(current.key, key, current.direction, key === 'name' ? 'asc' : 'desc'),
    }));
  }

  return (
    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold text-slate-950">Flat profitability ranking</h2>
        <p className="text-sm text-slate-500">
          Includes non-billable operational work in flat cost. Flats marked{' '}
          <span className="rounded bg-orange-100 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-orange-700">
            Open
          </span>{' '}
          still have layers to book, so their margin will fall as sanding and later coats land.
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <ProfitLossTableHeader label="Application · Flat" align="left" active={sort.key === 'name'} direction={sort.direction} onClick={() => sortBy('name')} />
              <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold uppercase tracking-[0.14em]">
                Cost vs Revenue
              </th>
              <ProfitLossTableHeader label="Area" active={sort.key === 'area'} direction={sort.direction} onClick={() => sortBy('area')} />
              <ProfitLossTableHeader label="Labour Cost" active={sort.key === 'labour'} direction={sort.direction} onClick={() => sortBy('labour')} />
              <ProfitLossTableHeader label="Material Cost" active={sort.key === 'material'} direction={sort.direction} onClick={() => sortBy('material')} />
              <ProfitLossTableHeader label="Revenue" active={sort.key === 'revenue'} direction={sort.direction} onClick={() => sortBy('revenue')} />
              <ProfitLossTableHeader label="Net Profit" active={sort.key === 'netProfit'} direction={sort.direction} onClick={() => sortBy('netProfit')} />
              <ProfitLossTableHeader label="Margin" active={sort.key === 'margin'} direction={sort.direction} onClick={() => sortBy('margin')} />
              <ProfitLossTableHeader label="Profit / Sqft" active={sort.key === 'profitPerSqft'} direction={sort.direction} onClick={() => sortBy('profitPerSqft')} />
              <ProfitLossTableHeader label="Layers Booked" active={sort.key === 'layersBooked'} direction={sort.direction} onClick={() => sortBy('layersBooked')} />
            </tr>
          </thead>

          <tbody className="font-mono text-slate-950">
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-500">
                  No flat profitability data found for the selected filters.
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => {
                const isOpen = row.totalLayers > 0 && row.bookedLayers < row.totalLayers;

                return (
                  <tr
                    key={`pl-flat-${row.application}-${row.flatId}`}
                    className={`border-b border-slate-100 hover:bg-slate-50 ${
                      row.netProfit < -0.5 ? 'bg-red-50' : ''
                    }`}
                  >
                    <td className="px-3 py-3 text-left font-sans">
                      <b>{row.application} · {row.flatId}</b>
                    </td>
                    <td className="px-3 py-3 text-left">
                      <CostVsRevenueSpine
                        labour={row.labour}
                        material={row.material}
                        revenue={row.revenue}
                        netProfit={row.netProfit}
                      />
                    </td>
                    <td className="px-3 py-3 text-right">{formatNumber(row.area)}</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(row.labour)}</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(row.material)}</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(row.revenue)}</td>
                    <td className={`px-3 py-3 text-right ${profitClass(row.netProfit)}`}>
                      {formatCurrency(row.netProfit)}
                    </td>
                    <td className={`px-3 py-3 text-right ${profitClass(row.margin)}`}>
                      {formatDecimal(row.margin, 1)}%
                    </td>
                    <td className={`px-3 py-3 text-right ${profitClass(row.profitPerSqft)}`}>
                      {formatMoneyPerSqft(row.profitPerSqft)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {formatNumber(row.bookedLayers)}/{formatNumber(row.totalLayers)}
                      {isOpen && (
                        <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-orange-700">
                          Open
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function buildWorkLayerRows(rows: FlatSummaryRow[]) {
  const map = new Map<
    string,
    ProfitLossLayerRow & { billableEntries: number }
  >();

  rows.forEach((flat) => {
    (flat.details || []).forEach((detail) => {
      const key = detail.workLayer || 'Unspecified';
      const current = map.get(key) || {
        workLayer: key,
        layerOrder: layerOrderValue(detail),
        entries: 0,
        isBillable: false,
        billableEntries: 0,
        area: 0,
        labourDays: 0,
        bookedDays: 0,
        targetDays: 0,
        vsTarget: 0,
        targetUsePct: 0,
        labour: 0,
        material: 0,
        revenue: 0,
        profit: 0,
        margin: 0,
        productivity: 0,
      };

      current.entries += 1;
      current.layerOrder = Math.min(layerOrderValue(current), layerOrderValue(detail));
      if (isAnalyticsBillableLayer(detail.workLayer)) current.billableEntries += 1;
      current.isBillable = current.isBillable || isAnalyticsBillableLayer(detail.workLayer);
      current.area += Number(detail.area || 0);
      current.labourDays += Number(detail.labourDays || 0);
      current.bookedDays += bookedDaysValue(detail);
      current.targetDays += Number(detail.targetDays || 0);
      current.labour += Number(detail.labour || 0);
      current.material += Number(detail.material || 0);
      current.revenue += Number(detail.revenue || 0);
      current.profit += Number(detail.profit || 0);

      map.set(key, current);
    });
  });

  return Array.from(map.values()).map((row) => ({
    ...row,
    margin: row.revenue > 0 ? (row.profit * 100) / row.revenue : 0,
    vsTarget: (row.bookedDays || row.labourDays) - row.targetDays,
    targetUsePct: row.targetDays > 0 ? ((row.bookedDays || row.labourDays) * 100) / row.targetDays : 0,
    productivity: row.labourDays > 0 ? row.area / row.labourDays : 0,
  }));
}

function getLayerSortValue(row: ProfitLossLayerRow, key: ProfitLossLayerSortKey) {
  if (key === 'workLayer') return layerOrderValue(row);
  return Number(row[key] || 0);
}

function WorkLayerProfitabilityTable({ rows }: { rows: FlatSummaryRow[] }) {
  const [sort, setSort] = useState<{ key: ProfitLossLayerSortKey; direction: SortDirection }>({
    key: 'workLayer',
    direction: 'asc',
  });

  const layerRows = useMemo(() => buildWorkLayerRows(rows), [rows]);
  const sortedRows = useMemo(() => {
    return [...layerRows].sort((a, b) => {
      const first = getLayerSortValue(a, sort.key);
      const second = getLayerSortValue(b, sort.key);
      const result =
        typeof first === 'string' || typeof second === 'string'
          ? naturalCompare(String(first), String(second))
          : Number(first) === Number(second)
            ? 0
            : Number(first) > Number(second)
              ? 1
              : -1;
      return sort.direction === 'asc' ? result : -result;
    });
  }, [layerRows, sort]);

  function sortBy(key: ProfitLossLayerSortKey) {
    setSort((current) => ({
      key,
      direction: nextSortDirection(current.key, key, current.direction, key === 'workLayer' ? 'asc' : 'desc'),
    }));
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold text-slate-950">Work layer profitability</h2>
        <p className="text-sm text-slate-500">
          Layers with zero client value are operational cost carried by the billable layers.
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <ProfitLossTableHeader label="Work Layer" align="left" active={sort.key === 'workLayer'} direction={sort.direction} onClick={() => sortBy('workLayer')} />
              <ProfitLossTableHeader label="Entries" active={sort.key === 'entries'} direction={sort.direction} onClick={() => sortBy('entries')} />
              <ProfitLossTableHeader label="Area" active={sort.key === 'area'} direction={sort.direction} onClick={() => sortBy('area')} />
              <ProfitLossTableHeader label="Labour Days" active={sort.key === 'labourDays'} direction={sort.direction} onClick={() => sortBy('labourDays')} />
              <ProfitLossTableHeader label="Labour" active={sort.key === 'labour'} direction={sort.direction} onClick={() => sortBy('labour')} />
              <ProfitLossTableHeader label="Material" active={sort.key === 'material'} direction={sort.direction} onClick={() => sortBy('material')} />
              <ProfitLossTableHeader label="Revenue" active={sort.key === 'revenue'} direction={sort.direction} onClick={() => sortBy('revenue')} />
              <ProfitLossTableHeader label="Profit" active={sort.key === 'profit'} direction={sort.direction} onClick={() => sortBy('profit')} />
              <ProfitLossTableHeader label="Margin" active={sort.key === 'margin'} direction={sort.direction} onClick={() => sortBy('margin')} />
              <ProfitLossTableHeader label="Productivity" active={sort.key === 'productivity'} direction={sort.direction} onClick={() => sortBy('productivity')} />
            </tr>
          </thead>

          <tbody className="font-mono text-slate-950">
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-500">
                  No work layer profitability data found for the selected filters.
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => (
                <tr
                  key={`pl-layer-${row.workLayer}`}
                  className={`border-b border-slate-100 hover:bg-slate-50 ${row.profit < -0.5 ? 'bg-red-50' : ''}`}
                >
                  <td className="px-3 py-3 text-left font-sans font-medium">
                    {row.workLayer || '-'}
                    <ProfitLossStatusTag workLayer={row.workLayer} />
                  </td>
                  <td className="px-3 py-3 text-right">{formatNumber(row.entries)}</td>
                  <td className="px-3 py-3 text-right">{formatNumber(row.area)}</td>
                  <td className="px-3 py-3 text-right">{formatDecimal(row.bookedDays || row.labourDays, 1)}</td>
                  <td className="px-3 py-3 text-right">{formatCurrency(row.labour)}</td>
                  <td className="px-3 py-3 text-right">{formatCurrencyOrDash(row.material)}</td>
                  <td className="px-3 py-3 text-right">{formatCurrencyOrDash(row.revenue)}</td>
                  <td className={`px-3 py-3 text-right ${profitClass(row.profit)}`}>
                    {formatCurrency(row.profit)}
                  </td>
                  <td className={`px-3 py-3 text-right ${row.revenue > 0 ? profitClass(row.margin) : 'text-red-600'}`}>
                    {row.revenue > 0 ? `${formatDecimal(row.margin, 1)}%` : '—'}
                  </td>
                  <td className="px-3 py-3 text-right">{formatNumber(row.productivity)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function buildLossRows(rows: FlatSummaryRow[]) {
  const out: ProfitLossEntryRow[] = [];

  rows.forEach((flat) => {
    (flat.details || []).forEach((detail) => {
      if (Number(detail.profit || 0) < -0.5) {
        out.push({
          application: flat.application,
          flatId: flat.flatId,
          workDate: detail.workDate,
          workLayer: detail.workLayer,
          isBillable: isAnalyticsBillableLayer(detail.workLayer),
          area: Number(detail.area || 0),
          labourDays: Number(detail.labourDays || 0),
          bookedDays: bookedDaysValue(detail),
          targetDays: Number(detail.targetDays || 0),
          vsTarget: Number(detail.vsTarget || 0),
          targetUsePct: Number(detail.targetUsePct || 0),
          labour: Number(detail.labour || 0),
          material: Number(detail.material || 0),
          revenue: Number(detail.revenue || 0),
          profit: Number(detail.profit || 0),
          productivity: Number(detail.productivity || 0),
        });
      }
    });
  });

  return out;
}

function getLossSortValue(row: ProfitLossEntryRow, key: ProfitLossEntrySortKey) {
  if (key === 'flat') return `${row.flatId} ${row.application}`;
  if (key === 'workDate') return new Date(`${row.workDate}T00:00:00`).getTime() || 0;
  if (key === 'workLayer') return row.workLayer;
  if (key === 'loss') return row.profit;
  if (key === 'labourDays') return bookedDaysValue(row);
  if (key === 'targetDays') return Number(row.targetDays || 0);
  if (key === 'vsTarget') return Number(row.vsTarget || 0);
  if (key === 'targetUsePct') return Number(row.targetUsePct || 0);
  return Number(row[key] || 0);
}

function LossMakingWorkEntriesTable({ rows }: { rows: FlatSummaryRow[] }) {
  const [sort, setSort] = useState<{ key: ProfitLossEntrySortKey; direction: SortDirection }>({
    key: 'loss',
    direction: 'asc',
  });

  const lossRows = useMemo(() => buildLossRows(rows), [rows]);
  const totalLoss = useMemo(
    () => lossRows.reduce((sum, row) => sum + row.profit, 0),
    [lossRows],
  );
  const sortedRows = useMemo(() => {
    return [...lossRows].sort((a, b) => {
      const first = getLossSortValue(a, sort.key);
      const second = getLossSortValue(b, sort.key);
      const result =
        typeof first === 'string' || typeof second === 'string'
          ? naturalCompare(String(first), String(second))
          : Number(first) === Number(second)
            ? 0
            : Number(first) > Number(second)
              ? 1
              : -1;
      return sort.direction === 'asc' ? result : -result;
    });
  }, [lossRows, sort]);

  function sortBy(key: ProfitLossEntrySortKey) {
    setSort((current) => ({
      key,
      direction: nextSortDirection(current.key, key, current.direction, key === 'loss' ? 'asc' : 'desc'),
    }));
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold text-slate-950">Loss-making work entries</h2>
        <p className="text-sm text-slate-500">
          {formatNumber(lossRows.length)} entries · {formatCurrency(totalLoss)} total. Operational layers are expected to sit here.
        </p>
      </div>

      <div className="max-h-[560px] overflow-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <ProfitLossTableHeader label="Flat" align="left" active={sort.key === 'flat'} direction={sort.direction} onClick={() => sortBy('flat')} />
              <ProfitLossTableHeader label="Date" align="left" active={sort.key === 'workDate'} direction={sort.direction} onClick={() => sortBy('workDate')} />
              <ProfitLossTableHeader label="Work Layer" align="left" active={sort.key === 'workLayer'} direction={sort.direction} onClick={() => sortBy('workLayer')} />
              <ProfitLossTableHeader label="Area" active={sort.key === 'area'} direction={sort.direction} onClick={() => sortBy('area')} />
              <ProfitLossTableHeader label="Labour Days" active={sort.key === 'labourDays'} direction={sort.direction} onClick={() => sortBy('labourDays')} />
              <ProfitLossTableHeader label="Labour" active={sort.key === 'labour'} direction={sort.direction} onClick={() => sortBy('labour')} />
              <ProfitLossTableHeader label="Material" active={sort.key === 'material'} direction={sort.direction} onClick={() => sortBy('material')} />
              <ProfitLossTableHeader label="Revenue" active={sort.key === 'revenue'} direction={sort.direction} onClick={() => sortBy('revenue')} />
              <ProfitLossTableHeader label="Loss" active={sort.key === 'loss'} direction={sort.direction} onClick={() => sortBy('loss')} />
            </tr>
          </thead>

          <tbody className="font-mono text-slate-950">
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-500">
                  No loss-making entries found for the selected filters.
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => (
                <tr
                  key={`loss-${row.application}-${row.flatId}-${row.workDate}-${row.workLayer}`}
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-3 py-2 text-left font-sans">
                    <b className="text-slate-950">{row.flatId || '-'}</b>{' '}
                    <span className="text-slate-400">{row.application}</span>
                  </td>
                  <td className="px-3 py-2 text-left">{fullDateLabel(row.workDate)}</td>
                  <td className="px-3 py-2 text-left font-sans">
                    {row.workLayer || '-'}
                    <ProfitLossStatusTag workLayer={row.workLayer} />
                  </td>
                  <td className="px-3 py-2 text-right">{row.area > 0 ? formatNumber(row.area) : '—'}</td>
                  <td className="px-3 py-2 text-right">{formatDecimal(row.bookedDays || row.labourDays, 1)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.labour)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.material)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.revenue)}</td>
                  <td className="px-3 py-2 text-right text-red-700">{formatCurrency(row.profit)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProfitLossTab({ rows, kpis }: { rows: FlatSummaryRow[]; kpis: ExecutiveSummaryResponse['kpis'] }) {
  const mostProfitable = useMemo(
    () => [...rows].sort((a, b) => b.netProfit - a.netProfit).slice(0, 10),
    [rows],
  );

  const weakest = useMemo(
    () => [...rows].sort((a, b) => a.netProfit - b.netProfit).slice(0, 10),
    [rows],
  );

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold text-slate-950">Profit & loss</h2>
        <p className="text-sm text-slate-500">
          Net {formatCurrency(kpis.netProfit)} on {formatCurrency(kpis.clientValue)} revenue ·{' '}
          {formatDecimal(kpis.profitMargin, 1)}% margin
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <FlatProfitRankingChart
          title="Most profitable flats"
          note="top 10"
          rows={mostProfitable}
        />
        <FlatProfitRankingChart
          title="Weakest flats"
          note="bottom 10"
          rows={weakest}
        />
      </div>

      <FlatProfitabilityRankingTable rows={rows} />
      <WorkLayerProfitabilityTable rows={rows} />
      <LossMakingWorkEntriesTable rows={rows} />
    </section>
  );
}


type ProductivityEntry = {
  application: string;
  flatId: string;
  workDate: string;
  workLayer: string;
  layerOrder: number;
  isBillable: boolean;
  area: number;
  labourDays: number;
  labour: number;
  material: number;
  revenue: number;
  profit: number;
};

type ProductivityMetricRow = {
  key: string;
  label: string;
  workLayer?: string;
  layerOrder: number;
  entries: number;
  flats: number;
  layers: number;
  applications: number;
  area: number;
  measuredDays: number;
  supportDays: number;
  allDays: number;
  labour: number;
  material: number;
  revenue: number;
  profit: number;
  productivity: number;
  labourPerSqft: number;
  materialPerSqft: number;
  revenuePerSqft: number;
  profitPerSqft: number;
};

type ProductivityDrillChildRow = ProductivityMetricRow & { flatChildren: ProductivityMetricRow[] };
type ProductivityDrillTopRow = ProductivityMetricRow & { children: ProductivityDrillChildRow[] };

function buildProductivityEntries(rows: FlatSummaryRow[]): ProductivityEntry[] {
  return rows.flatMap((flat) =>
    (flat.details || [])
      .filter((detail) => Boolean(detail.workDate) && bookedDaysValue(detail) > 0)
      .map((detail) => ({
        application: flat.application || 'Unassigned',
        flatId: flat.flatId || '',
        workDate: detail.workDate || '',
        workLayer: detail.workLayer || 'Unspecified',
        layerOrder: layerOrderValue(detail),
        isBillable: isAnalyticsBillableLayer(detail.workLayer),
        area: Number(detail.area || 0),
        labourDays: bookedDaysValue(detail),
        labour: Number(detail.labour || 0),
        material: Number(detail.material || 0),
        revenue: Number(detail.revenue || 0),
        profit: Number(detail.profit || 0),
      })),
  );
}

function buildProductivityLayerSequence(entries: ProductivityEntry[]) {
  const byApplication = new Map<string, Map<string, { workLayer: string; layerOrder: number }>>();
  entries.forEach((entry) => {
    const application = entry.application || 'Unassigned';
    const layerKey = normalizeAnalyticsLayerName(entry.workLayer);
    if (!layerKey) return;
    let layers = byApplication.get(application);
    if (!layers) { layers = new Map(); byApplication.set(application, layers); }
    const existing = layers.get(layerKey);
    if (!existing || entry.layerOrder < existing.layerOrder) layers.set(layerKey, { workLayer: entry.workLayer, layerOrder: entry.layerOrder });
  });
  const sequence = new Map<string, number>();
  let index = 0;
  [...byApplication.entries()].sort(([a],[b]) => naturalCompare(a,b)).forEach(([,layers]) => {
    [...layers.entries()].sort(([,a],[,b]) => (a.layerOrder - b.layerOrder) || naturalCompare(a.workLayer,b.workLayer)).forEach(([key]) => {
      if (!sequence.has(key)) sequence.set(key,index++);
    });
  });
  [...new Set(entries.map((e) => e.workLayer))].sort(naturalCompare).forEach((layer) => {
    const k = normalizeAnalyticsLayerName(layer);
    if (k && !sequence.has(k)) sequence.set(k,index++);
  });
  return sequence;
}

function aggregateProductivityRows(
  entries: ProductivityEntry[],
  getKey: (entry: ProductivityEntry) => string,
  getLabel: (entry: ProductivityEntry) => string,
): ProductivityMetricRow[] {
  const map = new Map<string, ProductivityMetricRow & { flatSet: Set<string>; layerSet: Set<string>; appSet: Set<string> }>();
  entries.forEach((entry) => {
    const key = getKey(entry) || 'Unspecified';
    const current = map.get(key) || {
      key, label: getLabel(entry) || key, workLayer: entry.workLayer, layerOrder: entry.layerOrder,
      entries:0, flats:0, layers:0, applications:0, area:0, measuredDays:0, supportDays:0, allDays:0,
      labour:0, material:0, revenue:0, profit:0, productivity:0,
      labourPerSqft:0, materialPerSqft:0, revenuePerSqft:0, profitPerSqft:0,
      flatSet:new Set<string>(), layerSet:new Set<string>(), appSet:new Set<string>(),
    };
    current.entries += 1;
    current.layerOrder = Math.min(current.layerOrder, entry.layerOrder);
    current.allDays += entry.labourDays;
    if (entry.area > 0) {
      current.area += entry.area;
      current.measuredDays += entry.labourDays;
    } else {
      current.supportDays += entry.labourDays;
    }
    current.labour += entry.labour;
    current.material += entry.material;
    current.revenue += entry.revenue;
    current.profit += entry.profit;
    if (entry.flatId) current.flatSet.add(`${entry.application}__${entry.flatId}`);
    if (entry.workLayer) current.layerSet.add(entry.workLayer);
    if (entry.application) current.appSet.add(entry.application);
    map.set(key,current);
  });
  return [...map.values()].map((r) => ({
    key:r.key,label:r.label,workLayer:r.workLayer,layerOrder:r.layerOrder,entries:r.entries,
    flats:r.flatSet.size,layers:r.layerSet.size,applications:r.appSet.size,area:r.area,measuredDays:r.measuredDays,supportDays:r.supportDays,allDays:r.allDays,
    labour:r.labour,material:r.material,revenue:r.revenue,profit:r.profit,
    productivity:safeDivide(r.area,r.measuredDays),
    labourPerSqft:safeDivide(r.labour,r.area),materialPerSqft:safeDivide(r.material,r.area),
    revenuePerSqft:safeDivide(r.revenue,r.area),profitPerSqft:safeDivide(r.profit,r.area),
  }));
}

function ProductivityByLayerChart({ rows }: { rows: ProductivityMetricRow[] }) {
  const chartRows = useMemo(() => rows.filter((r)=>r.productivity>0).sort((a,b)=>a.layerOrder-b.layerOrder || naturalCompare(a.label,b.label)),[rows]);
  const max = Math.max(1,...chartRows.map((r)=>r.productivity));
  return <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
    <div className="mb-3 flex items-baseline justify-between"><h3 className="text-sm font-bold text-slate-950">Productivity by work layer</h3><span className="font-mono text-[11px] text-slate-500">sqft per labour-day · in running order</span></div>
    <div className="space-y-2">{chartRows.map((r)=><div key={r.key} className="grid grid-cols-[minmax(140px,1fr)_minmax(160px,1.3fr)_90px] items-center gap-3 text-sm"><div className="truncate" title={r.label}>{r.label}</div><div className="h-4 rounded-sm bg-slate-100"><span className="block h-full rounded-sm bg-blue-400" style={{width:`${Math.max(2,r.productivity/max*100)}%`}} /></div><div className="text-right font-mono font-semibold">{formatNumber(r.productivity)}</div></div>)}</div>
  </div>;
}

function ProductivityTrendChart({ entries }: { entries: ProductivityEntry[] }) {
  const daily = useMemo(() => {
    const map = new Map<string,{area:number;days:number}>();
    entries.forEach((e)=>{ if (!e.workDate || e.area<=0 || e.labourDays<=0) return; const c=map.get(e.workDate)||{area:0,days:0}; c.area+=e.area;c.days+=e.labourDays;map.set(e.workDate,c); });
    return [...map.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,v])=>({date,value:safeDivide(v.area,v.days)}));
  },[entries]);
  const width=900,height=150,padX=18,padY=18,max=Math.max(1,...daily.map(d=>d.value));
  const pts=daily.map((d,i)=>({x:daily.length<=1?width/2:padX+i*(width-padX*2)/(daily.length-1),y:height-padY-(d.value/max)*(height-padY*2),...d}));
  const line=pts.map((p,i)=>`${i?'L':'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath=pts.length?`${line} L ${pts[pts.length-1].x.toFixed(1)} ${(height-padY).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(height-padY).toFixed(1)} Z`:'';
  const labelStep=Math.max(1,Math.ceil(daily.length/6));
  return <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-baseline justify-between"><h3 className="text-sm font-bold text-slate-950">Productivity trend</h3><span className="font-mono text-[11px] text-slate-500">daily, area ÷ labour</span></div>{pts.length===0?<div className="py-8 text-center text-sm text-slate-500">No dated productivity data.</div>:<svg viewBox={`0 0 ${width} ${height+26}`} className="h-[176px] w-full"><path d={areaPath} fill="rgba(96,165,250,.10)"/><path d={line} fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-300"/>{pts.map((p,i)=><g key={p.date}><circle cx={p.x} cy={p.y} r="3" className="fill-emerald-400"><title>{`${fullDateLabel(p.date)} · ${formatNumber(p.value)} sqft/day`}</title></circle>{(i%labelStep===0||i===pts.length-1)&&<text x={p.x} y={height+12} textAnchor="middle" className="fill-slate-500 font-mono text-[9px]">{shortDateLabel(p.date)}</text>}</g>)}</svg>}</div>;
}

function ProductivityMetricTable({ title, rows, mode }: { title:string; rows:ProductivityMetricRow[]; mode:'layer'|'application'|'flat' }) {
  const sorted=useMemo(()=> mode==='layer'?[...rows].sort((a,b)=>a.layerOrder-b.layerOrder||naturalCompare(a.label,b.label)):[...rows].sort((a,b)=>naturalCompare(a.label,b.label)),[rows,mode]);
  return <section className="mt-6"><h2 className="mb-3 text-lg font-bold text-slate-950">{title}</h2><div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm"><table className="w-full min-w-[1100px] border-collapse text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-[.14em] text-slate-500"><tr><th className="px-3 py-3 text-left">{mode==='layer'?'Work layer':mode==='application'?'Application':'Flat'}</th>{mode==='layer'&&<th className="px-3 py-3 text-right">Entries</th>}{mode==='application'&&<th className="px-3 py-3 text-right">Layers</th>}<th className="px-3 py-3 text-right">Area</th><th className="px-3 py-3 text-right">Measured days</th><th className="px-3 py-3 text-right">Support days</th><th className="px-3 py-3 text-right">Productivity</th><th className="px-3 py-3 text-right">Labour ₹/sqft</th>{mode==='layer'&&<><th className="px-3 py-3 text-right">Material ₹/sqft</th><th className="px-3 py-3 text-right">Revenue ₹/sqft</th><th className="px-3 py-3 text-right">Profit ₹/sqft</th></>}</tr></thead><tbody className="font-mono text-slate-950">{sorted.map((r)=><tr key={r.key} className="border-t border-slate-100"><td className="px-3 py-2 text-left font-sans">{r.label}{mode==='layer'&&r.area<=0?<span className="ml-2 rounded bg-slate-100 px-1.5 py-.5 text-[9px] uppercase text-slate-500">no area</span>:null}</td>{mode==='layer'&&<td className="px-3 py-2 text-right">{r.entries}</td>}{mode==='application'&&<td className="px-3 py-2 text-right">{r.layers}</td>}<td className="px-3 py-2 text-right">{r.area>0?formatNumber(r.area):'—'}</td><td className="px-3 py-2 text-right">{r.measuredDays>0?formatDecimal(r.measuredDays,1):'—'}</td><td className="px-3 py-2 text-right">{r.supportDays>0?formatDecimal(r.supportDays,1):'—'}</td><td className="px-3 py-2 text-right font-bold">{r.productivity>0?formatNumber(r.productivity):'—'}</td><td className="px-3 py-2 text-right">{r.area>0?formatMoneyPerSqft(r.labourPerSqft):'—'}</td>{mode==='layer'&&<><td className="px-3 py-2 text-right">{r.area>0?formatMoneyPerSqft(r.materialPerSqft):'—'}</td><td className="px-3 py-2 text-right">{r.area>0?formatMoneyPerSqft(r.revenuePerSqft):'—'}</td><td className={`px-3 py-2 text-right ${profitClass(r.profitPerSqft)}`}>{r.area>0?formatMoneyPerSqft(r.profitPerSqft):'—'}</td></>}</tr>)}</tbody></table></div></section>;
}

function buildProductivityDrilldown(entries: ProductivityEntry[], mode:'application'|'layer'): ProductivityDrillTopRow[] {
  const topMap=new Map<string,ProductivityEntry[]>();
  entries.forEach((e)=>{const k=mode==='application'?e.application:e.workLayer;const a=topMap.get(k)||[];a.push(e);topMap.set(k,a);});
  return [...topMap.entries()].sort(([a],[b])=> mode==='layer'?((Math.min(...(topMap.get(a)||[]).map(e=>e.layerOrder))-Math.min(...(topMap.get(b)||[]).map(e=>e.layerOrder)))||naturalCompare(a,b)):naturalCompare(a,b)).map(([topKey,topEntries])=>{
    const childMap=new Map<string,ProductivityEntry[]>();
    topEntries.forEach((e)=>{const k=mode==='application'?e.workLayer:e.application;const a=childMap.get(k)||[];a.push(e);childMap.set(k,a);});
    const top=aggregateProductivityRows(topEntries,()=>topKey,()=>topKey)[0];
    const children=[...childMap.entries()].map(([childKey,childEntries])=>{
      const child=aggregateProductivityRows(childEntries,()=>childKey,()=>childKey)[0];
      const flatChildren=aggregateProductivityRows(childEntries,(e)=>`${e.application}__${e.flatId}`,(e)=>e.flatId).sort((a,b)=>naturalCompare(a.label,b.label));
      return {...child,flatChildren};
    }).sort((a,b)=>mode==='application'?(a.layerOrder-b.layerOrder||naturalCompare(a.label,b.label)):naturalCompare(a.label,b.label));
    return {...top,children};
  });
}

function ProductivityDrilldown({ entries }: { entries: ProductivityEntry[] }) {
  const [mode,setMode]=useState<'application'|'layer'>('application');
  const [open,setOpen]=useState<Set<string>>(new Set());
  const rows=useMemo(()=>buildProductivityDrilldown(entries,mode),[entries,mode]);
  const toggle=(k:string)=>setOpen((cur)=>{const n=new Set(cur);n.has(k)?n.delete(k):n.add(k);return n;});
  const cells=(r:ProductivityMetricRow)=><><td className="px-3 py-2 text-right">{r.entries}</td><td className="px-3 py-2 text-right">{r.flats}</td><td className="px-3 py-2 text-right">{r.area>0?formatNumber(r.area):'—'}</td><td className="px-3 py-2 text-right">{r.measuredDays>0?formatDecimal(r.measuredDays,1):'—'}</td><td className="px-3 py-2 text-right">{r.productivity>0?formatNumber(r.productivity):'—'}</td><td className="px-3 py-2 text-right">{r.supportDays>0?formatDecimal(r.supportDays,1):'—'}</td><td className="px-3 py-2 text-right">{r.area>0?formatMoneyPerSqft(r.labourPerSqft):'—'}</td><td className="px-3 py-2 text-right">{r.area>0?formatMoneyPerSqft(r.revenuePerSqft):'—'}</td><td className={`px-3 py-2 text-right ${profitClass(r.profitPerSqft)}`}>{r.area>0?formatMoneyPerSqft(r.profitPerSqft):'—'}</td></>;
  return <section className="mt-6"><div className="mb-3 flex items-center gap-3"><div><h2 className="text-lg font-bold text-slate-950">Productivity drill-down</h2><p className="text-sm text-slate-500">All labour-booked entries; measured productivity excludes zero-area support work.</p></div><div className="ml-auto flex gap-2"><button onClick={()=>setMode('application')} className={`rounded px-3 py-2 text-sm ${mode==='application'?'bg-slate-950 text-white':'border bg-white'}`}>Application → Layer → Flat</button><button onClick={()=>setMode('layer')} className={`rounded px-3 py-2 text-sm ${mode==='layer'?'bg-slate-950 text-white':'border bg-white'}`}>Layer → Application → Flat</button></div></div><div className="overflow-x-auto rounded-md border bg-white shadow-sm"><table className="w-full min-w-[1260px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-[.14em] text-slate-500"><tr><th className="px-3 py-3 text-left">{mode==='application'?'Application':'Work layer'}</th><th className="px-3 py-3 text-right">Entries</th><th className="px-3 py-3 text-right">Flats</th><th className="px-3 py-3 text-right">Area</th><th className="px-3 py-3 text-right">Measured days</th><th className="px-3 py-3 text-right">Productivity</th><th className="px-3 py-3 text-right">Support days</th><th className="px-3 py-3 text-right">Labour ₹/sqft</th><th className="px-3 py-3 text-right">Revenue ₹/sqft</th><th className="px-3 py-3 text-right">Profit ₹/sqft</th></tr></thead><tbody className="font-mono">{rows.map((top)=>{const tk=`pdt-${mode}-${top.key}`,to=open.has(tk);return <Fragment key={tk}><tr onClick={()=>toggle(tk)} className="cursor-pointer border-t bg-white hover:bg-slate-50"><td className="px-3 py-2 text-left font-sans font-bold"><span className="mr-2 text-blue-400">{to?'▼':'▶'}</span>{top.label}</td>{cells(top)}</tr>{to&&top.children.map((child)=>{const ck=`${tk}-${child.key}`,co=open.has(ck);return <Fragment key={ck}><tr onClick={()=>toggle(ck)} className="cursor-pointer border-t bg-slate-50"><td className="px-3 py-2 pl-8 text-left font-sans font-semibold"><span className="mr-2 text-blue-400">{co?'▼':'▶'}</span>{child.label}</td>{cells(child)}</tr>{co&&child.flatChildren.map((flat)=><tr key={`${ck}-${flat.key}`} className="border-t"><td className="px-3 py-2 pl-14 text-left font-sans">{flat.label}</td>{cells(flat)}</tr>)}</Fragment>})}</Fragment>})}</tbody></table></div></section>;
}

function SupportLabourTable({ entries, totalDays, overallProductivity }: { entries:ProductivityEntry[]; totalDays:number; overallProductivity:number }) {
  const support=useMemo(()=>aggregateProductivityRows(entries.filter(e=>e.area<=0),(e)=>e.workLayer,(e)=>e.workLayer).sort((a,b)=>b.supportDays-a.supportDays),[entries]);
  return <section className="mt-6"><div className="mb-3"><h2 className="text-lg font-bold text-slate-950">Support labour — no area captured</h2><p className="text-sm text-slate-500">Labour-booked activities that cannot produce a sqft/day productivity ratio.</p></div><div className="overflow-x-auto rounded-md border bg-white shadow-sm"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-[.14em] text-slate-500"><tr><th className="px-3 py-3 text-left">Work layer</th><th className="px-3 py-3 text-right">Entries</th><th className="px-3 py-3 text-right">Flats</th><th className="px-3 py-3 text-right">Applications</th><th className="px-3 py-3 text-right">Support days</th><th className="px-3 py-3 text-right">% of all labour</th><th className="px-3 py-3 text-right">Labour cost</th><th className="px-3 py-3 text-right">₹ per day</th><th className="px-3 py-3 text-right">Area foregone</th></tr></thead><tbody className="font-mono">{support.map((r)=><tr key={r.key} className="border-t"><td className="px-3 py-2 text-left font-sans">{r.label}</td><td className="px-3 py-2 text-right">{r.entries}</td><td className="px-3 py-2 text-right">{r.flats}</td><td className="px-3 py-2 text-right">{r.applications || '—'}</td><td className="px-3 py-2 text-right">{formatDecimal(r.supportDays,1)}</td><td className="px-3 py-2 text-right">{totalDays>0?`${formatDecimal(r.supportDays*100/totalDays,1)}%`:'—'}</td><td className="px-3 py-2 text-right">{formatCurrencyOrDash(r.labour)}</td><td className="px-3 py-2 text-right">{r.supportDays>0?formatCurrency(r.labour/r.supportDays):'—'}</td><td className="px-3 py-2 text-right text-slate-400">{overallProductivity>0?formatNumber(r.supportDays*overallProductivity):'—'}</td></tr>)}{support.length===0&&<tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">No support labour without measurable area.</td></tr>}</tbody></table></div></section>;
}

function EntriesBelowLayerPaceTable({ entries, layerRows }: { entries:ProductivityEntry[]; layerRows:ProductivityMetricRow[] }) {
  const slow=useMemo(()=>{const norms=new Map(layerRows.map(r=>[normalizeAnalyticsLayerName(r.label),r.productivity]));return entries.filter(e=>e.area>0&&e.labourDays>0).map(e=>{const norm=norms.get(normalizeAnalyticsLayerName(e.workLayer))||0;const productivity=e.area/e.labourDays;const ideal=norm>0?e.area/norm:0;return {...e,productivity,layerNorm:norm,labourDaysLost:Math.max(0,e.labourDays-ideal)};}).filter(e=>e.layerNorm>0&&e.productivity<e.layerNorm*.6&&e.labourDaysLost>.01).sort((a,b)=>b.labourDaysLost-a.labourDaysLost)},[entries,layerRows]);
  return <section className="mt-6"><div className="mb-3"><h2 className="text-lg font-bold text-slate-950">Entries running below their layer pace</h2><p className="text-sm text-slate-500">Under 60% of the layer norm · ranked by labour days lost.</p></div><div className="max-h-[440px] overflow-auto rounded-md border bg-white shadow-sm"><table className="w-full min-w-[920px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-[.14em] text-slate-500"><tr><th className="px-3 py-3 text-left">Flat</th><th className="px-3 py-3 text-left">Date</th><th className="px-3 py-3 text-left">Work layer</th><th className="px-3 py-3 text-right">Area</th><th className="px-3 py-3 text-right">Labour days</th><th className="px-3 py-3 text-right">Productivity</th><th className="px-3 py-3 text-right">Layer norm</th><th className="px-3 py-3 text-right">Labour days lost</th></tr></thead><tbody className="font-mono">{slow.map((r,i)=><tr key={`${r.application}-${r.flatId}-${r.workDate}-${r.workLayer}-${i}`} className="border-t"><td className="px-3 py-2 text-left font-sans">{r.flatId} <span className="text-slate-400">{r.application}</span></td><td className="px-3 py-2 text-left">{fullDateLabel(r.workDate)}</td><td className="px-3 py-2 text-left font-sans">{r.workLayer}</td><td className="px-3 py-2 text-right">{formatNumber(r.area)}</td><td className="px-3 py-2 text-right">{formatDecimal(r.labourDays,1)}</td><td className="px-3 py-2 text-right text-red-600">{formatNumber(r.productivity)}</td><td className="px-3 py-2 text-right text-slate-400">{formatNumber(r.layerNorm)}</td><td className="px-3 py-2 text-right text-red-600">{formatDecimal(r.labourDaysLost,1)}</td></tr>)}{slow.length===0&&<tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">No below-pace entries for the selected filters.</td></tr>}</tbody></table></div></section>;
}

function ProductivityTab({ flatRows, dateTimelineRows: _dateTimelineRows, kpis: _kpis }: { flatRows:FlatSummaryRow[]; dateTimelineRows:DateTimelineRow[]; kpis:ExecutiveSummaryResponse['kpis'] }) {
  const rawEntries=useMemo(()=>buildProductivityEntries(flatRows),[flatRows]);
  const layerSequence=useMemo(()=>buildProductivityLayerSequence(rawEntries),[rawEntries]);
  const entries=useMemo(()=>rawEntries.map(e=>({...e,layerOrder:layerSequence.get(normalizeAnalyticsLayerName(e.workLayer))??e.layerOrder})),[rawEntries,layerSequence]);
  const totalArea=entries.reduce((s,e)=>s+(e.area>0?e.area:0),0);
  const measuredDays=entries.reduce((s,e)=>s+(e.area>0?e.labourDays:0),0);
  const supportDays=entries.reduce((s,e)=>s+(e.area<=0?e.labourDays:0),0);
  const totalDays=measuredDays+supportDays;
  const overall=safeDivide(totalArea,measuredDays);
  const effective=safeDivide(totalArea,totalDays);
  const layerRows=useMemo(()=>aggregateProductivityRows(entries,e=>e.workLayer,e=>e.workLayer).sort((a,b)=>a.layerOrder-b.layerOrder||naturalCompare(a.label,b.label)),[entries]);
  const appRows=useMemo(()=>aggregateProductivityRows(entries,e=>e.application,e=>e.application),[entries]);
  const flatRowsAgg=useMemo(()=>aggregateProductivityRows(entries,e=>`${e.application}__${e.flatId}`,e=>`${e.application} · ${e.flatId}`),[entries]);
  const measuredLayers=layerRows.filter(r=>r.productivity>0);
  const best=[...measuredLayers].sort((a,b)=>b.productivity-a.productivity)[0];
  const weak=[...measuredLayers].sort((a,b)=>a.productivity-b.productivity)[0];
  const slowCount=entries.filter(e=>e.area>0&&e.labourDays>0).filter(e=>{const n=layerRows.find(r=>normalizeAnalyticsLayerName(r.label)===normalizeAnalyticsLayerName(e.workLayer))?.productivity||0;return n>0&&(e.area/e.labourDays)<n*.6}).length;
  const labourCost=entries.reduce((s,e)=>s+e.labour,0);
  return <section><div className="aph-kpi-grid"><KpiCard label="Overall productivity" value={overall>0?formatNumber(overall):'—'} sub="sqft / measured labour-day"/><KpiCard label="Best layer" value={best?formatNumber(best.productivity):'—'} sub={best?.label||'no measured work'}/><KpiCard label="Weakest layer" value={weak?formatNumber(weak.productivity):'—'} sub={weak?.label||'no measured work'}/><KpiCard label="Effective productivity" value={effective>0?formatNumber(effective):'—'} sub="including support labour"/><KpiCard label="Support labour" value={formatDecimal(supportDays,1)} sub={`${totalDays>0?formatDecimal(supportDays*100/totalDays,1):'0.0'}% of all days`}/><KpiCard label="Labour days" value={formatDecimal(totalDays,1)} sub={`across ${formatNumber(entries.length)} entries`}/><KpiCard label="Entries below layer pace" value={formatNumber(slowCount)} sub="under 60% of layer norm"/><KpiCard label="Labour cost / sqft" value={totalArea>0?formatMoneyPerSqft(labourCost/totalArea):'—'} sub="at current pace"/></div><div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2"><ProductivityByLayerChart rows={layerRows}/><ProductivityTrendChart entries={entries}/></div><ProductivityMetricTable title="By work layer" rows={layerRows} mode="layer"/><ProductivityMetricTable title="By application" rows={appRows} mode="application"/><ProductivityMetricTable title="By flat" rows={flatRowsAgg} mode="flat"/><ProductivityDrilldown entries={entries}/><SupportLabourTable entries={entries} totalDays={totalDays} overallProductivity={overall}/><EntriesBelowLayerPaceTable entries={entries} layerRows={layerRows}/></section>;
}


type CostEntry = {
  application: string;
  flatId: string;
  workDate: string;
  workLayer: string;
  layerOrder: number;
  isBillable: boolean;
  area: number;
  labourDays: number;
  bookedDays: number;
  targetDays: number;
  vsTarget: number;
  targetUsePct: number;
  labour: number;
  material: number;
  revenue: number;
  profit: number;
  productivity: number;
};

type CostMetricRow = {
  key: string;
  label: string;
  workLayer?: string;
  layerOrder: number;
  entries: number;
  flats: number;
  area: number;
  labourDays: number;
  bookedDays: number;
  targetDays: number;
  vsTarget: number;
  targetUsePct: number;
  labour: number;
  material: number;
  revenue: number;
  profit: number;
  productivity: number;
  labourPerSqft: number;
  materialPerSqft: number;
  costPerSqft: number;
  revenuePerSqft: number;
  profitPerSqft: number;
};

type CostDrillFlatRow = CostMetricRow & {
  layerChildren: CostMetricRow[];
};

type CostDrillApplicationRow = CostMetricRow & {
  flatChildren: CostDrillFlatRow[];
};


type TrendView = 'overall' | 'app' | 'flat';
type TrendKind = 'prod' | 'cov';
type TrendState = 'up' | 'down' | 'flat' | 'nodata';

type TrendMonthBucket = {
  area: number;
  denominator: number;
  targetArea: number;
  targetDivisor: number;
};

type TrendGroup = {
  key: string;
  head: string;
  tail: string;
  label: string;
  order: number;
  monthData: Record<string, TrendMonthBucket>;
  values: Array<number | null>;
  targetByMonth: Array<number | null>;
  target: number;
  totalArea: number;
  mix: boolean;
  mixNote: string;
  last: number | null;
  trend: { key: TrendState; text: string; delta?: number };
  vsTarget: number | null;
  gap: number | null;
};

const TREND_TOLERANCE = 3;
const TREND_PAIRWISE_MAX = 4;

function trendMonthLabel(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function trendMonthShort(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    timeZone: 'UTC',
  });
}

function formatTrendRate(value: number | null | undefined) {
  const numberValue = Number(value || 0);
  if (!(numberValue > 0)) return '—';
  return numberValue >= 100
    ? Math.round(numberValue).toLocaleString('en-IN')
    : numberValue.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function buildTrendLayerSequence(rows: TrendAnalysisCell[]) {
  const byApplication = new Map<string, Map<string, { workLayer: string; layerOrder: number }>>();

  rows.forEach((row) => {
    const application = row.application || 'Unassigned';
    const key = normalizeAnalyticsLayerName(row.workLayer);
    if (!key) return;
    let layers = byApplication.get(application);
    if (!layers) {
      layers = new Map();
      byApplication.set(application, layers);
    }
    const current = layers.get(key);
    const order = Number(row.layerOrder || 999);
    if (!current || order < current.layerOrder) {
      layers.set(key, { workLayer: row.workLayer, layerOrder: order });
    }
  });

  const sequence = new Map<string, number>();
  let index = 0;
  [...byApplication.entries()]
    .sort(([a], [b]) => naturalCompare(a, b))
    .forEach(([, layers]) => {
      [...layers.entries()]
        .sort(([, a], [, b]) => a.layerOrder - b.layerOrder || naturalCompare(a.workLayer, b.workLayer))
        .forEach(([key]) => {
          if (!sequence.has(key)) sequence.set(key, index++);
        });
    });

  [...new Set(rows.map((row) => row.workLayer).filter(Boolean))]
    .sort(naturalCompare)
    .forEach((layer) => {
      const key = normalizeAnalyticsLayerName(layer);
      if (key && !sequence.has(key)) sequence.set(key, index++);
    });

  return sequence;
}

function trendDirection(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  if (valid.length < 2) return { key: 'nodata' as TrendState, text: 'No data' };
  const previous = valid[valid.length - 2];
  const latest = valid[valid.length - 1];
  const delta = ((latest - previous) / previous) * 100;
  if (delta > TREND_TOLERANCE) return { key: 'up' as TrendState, text: 'Improving', delta };
  if (delta < -TREND_TOLERANCE) return { key: 'down' as TrendState, text: 'Declining', delta };
  return { key: 'flat' as TrendState, text: 'Stable', delta };
}

function buildTrendGroups(
  kind: TrendKind,
  rows: TrendAnalysisCell[],
  months: string[],
  view: TrendView,
  applicationValue: string,
  flatValue: string,
) {
  const selectedApplications = new Set(parseMultiValue(applicationValue));
  const selectedFlats = new Set(parseMultiValue(flatValue));
  const monthSet = new Set(months);
  const sequence = buildTrendLayerSequence(rows);
  const groups = new Map<string, TrendGroup & { parts: Map<string, { area: number; targetArea: number; targetDivisor: number }> }>();

  rows.forEach((row) => {
    if (!monthSet.has(row.month)) return;
    if (selectedApplications.size && !selectedApplications.has(row.application)) return;
    if (selectedFlats.size && !selectedFlats.has(row.flatId)) return;

    const isProductivity = kind === 'prod';
    const area = isProductivity ? Number(row.productivityArea || 0) : Number(row.coverageArea || 0);
    const denominator = isProductivity ? Number(row.labourDays || 0) : Number(row.materialUsed || 0);
    const tail = isProductivity ? row.workLayer : row.materialName;
    if (!tail || !(area > 0) || !(denominator > 0)) return;

    const flatHead = [row.block, row.application, row.flatId].filter(Boolean).join(' · ');
    const head = view === 'app' ? row.application : view === 'flat' ? flatHead : '';
    const key = `${head}\u0001${tail}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        head,
        tail,
        label: head ? `${head} ‹ ${tail}` : tail,
        order: isProductivity ? (sequence.get(normalizeAnalyticsLayerName(tail)) ?? 9_000_000) : 0,
        monthData: {},
        values: [],
        targetByMonth: [],
        target: 0,
        totalArea: 0,
        mix: false,
        mixNote: '',
        last: null,
        trend: { key: 'nodata', text: 'No data' },
        vsTarget: null,
        gap: null,
        parts: new Map(),
      };
      groups.set(key, group);
    }

    const bucket = group.monthData[row.month] || { area: 0, denominator: 0, targetArea: 0, targetDivisor: 0 };
    bucket.area += area;
    bucket.denominator += denominator;
    group.monthData[row.month] = bucket;
    group.totalArea += area;

    const target = isProductivity ? Number(row.targetProductivity || 0) : Number(row.targetCoverage || 0);
    if (target > 0) {
      bucket.targetArea += area;
      bucket.targetDivisor += area / target;
      let part = group.parts.get(row.application);
      if (!part) {
        part = { area: 0, targetArea: 0, targetDivisor: 0 };
        group.parts.set(row.application, part);
      }
      part.area += area;
      part.targetArea += area;
      part.targetDivisor += area / target;
    }
  });

  const output = [...groups.values()];
  output.forEach((group) => {
    group.values = months.map((month) => {
      const bucket = group.monthData[month];
      return bucket && bucket.denominator > 0 ? bucket.area / bucket.denominator : null;
    });
    group.targetByMonth = months.map((month) => {
      const bucket = group.monthData[month];
      return bucket && bucket.targetDivisor > 0 ? bucket.targetArea / bucket.targetDivisor : null;
    });

    let latestIndex = -1;
    group.values.forEach((value, index) => {
      if (value != null) latestIndex = index;
    });

    const allTargetArea = Object.values(group.monthData).reduce((sum, item) => sum + item.targetArea, 0);
    const allTargetDivisor = Object.values(group.monthData).reduce((sum, item) => sum + item.targetDivisor, 0);
    group.target = latestIndex >= 0 && group.targetByMonth[latestIndex] != null
      ? Number(group.targetByMonth[latestIndex])
      : allTargetDivisor > 0
        ? allTargetArea / allTargetDivisor
        : 0;

    const parts = [...group.parts.entries()].map(([application, part]) => ({
      application,
      area: part.area,
      target: part.targetDivisor > 0 ? part.targetArea / part.targetDivisor : 0,
    })).filter((part) => part.target > 0).sort((a, b) => b.area - a.area);

    if (parts.length > 1) {
      const targets = parts.map((part) => part.target);
      const minimum = Math.min(...targets);
      group.mix = minimum > 0 && Math.max(...targets) - minimum > minimum * TREND_TOLERANCE / 100;
    }
    group.mixNote = parts.map((part) => `${part.application} ${formatTrendRate(part.target)}`).join(' · ');
    const latest = [...group.values].reverse().find((value) => value != null);
    group.last = latest == null ? null : latest;
    group.trend = trendDirection(group.values);
    group.vsTarget = group.last && group.target > 0 ? (group.last / group.target) * 100 : null;
    group.gap = group.last && group.target > 0 ? group.last - group.target : null;
  });

  output.sort((a, b) => naturalCompare(a.head, b.head) || a.order - b.order || naturalCompare(a.tail, b.tail));
  return output;
}

function TrendMovement({ current, previous }: { current: number | null; previous: number | null }) {
  if (!(current && previous) || previous <= 0 || current <= 0) return <span className="text-slate-400">—</span>;
  const absolute = current - previous;
  const percent = (absolute / previous) * 100;
  const className = percent > TREND_TOLERANCE ? 'text-emerald-700' : percent < -TREND_TOLERANCE ? 'text-red-700' : 'text-slate-400';
  return (
    <span className={className}>
      {absolute >= 0 ? '+' : '−'}{formatTrendRate(Math.abs(absolute))}
      <span className="aph-trend-move-pct"> ({percent >= 0 ? '+' : '−'}{Math.abs(percent).toFixed(1)}%)</span>
    </span>
  );
}

function TrendStatusChip({ state, label }: { state: TrendState; label: string }) {
  return <span className={`aph-trend-status aph-trend-status-${state}`}>{label}</span>;
}

function TrendKpiCard({
  label,
  value,
  sub,
  valueClassName = '',
}: {
  label: string;
  value: string;
  sub: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="border border-slate-200 bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold text-slate-950 ${valueClassName}`}>{value}</p>
      <div className="mt-1 font-mono text-[11px] text-slate-500">{sub}</div>
    </div>
  );
}

type TrendTableColumn = {
  key: string;
  label: string;
  align?: 'left' | 'right';
  tooltip?: string;
  value: (group: TrendGroup) => string | number;
  render: (group: TrendGroup) => ReactNode;
};

function TrendTable({
  kind,
  view,
  months,
  groups,
}: {
  kind: TrendKind;
  view: TrendView;
  months: string[];
  groups: TrendGroup[];
}) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({
    key: view === 'overall' ? 'name' : 'head',
    direction: 'asc',
  });
  const monthsKey = months.join('|');

  useEffect(() => {
    setSort({ key: view === 'overall' ? 'name' : 'head', direction: 'asc' });
  }, [view, kind, monthsKey]);

  const pairwise = months.length <= TREND_PAIRWISE_MAX;
  const latestMonth = months[months.length - 1];
  const columns: TrendTableColumn[] = [];

  if (view !== 'overall') {
    columns.push({ key: 'head', label: view === 'app' ? 'Application' : 'Flat', align: 'left', value: (group) => group.head, render: (group) => <span className="text-slate-500">{group.head}</span> });
  }
  columns.push({ key: 'name', label: kind === 'prod' ? 'Work layer' : 'Material', align: 'left', value: (group) => group.order, render: (group) => <b>{group.tail}</b> });

  months.forEach((month, index) => {
    columns.push({
      key: `m${index}`,
      label: trendMonthLabel(month),
      value: (group) => group.values[index] ?? -1,
      render: (group) => formatTrendRate(group.values[index]),
    });
    if (pairwise && index > 0) {
      columns.push({
        key: `d${index}`,
        label: `${trendMonthShort(month)} vs ${trendMonthShort(months[index - 1])}`,
        value: (group) => group.values[index] != null && group.values[index - 1] != null
          ? ((Number(group.values[index]) - Number(group.values[index - 1])) / Number(group.values[index - 1])) * 100
          : -1_000_000,
        render: (group) => <TrendMovement current={group.values[index]} previous={group.values[index - 1]} />,
      });
    }
  });

  if (!pairwise) {
    columns.push({
      key: 'dprev',
      label: 'vs previous month',
      tooltip: 'The latest month with work against the one before it.',
      value: (group) => {
        const valid = group.values.filter((value): value is number => value != null);
        if (valid.length < 2) return -1_000_000;
        return ((valid[valid.length - 1] - valid[valid.length - 2]) / valid[valid.length - 2]) * 100;
      },
      render: (group) => {
        const valid = group.values.filter((value): value is number => value != null);
        return <TrendMovement current={valid.length ? valid[valid.length - 1] : null} previous={valid.length > 1 ? valid[valid.length - 2] : null} />;
      },
    });
    columns.push({
      key: 'dfirst',
      label: `vs ${trendMonthLabel(months[0])}`,
      tooltip: 'The latest month against the first month on screen.',
      value: (group) => {
        const valid = group.values.filter((value): value is number => value != null);
        if (valid.length < 2) return -1_000_000;
        return ((valid[valid.length - 1] - valid[0]) / valid[0]) * 100;
      },
      render: (group) => {
        const valid = group.values.filter((value): value is number => value != null);
        return <TrendMovement current={valid.length ? valid[valid.length - 1] : null} previous={valid.length > 1 ? valid[0] : null} />;
      },
    });
  }

  columns.push({
    key: 'target',
    label: 'Target',
    tooltip: view === 'overall'
      ? 'The same layer can carry different targets in different applications. Overall shows the area-weighted blend of the applications that did the work in the latest month.'
      : 'The target rate for this application and layer.',
    value: (group) => group.target,
    render: (group) => group.target > 0
      ? <span className={group.mix ? 'aph-trend-mix' : ''} title={group.mix ? group.mixNote : undefined}>{formatTrendRate(group.target)}{group.mix && <small> blend</small>}</span>
      : '—',
  });
  columns.push({
    key: 'vs',
    label: `${trendMonthShort(latestMonth)} vs target`,
    value: (group) => group.vsTarget ?? -1,
    render: (group) => {
      if (group.vsTarget == null) return '—';
      const className = group.vsTarget >= 100 ? 'text-emerald-700' : group.vsTarget < 85 ? 'text-red-700' : '';
      return <span className={className}>{group.vsTarget.toFixed(1)}%</span>;
    },
  });
  columns.push({
    key: 'gap',
    label: 'Gap',
    tooltip: `Latest month minus target, in ${kind === 'prod' ? 'sqft / labour day' : 'sqft / unit'}.`,
    value: (group) => group.gap ?? -1_000_000,
    render: (group) => group.gap == null
      ? '—'
      : <span className={group.gap >= 0 ? 'text-emerald-700' : 'text-red-700'}>{group.gap >= 0 ? '+' : '−'}{formatTrendRate(Math.abs(group.gap))}</span>,
  });
  columns.push({
    key: 'trend',
    label: 'Trend',
    align: 'left',
    value: (group) => ({ up: 3, flat: 2, down: 1, nodata: 0 })[group.trend.key],
    render: (group) => <TrendStatusChip state={group.trend.key} label={group.trend.text} />,
  });

  const sorted = useMemo(() => {
    const column = columns.find((item) => item.key === sort.key) || columns[0];
    return [...groups].sort((a, b) => {
      const av = column.value(a);
      const bv = column.value(b);
      let result = 0;
      if (typeof av === 'string' || typeof bv === 'string') result = naturalCompare(String(av), String(bv));
      else result = Number(av) === Number(bv) ? 0 : Number(av) > Number(bv) ? 1 : -1;
      if (!result) result = a.order - b.order || naturalCompare(a.tail, b.tail);
      return sort.direction === 'asc' ? result : -result;
    });
  }, [groups, sort, columns]);

  function sortBy(key: string, defaultDirection: SortDirection = 'desc') {
    setSort((current) => ({
      key,
      direction: nextSortDirection(current.key, key, current.direction, defaultDirection),
    }));
  }

  return (
    <div className="aph-table-scroll overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.12em] text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={`px-3 py-2 ${column.align === 'left' ? 'text-left' : 'text-right'}`} title={column.tooltip}>
                <button type="button" className="aph-sort-button" onClick={() => sortBy(column.key, column.align === 'left' ? 'asc' : 'desc')}>
                  {column.label}{sort.key === column.key ? <span className="ml-1 text-orange-500">{sort.direction === 'asc' ? '▲' : '▼'}</span> : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono text-slate-950">
          {sorted.map((group) => (
            <tr key={group.key} className="border-b border-slate-100 hover:bg-slate-50">
              {columns.map((column) => (
                <td key={column.key} className={`px-3 py-2 whitespace-nowrap ${column.align === 'left' ? 'text-left font-sans' : 'text-right'}`}>
                  {column.render(group)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendSection({
  kind,
  rows,
  months,
  view,
  groups,
  applicationValue,
  flatValue,
  pickValue,
  setApplicationValue,
  setFlatValue,
  setPickValue,
  openFilterKey,
  setOpenFilterKey,
}: {
  kind: TrendKind;
  rows: TrendAnalysisCell[];
  months: string[];
  view: TrendView;
  groups: TrendGroup[];
  applicationValue: string;
  flatValue: string;
  pickValue: string;
  setApplicationValue: (value: string) => void;
  setFlatValue: (value: string) => void;
  setPickValue: (value: string) => void;
  openFilterKey: string | null;
  setOpenFilterKey: Dispatch<SetStateAction<string | null>>;
}) {
  const isProductivity = kind === 'prod';
  const applications = useMemo(() => uniqueSortedValues(rows.map((row) => row.application)), [rows]);
  const selectedApplications = parseMultiValue(applicationValue);
  const flats = useMemo(() => uniqueSortedValues(rows.filter((row) => !selectedApplications.length || selectedApplications.includes(row.application)).map((row) => row.flatId)), [rows, applicationValue]);
  const names = useMemo(() => uniqueSortedValues(groups.map((group) => group.tail)), [groups]);
  const selectedNames = new Set(parseMultiValue(pickValue));
  const shown = selectedNames.size ? groups.filter((group) => selectedNames.has(group.tail)) : groups;

  return (
    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold text-slate-950">{isProductivity ? 'Productivity trend' : 'Material coverage trend'}</h2>
        <p className="text-xs text-slate-500">
          {isProductivity
            ? `Area executed ÷ labour days. Target comes from the approved productivity baseline, falling back to flat area ÷ target labour days.${view === 'overall' ? ' Overall pools applications and area-weights both actuals and targets.' : ''} The trend reads month-to-month movement, not distance from target.`
            : 'Area covered ÷ material quantity consumed. Higher is better. Target is the approved Material Coverage baseline. The trend reads month-to-month movement, not distance from target.'}
        </p>
      </div>

      <div className="aph-trend-toolbar">
        <SearchableMultiSelect filterKey={`trend-${kind}-app`} label="Application" value={applicationValue} options={toMultiSelectOptions(applications)} allLabel="All applications" onChange={setApplicationValue} onApply={() => undefined} openFilterKey={openFilterKey} setOpenFilterKey={setOpenFilterKey} />
        <SearchableMultiSelect filterKey={`trend-${kind}-flat`} label="Flat" value={flatValue} options={toMultiSelectOptions(flats)} allLabel="All flats" onChange={setFlatValue} onApply={() => undefined} openFilterKey={openFilterKey} setOpenFilterKey={setOpenFilterKey} />
        <SearchableMultiSelect filterKey={`trend-${kind}-pick`} label={isProductivity ? 'Work layer' : 'Material'} value={pickValue} options={toMultiSelectOptions(names)} allLabel={isProductivity ? 'All layers' : 'All materials'} onChange={setPickValue} onApply={() => undefined} openFilterKey={openFilterKey} setOpenFilterKey={setOpenFilterKey} />
        <span className="aph-trend-toolbar-meta">{formatNumber(shown.length)} row{shown.length === 1 ? '' : 's'} · {months.map(trendMonthLabel).join(' → ')}</span>
      </div>

      {shown.length ? <TrendTable kind={kind} view={view} months={months} groups={shown} /> : <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nothing to measure here in the current pickers.</div>}
    </section>
  );
}

function TrendAnalysisTab({ data }: { data: NonNullable<ExecutiveSummaryResponse['trendAnalysis']> }) {
  const rows = data.rows || [];
  const allMonths = useMemo(() => [...new Set((data.availableMonths || []).filter(Boolean))].sort(), [data.availableMonths]);
  const [view, setView] = useState<TrendView>('overall');
  const [monthsShown, setMonthsShown] = useState(3);
  const [prodApplications, setProdApplications] = useState('');
  const [prodFlats, setProdFlats] = useState('');
  const [prodLayers, setProdLayers] = useState('');
  const [coverageApplications, setCoverageApplications] = useState('');
  const [coverageFlats, setCoverageFlats] = useState('');
  const [coverageMaterials, setCoverageMaterials] = useState('');
  const [openFilterKey, setOpenFilterKey] = useState<string | null>(null);

  const months = useMemo(() => monthsShown ? allMonths.slice(-monthsShown) : allMonths, [allMonths, monthsShown]);

  useEffect(() => {
    if (monthsShown && monthsShown >= allMonths.length) setMonthsShown(0);
  }, [allMonths.length, monthsShown]);

  useEffect(() => {
    const applications = uniqueSortedValues(rows.map((row) => row.application));
    setProdApplications((value) => keepValidMultiValue(value, applications));
    setCoverageApplications((value) => keepValidMultiValue(value, applications));
  }, [rows]);

  const prodFlatOptions = useMemo(() => {
    const apps = parseMultiValue(prodApplications);
    return uniqueSortedValues(rows.filter((row) => !apps.length || apps.includes(row.application)).map((row) => row.flatId));
  }, [rows, prodApplications]);
  const coverageFlatOptions = useMemo(() => {
    const apps = parseMultiValue(coverageApplications);
    return uniqueSortedValues(rows.filter((row) => !apps.length || apps.includes(row.application)).map((row) => row.flatId));
  }, [rows, coverageApplications]);

  useEffect(() => setProdFlats((value) => keepValidMultiValue(value, prodFlatOptions)), [prodFlatOptions]);
  useEffect(() => setCoverageFlats((value) => keepValidMultiValue(value, coverageFlatOptions)), [coverageFlatOptions]);

  const productivityGroups = useMemo(() => buildTrendGroups('prod', rows, months, view, prodApplications, prodFlats), [rows, months, view, prodApplications, prodFlats]);
  const coverageGroups = useMemo(() => buildTrendGroups('cov', rows, months, view, coverageApplications, coverageFlats), [rows, months, view, coverageApplications, coverageFlats]);

  const prodNames = useMemo(() => uniqueSortedValues(productivityGroups.map((group) => group.tail)), [productivityGroups]);
  const coverageNames = useMemo(() => uniqueSortedValues(coverageGroups.map((group) => group.tail)), [coverageGroups]);
  useEffect(() => setProdLayers((value) => keepValidMultiValue(value, prodNames)), [prodNames]);
  useEffect(() => setCoverageMaterials((value) => keepValidMultiValue(value, coverageNames)), [coverageNames]);

  if (!months.length) {
    return <div className="mx-auto mt-10 max-w-xl rounded-md border border-slate-200 bg-white p-8 text-center"><h2 className="text-lg font-bold text-slate-950">No dated work in view</h2><p className="mt-1 text-sm text-slate-500">Trends are built from work dates. Nothing in the current filters carries one.</p></div>;
  }

  const productivityPerMonth = months.map((month) => {
    let area = 0;
    let labour = 0;
    productivityGroups.forEach((group) => {
      const bucket = group.monthData[month];
      if (!bucket) return;
      area += bucket.area;
      labour += bucket.denominator;
    });
    return labour > 0 ? area / labour : null;
  });

  const counts: Record<TrendState, number> = { up: 0, down: 0, flat: 0, nodata: 0 };
  productivityGroups.forEach((group) => { counts[group.trend.key] += 1; });
  let ratioArea = 0;
  let weightedRatio = 0;
  productivityGroups.forEach((group) => {
    if (group.last && group.target > 0) {
      ratioArea += group.totalArea;
      weightedRatio += group.totalArea * (group.last / group.target);
    }
  });
  const vsTarget = ratioArea > 0 ? (weightedRatio / ratioArea) * 100 : null;

  const monthOptions = [3, 6, 12].filter((value) => value < allMonths.length).concat([0]);

  return (
    <div className="space-y-4">
      <div className="aph-kpi-grid">
        {months.map((month, index) => {
          const current = productivityPerMonth[index];
          const previous = index > 0 ? productivityPerMonth[index - 1] : null;
          return (
            <TrendKpiCard
              key={month}
              label={`Productivity ${trendMonthLabel(month)}`}
              value={formatTrendRate(current)}
              sub={index === 0 ? 'sqft per labour day' : <TrendMovement current={current} previous={previous} />}
            />
          );
        })}
        <TrendKpiCard label={`${trendMonthLabel(months[months.length - 1])} vs target`} value={vsTarget == null ? '—' : `${vsTarget.toFixed(1)}%`} sub="area-weighted" valueClassName={vsTarget == null ? '' : vsTarget >= 100 ? 'text-emerald-700' : vsTarget < 85 ? 'text-red-700' : ''} />
        <TrendKpiCard label="Improving" value={formatNumber(counts.up)} sub=" " valueClassName="text-emerald-700" />
        <TrendKpiCard label="Declining" value={formatNumber(counts.down)} sub=" " valueClassName="text-red-700" />
        <TrendKpiCard label="Stable" value={formatNumber(counts.flat)} sub={`within ${TREND_TOLERANCE}%`} />
        <TrendKpiCard label="No data" value={formatNumber(counts.nodata)} sub="fewer than two months" />
      </div>

      <div className="aph-trend-toolbar">
        <span className="aph-trend-toolbar-label">View</span>
        {([['overall', 'Overall'], ['app', 'Application'], ['flat', 'Flat']] as Array<[TrendView, string]>).map(([id, label]) => (
          <button key={id} type="button" className={`aph-trend-chip ${view === id ? 'aph-trend-chip-active' : ''}`} onClick={() => setView(id)}>{label}</button>
        ))}
        <span className="aph-trend-spacer" />
        <span className="aph-trend-toolbar-label">Months shown</span>
        {monthOptions.map((value) => (
          <button key={value} type="button" className={`aph-trend-chip ${monthsShown === value ? 'aph-trend-chip-active' : ''}`} onClick={() => setMonthsShown(value)}>{value ? `Last ${value}` : `All ${allMonths.length}`}</button>
        ))}
        <span className="aph-trend-toolbar-meta">{allMonths.length} month{allMonths.length === 1 ? '' : 's'} on record{months.length > TREND_PAIRWISE_MAX ? ` · month-to-month columns collapse past ${TREND_PAIRWISE_MAX}` : ''}</span>
      </div>

      <TrendSection kind="prod" rows={rows} months={months} view={view} groups={productivityGroups} applicationValue={prodApplications} flatValue={prodFlats} pickValue={prodLayers} setApplicationValue={setProdApplications} setFlatValue={setProdFlats} setPickValue={setProdLayers} openFilterKey={openFilterKey} setOpenFilterKey={setOpenFilterKey} />
      <TrendSection kind="cov" rows={rows} months={months} view={view} groups={coverageGroups} applicationValue={coverageApplications} flatValue={coverageFlats} pickValue={coverageMaterials} setApplicationValue={setCoverageApplications} setFlatValue={setCoverageFlats} setPickValue={setCoverageMaterials} openFilterKey={openFilterKey} setOpenFilterKey={setOpenFilterKey} />
    </div>
  );
}

type CostSortKey =
  | 'label'
  | 'entries'
  | 'flats'
  | 'area'
  | 'labourDays'
  | 'targetDays'
  | 'vsTarget'
  | 'targetUsePct'
  | 'labour'
  | 'material'
  | 'revenue'
  | 'profit'
  | 'productivity'
  | 'labourPerSqft'
  | 'materialPerSqft'
  | 'costPerSqft'
  | 'revenuePerSqft'
  | 'profitPerSqft'
  | 'totalCost'
  | 'shareOfRevenue';

function buildCostEntries(rows: FlatSummaryRow[]) {
  const entries: CostEntry[] = [];

  rows.forEach((flat) => {
    (flat.details || []).forEach((detail) => {
      entries.push({
        application: flat.application || 'Unassigned',
        flatId: flat.flatId || '-',
        workDate: detail.workDate || '',
        workLayer: detail.workLayer || 'Unspecified',
        layerOrder: layerOrderValue(detail),
        isBillable: isAnalyticsBillableLayer(detail.workLayer),
        area: Number(detail.area || 0),
        labourDays: Number(detail.labourDays || 0),
        bookedDays: bookedDaysValue(detail),
        targetDays: Number(detail.targetDays || 0),
        vsTarget: Number(detail.vsTarget || 0),
        targetUsePct: Number(detail.targetUsePct || 0),
        labour: Number(detail.labour || 0),
        material: Number(detail.material || 0),
        revenue: Number(detail.revenue || 0),
        profit: Number(detail.profit || 0),
        productivity: Number(detail.productivity || 0),
      });
    });
  });

  return entries;
}

function aggregateCostEntries(
  entries: CostEntry[],
  keyFn: (entry: CostEntry) => string,
  labelFn: (entry: CostEntry) => string,
) {
  const map = new Map<string, CostEntry[]>();

  entries.forEach((entry) => {
    const key = keyFn(entry);
    const current = map.get(key) || [];
    current.push(entry);
    map.set(key, current);
  });

  return Array.from(map.entries()).map(([key, items]) => {
    const first = items[0];
    const area = items.reduce((sum, item) => sum + item.area, 0);
    const labourDays = items.reduce((sum, item) => sum + item.labourDays, 0);
    const bookedDays = items.reduce((sum, item) => sum + (item.bookedDays || item.labourDays), 0);
    const targetDays = items.reduce((sum, item) => sum + (item.targetDays || 0), 0);
    const labour = items.reduce((sum, item) => sum + item.labour, 0);
    const material = items.reduce((sum, item) => sum + item.material, 0);
    const revenue = items.reduce((sum, item) => sum + item.revenue, 0);
    const profit = items.reduce((sum, item) => sum + item.profit, 0);

    return {
      key,
      label: labelFn(first),
      workLayer: first.workLayer,
      layerOrder: Math.min(...items.map((item) => layerOrderValue(item))),
      entries: items.length,
      flats: new Set(items.map((item) => `${item.application}__${item.flatId}`)).size,
      area,
      labourDays,
      bookedDays,
      targetDays,
      vsTarget: bookedDays - targetDays,
      targetUsePct: targetDays > 0 ? (bookedDays * 100) / targetDays : 0,
      labour,
      material,
      revenue,
      profit,
      productivity: labourDays > 0 ? area / labourDays : 0,
      labourPerSqft: safeDivide(labour, area),
      materialPerSqft: safeDivide(material, area),
      costPerSqft: safeDivide(labour + material, area),
      revenuePerSqft: safeDivide(revenue, area),
      profitPerSqft: safeDivide(profit, area),
    } satisfies CostMetricRow;
  });
}

function getCostSortValue(row: CostMetricRow, key: CostSortKey) {
  if (key === 'label') return row.label;
  if (key === 'labourDays') return row.bookedDays || row.labourDays;
  if (key === 'targetDays') return Number(row.targetDays || 0);
  if (key === 'vsTarget') return Number(row.vsTarget || 0);
  if (key === 'targetUsePct') return Number(row.targetUsePct || 0);
  if (key === 'totalCost') return row.labour + row.material;
  if (key === 'shareOfRevenue') return 0;
  return Number(row[key] || 0);
}

function CostTableHeader({
  label,
  active,
  direction,
  onClick,
  align = 'right',
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={`border-b border-slate-200 px-3 py-3 font-semibold ${
        align === 'left' ? 'text-left' : 'text-right'
      }`}
    >
      <SortButton
        label={label}
        active={active}
        direction={direction}
        onClick={onClick}
        align={align}
      />
    </th>
  );
}

function CostStructureKpis({ rows, kpis }: { rows: FlatSummaryRow[]; kpis: ExecutiveSummaryResponse['kpis'] }) {
  const entries = useMemo(() => buildCostEntries(rows), [rows]);
  const areaEntries = useMemo(() => entries.filter((entry) => entry.area > 0), [entries]);

  const totals = useMemo(() => {
    return areaEntries.reduce(
      (acc, entry) => ({
        area: acc.area + entry.area,
        labour: acc.labour + entry.labour,
        material: acc.material + entry.material,
        revenue: acc.revenue + entry.revenue,
        profit: acc.profit + entry.profit,
      }),
      { area: 0, labour: 0, material: 0, revenue: 0, profit: 0 },
    );
  }, [areaEntries]);

  const totalCost = totals.labour + totals.material;
  const nonBillableCost = Number(kpis.nonBillableOperationalWork || 0);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold text-slate-950">Cost structure</h2>
        <p className="text-sm text-slate-500">
          Per-sqft figures use only the {formatNumber(areaEntries.length)} entries that carry an area.
        </p>
      </div>

      <div className="grid grid-cols-1 overflow-hidden rounded-md border border-slate-200 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Revenue / Sqft" value={formatMoneyPerSqft(safeDivide(totals.revenue, totals.area))} sub="client value" />
        <KpiCard label="Labour / Sqft" value={formatMoneyPerSqft(safeDivide(totals.labour, totals.area))} sub={`${formatDecimal(safeDivide(totals.labour, totalCost) * 100, 1)}% of cost`} />
        <KpiCard label="Material / Sqft" value={formatMoneyPerSqft(safeDivide(totals.material, totals.area))} sub={`${formatDecimal(safeDivide(totals.material, totalCost) * 100, 1)}% of cost`} />
        <KpiCard label="Total Cost / Sqft" value={formatMoneyPerSqft(safeDivide(totalCost, totals.area))} sub="labour + material" />
        <KpiCard label="Profit / Sqft" value={formatMoneyPerSqft(safeDivide(totals.profit, totals.area))} sub="on area-bearing work" valueClassName={profitClass(totals.profit)} />
        <KpiCard label="Non-billable Cost" value={formatCurrency(nonBillableCost)} sub={`${formatDecimal(safeDivide(nonBillableCost, kpis.clientValue) * 100, 1)}% of revenue`} />
      </div>
    </section>
  );
}

function CostDistributionByApplicationChart({ rows }: { rows: ApplicationSummaryRow[] }) {
  const chartRows = useMemo(
    () => [...rows].sort((a, b) => naturalCompare(a.application, b.application)),
    [rows],
  );

  return (
    <section className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-bold text-slate-950">Cost distribution by application</h3>
        <p className="font-mono text-xs text-slate-500">share of revenue</p>
      </div>

      {chartRows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">No cost distribution data found.</div>
      ) : (
        <div className="space-y-2">
          {chartRows.map((row) => {
            const cost = Number(row.labour || 0) + Number(row.material || 0);
            const base = Math.max(Number(row.revenue || 0), cost, 1);
            const profit = Math.max(Number(row.netProfit || 0), 0);
            const costAboveRevenue = Math.max(cost - Number(row.revenue || 0), 0);
            const labourWidth = (Math.max(Number(row.labour || 0), 0) / base) * 100;
            const materialWidth = (Math.max(Number(row.material || 0), 0) / base) * 100;
            const profitWidth = (profit / base) * 100;
            const overWidth = (costAboveRevenue / base) * 100;

            return (
              <div key={`cost-chart-${row.application}`} className="grid grid-cols-[220px_1fr_120px] items-center gap-3 text-sm">
                <div className="truncate font-medium text-slate-950" title={row.application}>{row.application}</div>
                <div className="flex h-4 overflow-hidden rounded-sm bg-slate-100">
                  <span className="h-full bg-blue-400" style={{ width: `${labourWidth}%` }} title={`Labour ${formatCurrency(row.labour)}`} />
                  <span className="h-full bg-orange-400" style={{ width: `${materialWidth}%` }} title={`Material ${formatCurrency(row.material)}`} />
                  <span className="h-full bg-emerald-600" style={{ width: `${profitWidth}%` }} title={`Profit ${formatCurrency(profit)}`} />
                  <span className="h-full bg-red-500" style={{ width: `${overWidth}%` }} title={`Cost above revenue ${formatCurrency(costAboveRevenue)}`} />
                </div>
                <div className="text-right font-mono text-slate-950">{formatCurrency(row.revenue)}</div>
                <div className="col-start-2 col-end-4 grid grid-cols-4 gap-2 font-mono text-[11px] text-slate-500">
                  <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-400" />Labour {formatCurrency(row.labour)}</span>
                  <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-orange-400" />Material {formatCurrency(row.material)}</span>
                  <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-600" />Profit {formatCurrency(profit)}</span>
                  <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-500" />Above revenue {formatCurrency(costAboveRevenue)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-blue-400" /> Labour</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-orange-400" /> Material</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-600" /> Profit</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Cost above revenue</span>
      </div>
    </section>
  );
}

function renderCostMetricCells(row: CostMetricRow) {
  return (
    <>
      <td className="px-3 py-2 text-right">{row.area > 0 ? formatNumber(row.area) : '—'}</td>
      <td className="px-3 py-2 text-right">{formatDecimal(row.bookedDays || row.labourDays, 1)}</td>
      <td className="px-3 py-2 text-right">{row.targetDays > 0 ? formatDecimal(row.targetDays, 1) : '—'}</td>
      <td className={`px-3 py-2 text-right ${targetVarianceClass(row.vsTarget)}`}>
        {row.targetDays > 0 ? `${row.vsTarget > 0 ? '+' : ''}${formatDecimal(row.vsTarget, 1)}` : '—'}
      </td>
      <td className="px-3 py-2 text-right"><TargetUseBar value={row.targetUsePct} /></td>
      <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.labour)}</td>
      <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.material)}</td>
      <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.revenue)}</td>
      <td className="px-3 py-2 text-right">{formatMoneyPerSqft(row.labourPerSqft)}</td>
      <td className="px-3 py-2 text-right">{formatMoneyPerSqft(row.materialPerSqft)}</td>
      <td className="px-3 py-2 text-right">{formatMoneyPerSqft(row.costPerSqft)}</td>
      <td className="px-3 py-2 text-right">{formatMoneyPerSqft(row.revenuePerSqft)}</td>
      <td className={`px-3 py-2 text-right ${profitClass(row.profitPerSqft)}`}>{formatMoneyPerSqft(row.profitPerSqft)}</td>
    </>
  );
}

function CostDrillDown({ rows }: { rows: FlatSummaryRow[] }) {
  const entries = useMemo(() => buildCostEntries(rows), [rows]);
  const [openApplications, setOpenApplications] = useState<Set<string>>(new Set());
  const [openFlats, setOpenFlats] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: CostSortKey; direction: SortDirection }>({
    key: 'label',
    direction: 'asc',
  });

  const appRows = useMemo<CostDrillApplicationRow[]>(() => {
    return aggregateCostEntries(
      entries,
      (entry) => entry.application,
      (entry) => entry.application,
    )
      .sort((a, b) => naturalCompare(a.label, b.label))
      .map((app) => {
        const appEntries = entries.filter((entry) => entry.application === app.label);
        const flatChildren = aggregateCostEntries(
          appEntries,
          (entry) => `${entry.application}__${entry.flatId}`,
          (entry) => entry.flatId,
        )
          .sort((a, b) => naturalCompare(a.label, b.label))
          .map((flat) => {
            const flatEntries = appEntries.filter((entry) => entry.flatId === flat.label);
            const layerChildren = aggregateCostEntries(
              flatEntries,
              (entry) => `${entry.application}__${entry.flatId}__${entry.workLayer}`,
              (entry) => entry.workLayer,
            ).sort(compareLayerOrder);

            return { ...flat, layerChildren };
          });

        return { ...app, flatChildren };
      });
  }, [entries]);

  function toggleApplication(key: string) {
    setOpenApplications((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleFlat(key: string) {
    setOpenFlats((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function sortBy(key: CostSortKey, defaultDirection: SortDirection = 'desc') {
    setSort((current) => ({
      key,
      direction: nextSortDirection(current.key, key, current.direction, defaultDirection),
    }));
  }

  const sortedApplications = useMemo(() => {
    return [...appRows].sort((a, b) => {
      const first = getCostSortValue(a, sort.key);
      const second = getCostSortValue(b, sort.key);
      const result =
        typeof first === 'string' || typeof second === 'string'
          ? naturalCompare(String(first), String(second))
          : Number(first) === Number(second)
            ? 0
            : Number(first) > Number(second)
              ? 1
              : -1;
      return sort.direction === 'asc' ? result : -result;
    });
  }, [appRows, sort]);

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold text-slate-950">Cost drill-down</h2>
        <p className="text-sm text-slate-500">Application → flat → layer, with per-sqft economics.</p>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1600px] border-collapse text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <CostTableHeader label="Application → Flat → Layer" align="left" active={sort.key === 'label'} direction={sort.direction} onClick={() => sortBy('label', 'asc')} />
              <CostTableHeader label="Area" active={sort.key === 'area'} direction={sort.direction} onClick={() => sortBy('area')} />
              <CostTableHeader label="Labour Days" active={sort.key === 'labourDays'} direction={sort.direction} onClick={() => sortBy('labourDays')} />
              <CostTableHeader label="Target Labour Days" active={sort.key === 'targetDays'} direction={sort.direction} onClick={() => sortBy('targetDays')} />
              <CostTableHeader label="VS Target" active={sort.key === 'vsTarget'} direction={sort.direction} onClick={() => sortBy('vsTarget')} />
              <CostTableHeader label="Target Use" active={sort.key === 'targetUsePct'} direction={sort.direction} onClick={() => sortBy('targetUsePct')} />
              <CostTableHeader label="Labour" active={sort.key === 'labour'} direction={sort.direction} onClick={() => sortBy('labour')} />
              <CostTableHeader label="Material" active={sort.key === 'material'} direction={sort.direction} onClick={() => sortBy('material')} />
              <CostTableHeader label="Revenue" active={sort.key === 'revenue'} direction={sort.direction} onClick={() => sortBy('revenue')} />
              <CostTableHeader label="Labour ₹/Sqft" active={sort.key === 'labourPerSqft'} direction={sort.direction} onClick={() => sortBy('labourPerSqft')} />
              <CostTableHeader label="Material ₹/Sqft" active={sort.key === 'materialPerSqft'} direction={sort.direction} onClick={() => sortBy('materialPerSqft')} />
              <CostTableHeader label="Cost ₹/Sqft" active={sort.key === 'costPerSqft'} direction={sort.direction} onClick={() => sortBy('costPerSqft')} />
              <CostTableHeader label="Revenue ₹/Sqft" active={sort.key === 'revenuePerSqft'} direction={sort.direction} onClick={() => sortBy('revenuePerSqft')} />
              <CostTableHeader label="Profit ₹/Sqft" active={sort.key === 'profitPerSqft'} direction={sort.direction} onClick={() => sortBy('profitPerSqft')} />
            </tr>
          </thead>
          <tbody className="font-mono text-slate-950">
            {sortedApplications.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-3 py-8 text-center text-sm text-slate-500">No cost drill-down data found.</td>
              </tr>
            ) : (
              sortedApplications.map((app) => {
                const appOpen = openApplications.has(app.key);
                return (
                  <Fragment key={`cost-app-${app.key}`}>
                    <tr onClick={() => toggleApplication(app.key)} className="cursor-pointer border-b border-slate-100 bg-slate-50 hover:bg-slate-100">
                      <td className="px-3 py-2 text-left font-sans font-bold">
                        <span className="mr-2 text-blue-400">{appOpen ? '▼' : '▶'}</span>{app.label}
                      </td>
                      {renderCostMetricCells(app)}
                    </tr>

                    {appOpen && app.flatChildren.map((flat) => {
                      const flatOpen = openFlats.has(flat.key);
                      return (
                        <Fragment key={`cost-flat-${flat.key}`}>
                          <tr onClick={() => toggleFlat(flat.key)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-2 pl-8 text-left font-sans font-bold">
                              <span className="mr-2 text-blue-400">{flatOpen ? '▼' : '▶'}</span>{flat.label}
                            </td>
                            {renderCostMetricCells(flat)}
                          </tr>

                          {flatOpen && flat.layerChildren.map((layer) => (
                            <tr key={`cost-layer-${layer.key}`} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="px-3 py-2 pl-14 text-left font-sans text-slate-700">
                                {layer.label}
                              </td>
                              {renderCostMetricCells(layer)}
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NonBillableOperationalWorkTable({ rows, kpis }: { rows: FlatSummaryRow[]; kpis: ExecutiveSummaryResponse['kpis'] }) {
  const entries = useMemo(() => buildCostEntries(rows).filter((entry) => !isAnalyticsBillableLayer(entry.workLayer)), [rows]);
  const [sort, setSort] = useState<{ key: CostSortKey; direction: SortDirection }>({
    key: 'totalCost',
    direction: 'desc',
  });

  const layerRows = useMemo(() => {
    return aggregateCostEntries(entries, (entry) => entry.workLayer, (entry) => entry.workLayer);
  }, [entries]);

  const sortedRows = useMemo(() => {
    return [...layerRows].sort((a, b) => {
      const first = sort.key === 'shareOfRevenue' ? safeDivide(a.labour + a.material, kpis.clientValue) : getCostSortValue(a, sort.key);
      const second = sort.key === 'shareOfRevenue' ? safeDivide(b.labour + b.material, kpis.clientValue) : getCostSortValue(b, sort.key);
      const result =
        typeof first === 'string' || typeof second === 'string'
          ? naturalCompare(String(first), String(second))
          : Number(first) === Number(second)
            ? 0
            : Number(first) > Number(second)
              ? 1
              : -1;
      return sort.direction === 'asc' ? result : -result;
    });
  }, [layerRows, sort, kpis.clientValue]);

  const totalOperationalCost = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.labour + entry.material, 0),
    [entries],
  );

  function sortBy(key: CostSortKey, defaultDirection: SortDirection = 'desc') {
    setSort((current) => ({
      key,
      direction: nextSortDirection(current.key, key, current.direction, defaultDirection),
    }));
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold text-slate-950">Non-billable operational work</h2>
        <p className="text-sm text-slate-500">
          {formatCurrency(totalOperationalCost)} of cost with no client value · {formatDecimal(safeDivide(totalOperationalCost, kpis.clientValue) * 100, 1)}% of revenue. Preparation work that the billable layers have to carry.
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1120px] border-collapse text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <CostTableHeader label="Work Layer" align="left" active={sort.key === 'label'} direction={sort.direction} onClick={() => sortBy('label', 'asc')} />
              <CostTableHeader label="Entries" active={sort.key === 'entries'} direction={sort.direction} onClick={() => sortBy('entries')} />
              <CostTableHeader label="Flats Touched" active={sort.key === 'flats'} direction={sort.direction} onClick={() => sortBy('flats')} />
              <CostTableHeader label="Area" active={sort.key === 'area'} direction={sort.direction} onClick={() => sortBy('area')} />
              <CostTableHeader label="Labour Days" active={sort.key === 'labourDays'} direction={sort.direction} onClick={() => sortBy('labourDays')} />
              <CostTableHeader label="Target Labour Days" active={sort.key === 'targetDays'} direction={sort.direction} onClick={() => sortBy('targetDays')} />
              <CostTableHeader label="VS Target" active={sort.key === 'vsTarget'} direction={sort.direction} onClick={() => sortBy('vsTarget')} />
              <CostTableHeader label="Target Use" active={sort.key === 'targetUsePct'} direction={sort.direction} onClick={() => sortBy('targetUsePct')} />
              <CostTableHeader label="Labour Cost" active={sort.key === 'labour'} direction={sort.direction} onClick={() => sortBy('labour')} />
              <CostTableHeader label="Material Cost" active={sort.key === 'material'} direction={sort.direction} onClick={() => sortBy('material')} />
              <CostTableHeader label="Total Cost" active={sort.key === 'totalCost'} direction={sort.direction} onClick={() => sortBy('totalCost')} />
              <CostTableHeader label="% of Revenue" active={sort.key === 'shareOfRevenue'} direction={sort.direction} onClick={() => sortBy('shareOfRevenue')} />
            </tr>
          </thead>
          <tbody className="font-mono text-slate-950">
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-sm text-slate-500">No non-billable operational work found.</td>
              </tr>
            ) : (
              sortedRows.map((row) => {
                const totalCost = row.labour + row.material;
                return (
                  <tr key={`nonbill-${row.key}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 text-left font-sans font-medium">
                      {row.label}<ProfitLossStatusTag workLayer={row.label} />
                    </td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.entries)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.flats)}</td>
                    <td className="px-3 py-2 text-right">{row.area > 0 ? formatNumber(row.area) : '—'}</td>
                    <td className="px-3 py-2 text-right">{formatDecimal(row.bookedDays || row.labourDays, 1)}</td>
                    <td className="px-3 py-2 text-right">{row.targetDays > 0 ? formatDecimal(row.targetDays, 1) : '—'}</td>
                    <td className={`px-3 py-2 text-right ${targetVarianceClass(row.vsTarget)}`}>
                      {row.targetDays > 0 ? `${row.vsTarget > 0 ? '+' : ''}${formatDecimal(row.vsTarget, 1)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right"><TargetUseBar value={row.targetUsePct} /></td>
                    <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.labour)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.material)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(totalCost)}</td>
                    <td className="px-3 py-2 text-right">{formatDecimal(safeDivide(totalCost, kpis.clientValue) * 100, 1)}%</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ActivitiesWithoutMeasurableAreaTable({ rows }: { rows: FlatSummaryRow[] }) {
  const entries = useMemo(() => buildCostEntries(rows).filter((entry) => entry.area <= 0), [rows]);
  const [sort, setSort] = useState<{ key: CostSortKey; direction: SortDirection }>({
    key: 'labour',
    direction: 'desc',
  });

  const activityRows = useMemo(() => {
    return aggregateCostEntries(entries, (entry) => entry.workLayer, (entry) => entry.workLayer);
  }, [entries]);

  const sortedRows = useMemo(() => {
    return [...activityRows].sort((a, b) => {
      const first = getCostSortValue(a, sort.key);
      const second = getCostSortValue(b, sort.key);
      const result =
        typeof first === 'string' || typeof second === 'string'
          ? naturalCompare(String(first), String(second))
          : Number(first) === Number(second)
            ? 0
            : Number(first) > Number(second)
              ? 1
              : -1;
      return sort.direction === 'asc' ? result : -result;
    });
  }, [activityRows, sort]);

  function sortBy(key: CostSortKey, defaultDirection: SortDirection = 'desc') {
    setSort((current) => ({
      key,
      direction: nextSortDirection(current.key, key, current.direction, defaultDirection),
    }));
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold text-slate-950">Activities without measurable area</h2>
        <p className="text-sm text-slate-500">
          {formatNumber(entries.length)} entries · held out of every per-sqft figure.
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <CostTableHeader label="Activity" align="left" active={sort.key === 'label'} direction={sort.direction} onClick={() => sortBy('label', 'asc')} />
              <CostTableHeader label="Entries" active={sort.key === 'entries'} direction={sort.direction} onClick={() => sortBy('entries')} />
              <CostTableHeader label="Flats" active={sort.key === 'flats'} direction={sort.direction} onClick={() => sortBy('flats')} />
              <CostTableHeader label="Labour Days" active={sort.key === 'labourDays'} direction={sort.direction} onClick={() => sortBy('labourDays')} />
              <CostTableHeader label="Target Labour Days" active={sort.key === 'targetDays'} direction={sort.direction} onClick={() => sortBy('targetDays')} />
              <CostTableHeader label="VS Target" active={sort.key === 'vsTarget'} direction={sort.direction} onClick={() => sortBy('vsTarget')} />
              <CostTableHeader label="Target Use" active={sort.key === 'targetUsePct'} direction={sort.direction} onClick={() => sortBy('targetUsePct')} />
              <CostTableHeader label="Labour Cost" active={sort.key === 'labour'} direction={sort.direction} onClick={() => sortBy('labour')} />
              <CostTableHeader label="Material Cost" active={sort.key === 'material'} direction={sort.direction} onClick={() => sortBy('material')} />
              <CostTableHeader label="Revenue" active={sort.key === 'revenue'} direction={sort.direction} onClick={() => sortBy('revenue')} />
              <CostTableHeader label="Profit" active={sort.key === 'profit'} direction={sort.direction} onClick={() => sortBy('profit')} />
            </tr>
          </thead>
          <tbody className="font-mono text-slate-950">
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-sm text-slate-500">No zero-area activities found.</td>
              </tr>
            ) : (
              sortedRows.map((row) => (
                <tr key={`noarea-${row.key}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-left font-sans font-medium">{row.label}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(row.entries)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(row.flats)}</td>
                  <td className="px-3 py-2 text-right">{formatDecimal(row.bookedDays || row.labourDays, 1)}</td>
                  <td className="px-3 py-2 text-right">{row.targetDays > 0 ? formatDecimal(row.targetDays, 1) : '—'}</td>
                  <td className={`px-3 py-2 text-right ${targetVarianceClass(row.vsTarget)}`}>
                    {row.targetDays > 0 ? `${row.vsTarget > 0 ? '+' : ''}${formatDecimal(row.vsTarget, 1)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right"><TargetUseBar value={row.targetUsePct} /></td>
                  <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.labour)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.material)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrencyOrDash(row.revenue)}</td>
                  <td className={`px-3 py-2 text-right ${profitClass(row.profit)}`}>{formatCurrency(row.profit)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CostAnalysisTab({
  applicationRows,
  flatRows,
  kpis,
}: {
  applicationRows: ApplicationSummaryRow[];
  flatRows: FlatSummaryRow[];
  kpis: ExecutiveSummaryResponse['kpis'];
}) {
  return (
    <section>
      <CostStructureKpis rows={flatRows} kpis={kpis} />
      <CostDistributionByApplicationChart rows={applicationRows} />
      <CostDrillDown rows={flatRows} />
      <NonBillableOperationalWorkTable rows={flatRows} kpis={kpis} />
      <ActivitiesWithoutMeasurableAreaTable rows={flatRows} />
    </section>
  );
}

type LabourTargetFlatLayerRow = {
  application: string;
  flatId: string;
  workLayer: string;
  layerOrder: number;
  targetDays: number;
  bookedDays: number;
  area: number;
  labour: number;
  material: number;
  revenue: number;
  profit: number;
  productivity: number;
  entries: number;
};

type LabourTargetApplicationRow = {
  application: string;
  layersInPlan: number;
  flats: number;
  targetPerFlat: number;
  fullBudget: number;
  targetBooked: number;
  actualBooked: number;
  vsTarget: number;
  targetUsePct: number;
  labourValueGap: number;
  untargetedDays: number;
  labourRatePerDay: number;
};

type LabourTargetLayerRow = {
  application: string;
  workLayer: string;
  layerOrder: number;
  targetPerFlat: number;
  flatsBooked: number;
  flatsTotal: number;
  targetDays: number;
  actualDays: number;
  actualPerFlat: number;
  vsTarget: number;
  targetUsePct: number;
  labourValueGap: number;
  areaDone: number;
  daysStillAhead: number;
  entries: number;
};

type LabourTargetFlatPositionRow = {
  application: string;
  flatId: string;
  layersBooked: number;
  layersInPlan: number;
  targetDays: number;
  actualDays: number;
  vsTarget: number;
  targetUsePct: number;
  labourValueGap: number;
  untargetedDays: number;
  fullFlatBudget: number;
  daysStillAhead: number;
  area: number;
  productivity: number;
  netProfit: number;
};

type LabourTargetModel = {
  flatLayerRows: LabourTargetFlatLayerRow[];
  applicationRows: LabourTargetApplicationRow[];
  layerRows: LabourTargetLayerRow[];
  flatRows: LabourTargetFlatPositionRow[];
  labourRatePerDay: number;
  totals: {
    applicationsTargeted: number;
    totalApplications: number;
    applicationsStillOpen: number;
    targetBooked: number;
    actualBooked: number;
    vsTarget: number;
    targetUsePct: number;
    labourValueGap: number;
    untargetedDays: number;
    untargetedValue: number;
    untargetedLayers: number;
    fullBudget: number;
    fullBudgetFlats: number;
    overTargetFlats: number;
    insideTargetFlats: number;
    overTargetDays: number;
    insideTargetDays: number;
  };
  untargetedLayerLabels: string[];
  applicationsWithNoTarget: string[];
};

function labourDayValue(value: number) {
  const amount = Number(value) || 0;
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${sign}${formatDecimal(Math.abs(amount), 2)} d`;
}

function LabourVarianceBar({ value, maxValue }: { value: number; maxValue: number }) {
  const safeMax = Math.max(1, Math.abs(maxValue || 0));
  const width = Math.min(50, (Math.abs(Number(value) || 0) / safeMax) * 50);
  const isOver = value > 0;
  const isSaved = value < 0;

  return (
    <div className="relative h-4 min-w-[160px] overflow-hidden rounded-sm bg-slate-100">
      <span className="absolute left-1/2 top-0 h-full w-px bg-slate-300" />
      {value !== 0 && (
        <span
          className={`absolute top-0 h-full rounded-sm ${isOver ? 'bg-red-500' : 'bg-emerald-600'}`}
          style={
            isSaved
              ? { left: '50%', width: `${width}%` }
              : { left: `${50 - width}%`, width: `${width}%` }
          }
        />
      )}
    </div>
  );
}

function buildLabourTargetModel(
  flatRows: FlatSummaryRow[],
  kpis: ExecutiveSummaryResponse['kpis'],
): LabourTargetModel {
  const labourRatePerDay = safeDivide(kpis.labourCost, kpis.labourDays) || 0;
  const flatLayerMap = new Map<string, LabourTargetFlatLayerRow>();

  flatRows.forEach((flat) => {
    const application = flat.application || 'Unassigned';
    const flatId = flat.flatId || '-';

    (flat.details || []).forEach((detail) => {
      const workLayer = detail.workLayer || 'Unspecified';
      const key = `${application}__${flatId}__${workLayer}`;
      const current = flatLayerMap.get(key) || {
        application,
        flatId,
        workLayer,
        layerOrder: layerOrderValue(detail),
        targetDays: 0,
        bookedDays: 0,
        area: 0,
        labour: 0,
        material: 0,
        revenue: 0,
        profit: 0,
        productivity: 0,
        entries: 0,
      };

      const bookedDays = Number(detail.bookedDays || detail.labourDays || 0);

      current.layerOrder = Math.min(layerOrderValue(current), layerOrderValue(detail));
      current.targetDays = Math.max(current.targetDays, Number(detail.targetDays || 0));
      current.bookedDays += bookedDays;
      current.area += Number(detail.area || 0);
      current.labour += Number(detail.labour || 0);
      current.material += Number(detail.material || 0);
      current.revenue += Number(detail.revenue || 0);
      current.profit += Number(detail.profit || 0);
      current.entries += bookedDays > 0 || Number(detail.area || 0) > 0 ? 1 : 0;
      current.productivity = current.bookedDays > 0 ? current.area / current.bookedDays : 0;

      flatLayerMap.set(key, current);
    });
  });

  const flatLayerRows = Array.from(flatLayerMap.values()).sort((a, b) => {
    const appCompare = naturalCompare(a.application, b.application);
    if (appCompare) return appCompare;
    const flatCompare = naturalCompare(a.flatId, b.flatId);
    if (flatCompare) return flatCompare;
    return compareLayerOrder(a, b);
  });

  const flatCountByApplication = new Map<string, Set<string>>();
  flatRows.forEach((flat) => {
    const application = flat.application || 'Unassigned';
    const current = flatCountByApplication.get(application) || new Set<string>();
    current.add(flat.flatId || '-');
    flatCountByApplication.set(application, current);
  });

  const flatPositionMap = new Map<string, LabourTargetFlatPositionRow>();
  flatRows.forEach((flat) => {
    const application = flat.application || 'Unassigned';
    const flatId = flat.flatId || '-';
    const relatedRows = flatLayerRows.filter(
      (row) => row.application === application && row.flatId === flatId,
    );
    const targetRows = relatedRows.filter((row) => row.targetDays > 0);
    const bookedTargetRows = targetRows.filter((row) => row.bookedDays > 0);
    const untargetedRows = relatedRows.filter((row) => row.targetDays <= 0 && row.bookedDays > 0);

    const targetDays = bookedTargetRows.reduce((sum, row) => sum + row.targetDays, 0);
    const actualDays = bookedTargetRows.reduce((sum, row) => sum + row.bookedDays, 0);
    const fullFlatBudget = targetRows.reduce((sum, row) => sum + row.targetDays, 0);
    const vsTarget = actualDays - targetDays;

    flatPositionMap.set(`${application}__${flatId}`, {
      application,
      flatId,
      layersBooked: bookedTargetRows.length,
      layersInPlan: targetRows.length,
      targetDays,
      actualDays,
      vsTarget,
      targetUsePct: targetDays > 0 ? (actualDays * 100) / targetDays : 0,
      labourValueGap: vsTarget * labourRatePerDay,
      untargetedDays: untargetedRows.reduce((sum, row) => sum + row.bookedDays, 0),
      fullFlatBudget,
      daysStillAhead: Math.max(0, fullFlatBudget - targetDays),
      area: Number(flat.area || 0),
      productivity: Number(flat.productivity || 0),
      netProfit: Number(flat.netProfit || 0),
    });
  });

  const flatPositionRows = Array.from(flatPositionMap.values()).sort((a, b) => {
    const targetCompare = Number(b.targetDays > 0) - Number(a.targetDays > 0);
    if (targetCompare) return targetCompare;
    return naturalCompare(`${a.application} ${a.flatId}`, `${b.application} ${b.flatId}`);
  });

  const applicationRows = Array.from(flatCountByApplication.entries())
    .map(([application, flatSet]) => {
      const relatedRows = flatLayerRows.filter((row) => row.application === application);
      const targetRows = relatedRows.filter((row) => row.targetDays > 0);
      const bookedTargetRows = targetRows.filter((row) => row.bookedDays > 0);
      const untargetedRows = relatedRows.filter((row) => row.targetDays <= 0 && row.bookedDays > 0);
      const targetBooked = bookedTargetRows.reduce((sum, row) => sum + row.targetDays, 0);
      const actualBooked = bookedTargetRows.reduce((sum, row) => sum + row.bookedDays, 0);
      const fullBudget = targetRows.reduce((sum, row) => sum + row.targetDays, 0);
      const vsTarget = actualBooked - targetBooked;

      return {
        application,
        layersInPlan: new Set(targetRows.map((row) => row.workLayer)).size,
        flats: flatSet.size,
        targetPerFlat: safeDivide(fullBudget, flatSet.size),
        fullBudget,
        targetBooked,
        actualBooked,
        vsTarget,
        targetUsePct: targetBooked > 0 ? (actualBooked * 100) / targetBooked : 0,
        labourValueGap: vsTarget * labourRatePerDay,
        untargetedDays: untargetedRows.reduce((sum, row) => sum + row.bookedDays, 0),
        labourRatePerDay,
      } satisfies LabourTargetApplicationRow;
    })
    .sort((a, b) => {
      const targetCompare = Number(b.layersInPlan > 0) - Number(a.layersInPlan > 0);
      if (targetCompare) return targetCompare;
      return naturalCompare(a.application, b.application);
    });

  const layerMap = new Map<string, LabourTargetLayerRow>();
  flatLayerRows
    .filter((row) => row.targetDays > 0)
    .forEach((row) => {
      const key = `${row.application}__${row.workLayer}`;
      const flatTotal = flatCountByApplication.get(row.application)?.size || 0;
      const current = layerMap.get(key) || {
        application: row.application,
        workLayer: row.workLayer,
        layerOrder: layerOrderValue(row),
        targetPerFlat: 0,
        flatsBooked: 0,
        flatsTotal: flatTotal,
        targetDays: 0,
        actualDays: 0,
        actualPerFlat: 0,
        vsTarget: 0,
        targetUsePct: 0,
        labourValueGap: 0,
        areaDone: 0,
        daysStillAhead: 0,
        entries: 0,
      };

      current.layerOrder = Math.min(layerOrderValue(current), layerOrderValue(row));
      current.targetPerFlat = Math.max(current.targetPerFlat, row.targetDays);
      current.flatsTotal = Math.max(current.flatsTotal, flatTotal);
      current.areaDone += row.area;
      current.entries += row.entries;

      if (row.bookedDays > 0) {
        current.flatsBooked += 1;
        current.targetDays += row.targetDays;
        current.actualDays += row.bookedDays;
      } else {
        current.daysStillAhead += row.targetDays;
      }

      current.actualPerFlat = current.flatsBooked > 0 ? current.actualDays / current.flatsBooked : 0;
      current.vsTarget = current.actualDays - current.targetDays;
      current.targetUsePct = current.targetDays > 0 ? (current.actualDays * 100) / current.targetDays : 0;
      current.labourValueGap = current.vsTarget * labourRatePerDay;

      layerMap.set(key, current);
    });

  const layerRows = Array.from(layerMap.values()).sort((a, b) => {
    const appCompare = naturalCompare(a.application, b.application);
    if (appCompare) return appCompare;
    return compareLayerOrder(a, b);
  });

  const targetedApplications = applicationRows.filter((row) => row.layersInPlan > 0);
  const noTargetApplications = applicationRows.filter((row) => row.layersInPlan === 0);
  const targetBooked = applicationRows.reduce((sum, row) => sum + row.targetBooked, 0);
  const actualBooked = applicationRows.reduce((sum, row) => sum + row.actualBooked, 0);
  const vsTarget = actualBooked - targetBooked;
  const untargetedRows = flatLayerRows.filter((row) => row.targetDays <= 0 && row.bookedDays > 0);
  const overTargetFlats = flatPositionRows.filter((row) => row.vsTarget > 0.01).length;
  const insideTargetFlats = flatPositionRows.filter((row) => row.targetDays > 0 && row.vsTarget <= 0.01).length;

  return {
    flatLayerRows,
    applicationRows,
    layerRows,
    flatRows: flatPositionRows,
    labourRatePerDay,
    untargetedLayerLabels: Array.from(
      new Set(untargetedRows.map((row) => row.workLayer).filter(Boolean)),
    ).sort(naturalCompare),
    applicationsWithNoTarget: noTargetApplications.map((row) => row.application),
    totals: {
      applicationsTargeted: targetedApplications.length,
      totalApplications: applicationRows.length,
      applicationsStillOpen: targetedApplications.filter((row) => row.fullBudget > row.targetBooked).length,
      targetBooked,
      actualBooked,
      vsTarget,
      targetUsePct: targetBooked > 0 ? (actualBooked * 100) / targetBooked : 0,
      labourValueGap: vsTarget * labourRatePerDay,
      untargetedDays: untargetedRows.reduce((sum, row) => sum + row.bookedDays, 0),
      untargetedValue: untargetedRows.reduce((sum, row) => sum + row.labour, 0),
      untargetedLayers: new Set(untargetedRows.map((row) => row.workLayer)).size,
      fullBudget: applicationRows.reduce((sum, row) => sum + row.fullBudget, 0),
      fullBudgetFlats: flatRows.length,
      overTargetFlats,
      insideTargetFlats,
      overTargetDays: flatPositionRows
        .filter((row) => row.vsTarget > 0)
        .reduce((sum, row) => sum + row.vsTarget, 0),
      insideTargetDays: flatPositionRows
        .filter((row) => row.targetDays > 0 && row.vsTarget <= 0)
        .reduce((sum, row) => sum + row.vsTarget, 0),
    },
  };
}

function LabourTargetMetricCard({
  label,
  value,
  sub,
  valueClassName = '',
}: {
  label: string;
  value: string;
  sub: string;
  valueClassName?: string;
}) {
  return <KpiCard label={label} value={value} sub={sub} valueClassName={valueClassName} />;
}

function LabourTargetStatusCards({ model }: { model: LabourTargetModel }) {
  const untargetedPreview = model.untargetedLayerLabels.slice(0, 4).join(', ');
  const appNoTargetPreview = model.applicationsWithNoTarget.slice(0, 3).join(', ');

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-4">
      <div className="rounded-md border border-l-4 border-l-red-500 border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-500">Flats over their labour target</p>
        <strong className="mt-2 block font-mono text-xl text-red-600">
          {formatNumber(model.totals.overTargetFlats)}
        </strong>
        <span className="font-mono text-xs text-slate-500">
          + {formatDecimal(model.totals.overTargetDays, 2)} days · {formatCurrency(model.totals.overTargetDays * model.labourRatePerDay)}
        </span>
      </div>
      <div className="rounded-md border border-l-4 border-l-emerald-600 border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-500">Flats inside their labour target</p>
        <strong className="mt-2 block font-mono text-xl text-emerald-600">
          {formatNumber(model.totals.insideTargetFlats)}
        </strong>
        <span className="font-mono text-xs text-slate-500">
          {formatDecimal(model.totals.insideTargetDays, 2)} days · {formatCurrency(Math.abs(model.totals.insideTargetDays * model.labourRatePerDay))} saved
        </span>
      </div>
      <div className="rounded-md border border-l-4 border-l-orange-400 border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-500">Layers booked with no target</p>
        <strong className="mt-2 block font-mono text-xl text-orange-600">
          {formatNumber(model.totals.untargetedLayers)}
        </strong>
        <span className="font-mono text-xs text-slate-500">
          {untargetedPreview || 'No untargeted layer'}{model.untargetedLayerLabels.length > 4 ? ' +' : ''}
        </span>
      </div>
      <div className="rounded-md border border-l-4 border-l-orange-400 border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-500">Applications with no target sheet</p>
        <strong className="mt-2 block font-mono text-xl text-orange-600">
          {formatNumber(model.applicationsWithNoTarget.length)}
        </strong>
        <span className="font-mono text-xs text-slate-500">
          {appNoTargetPreview || 'All applications have targets'}{model.applicationsWithNoTarget.length > 3 ? ' +' : ''}
        </span>
      </div>
    </div>
  );
}

function LabourTargetSummary({ model }: { model: LabourTargetModel }) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold text-slate-950">Labour days against target</h2>
        <p className="text-sm text-slate-500">
          A target is labour days for one layer of one flat. Nothing here is estimated — every figure is a labour day set against a target you typed.
        </p>
      </div>
      <div className="grid grid-cols-1 overflow-hidden rounded-md border border-slate-200 md:grid-cols-2 xl:grid-cols-7">
        <LabourTargetMetricCard
          label="Applications targeted"
          value={`${formatNumber(model.totals.applicationsTargeted)} / ${formatNumber(model.totals.totalApplications)}`}
          sub={`${formatNumber(model.totals.applicationsStillOpen)} still open`}
        />
        <LabourTargetMetricCard
          label="Target labour days booked"
          value={formatDecimal(model.totals.targetBooked, 2)}
          sub={`${formatNumber(model.flatLayerRows.filter((row) => row.targetDays > 0 && row.bookedDays > 0).length)} flat-layer pairs`}
        />
        <LabourTargetMetricCard
          label="Actual days booked"
          value={formatDecimal(model.totals.actualBooked, 2)}
          sub="on those same layers"
        />
        <LabourTargetMetricCard
          label="Variance"
          value={labourDayValue(model.totals.vsTarget)}
          sub={model.totals.vsTarget > 0 ? 'above plan' : 'below plan'}
          valueClassName={targetVarianceClass(model.totals.vsTarget)}
        />
        <LabourTargetMetricCard
          label="Target use"
          value={`${formatDecimal(model.totals.targetUsePct, 0)}%`}
          sub="100% is exactly on budget"
          valueClassName={targetUseClass(model.totals.targetUsePct)}
        />
        <LabourTargetMetricCard
          label="Labour value of gap"
          value={formatCurrency(model.totals.labourValueGap)}
          sub={`at ${formatCurrency(model.labourRatePerDay)} per day`}
          valueClassName={profitClass(-model.totals.labourValueGap)}
        />
        <LabourTargetMetricCard
          label="Untargeted labour"
          value={`${formatDecimal(model.totals.untargetedDays, 2)} d`}
          sub={`${formatNumber(model.totals.untargetedLayers)} layers · ${formatCurrency(model.totals.untargetedValue)}`}
        />
        <LabourTargetMetricCard
          label="Full budget, flats touched"
          value={`${formatDecimal(model.totals.fullBudget, 0)} d`}
          sub={`${formatNumber(model.totals.fullBudgetFlats)} flats × their full layer plan`}
        />
      </div>
      <LabourTargetStatusCards model={model} />
    </section>
  );
}

function LabourTargetVarianceCharts({ model }: { model: LabourTargetModel }) {
  const flatChartRows = useMemo(() => {
    const withTargets = model.flatRows.filter((row) => row.targetDays > 0);
    const worst = [...withTargets].sort((a, b) => b.vsTarget - a.vsTarget).slice(0, 8);
    const best = [...withTargets].sort((a, b) => a.vsTarget - b.vsTarget).slice(0, 6);
    const seen = new Set<string>();

    return [...worst, ...best].filter((row) => {
      const key = `${row.application}__${row.flatId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [model.flatRows]);

  const layerChartRows = useMemo(() => {
    return [...model.layerRows]
      .filter((row) => row.flatsBooked > 0)
      .sort((a, b) => {
        const appCompare = naturalCompare(a.application, b.application);
        if (appCompare) return appCompare;
        return compareLayerOrder(a, b);
      })
      .slice(0, 10);
  }, [model.layerRows]);

  const flatMax = Math.max(1, ...flatChartRows.map((row) => Math.abs(row.vsTarget)));
  const layerMax = Math.max(1, ...layerChartRows.map((row) => Math.abs(row.vsTarget)));

  return (
    <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-950">Days over / under target by flat</h3>
          <span className="font-mono text-[11px] text-slate-500">worst 8 · best 6</span>
        </div>
        {flatChartRows.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">No targeted flat bookings found.</div>
        ) : (
          <div className="space-y-2">
            {flatChartRows.map((row) => (
              <div key={`${row.application}-${row.flatId}`} className="grid grid-cols-[minmax(0,1fr)_minmax(180px,0.8fr)_72px] items-center gap-3 text-sm">
                <div className="truncate font-medium text-slate-950" title={`${row.application} · ${row.flatId}`}>
                  {row.application} · {row.flatId}
                </div>
                <LabourVarianceBar value={row.vsTarget} maxValue={flatMax} />
                <div className={`text-right font-mono ${targetVarianceClass(row.vsTarget)}`}>
                  {labourDayValue(row.vsTarget)}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-sm text-slate-500">
          Bars to the left are days spent above plan; bars to the right are days saved against plan.
        </p>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-950">Days over / under target by layer</h3>
          <span className="font-mono text-[11px] text-slate-500">targeted layers with bookings</span>
        </div>
        {layerChartRows.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">No targeted layer bookings found.</div>
        ) : (
          <div className="space-y-2">
            {layerChartRows.map((row) => (
              <div key={`${row.application}-${row.workLayer}`} className="grid grid-cols-[minmax(0,1.05fr)_minmax(180px,0.9fr)_80px] items-center gap-3 text-sm">
                <div className="truncate font-medium text-slate-950" title={`${row.workLayer} · ${row.application}`}>
                  {row.workLayer} · {row.application}
                </div>
                <LabourVarianceBar value={row.vsTarget} maxValue={layerMax} />
                <div className={`text-right font-mono ${targetVarianceClass(row.vsTarget)}`}>
                  {labourDayValue(row.vsTarget)}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-sm text-slate-500">
          This is where the plan is actually breaking — fix the layer, not the flat.
        </p>
      </div>
    </section>
  );
}

function TargetPositionByApplicationTable({ rows }: { rows: LabourTargetApplicationRow[] }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold text-slate-950">Target position by application</h2>
        <p className="text-sm text-slate-500">
          Target booked counts only layers that have started. Full budget is every layer of every flat touched.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1260px] border-collapse text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold">Application</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Layers in plan</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Flats</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Target / flat</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Full budget</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Target booked</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Actual booked</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">VS Target</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Target Use</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Labour value of gap</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Untargeted days</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Labour rate / day</th>
            </tr>
          </thead>
          <tbody className="font-mono text-slate-950">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-sm text-slate-500">No application target rows found.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`target-app-${row.application}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-3 text-left font-sans font-bold">
                    {row.application}
                    {row.layersInPlan === 0 && (
                      <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-orange-700">No targets</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">{row.layersInPlan > 0 ? formatNumber(row.layersInPlan) : '—'}</td>
                  <td className="px-3 py-3 text-right">{formatNumber(row.flats)}</td>
                  <td className="px-3 py-3 text-right">{row.targetPerFlat > 0 ? formatDecimal(row.targetPerFlat, 1) : '—'}</td>
                  <td className="px-3 py-3 text-right">{row.fullBudget > 0 ? formatDecimal(row.fullBudget, 1) : '—'}</td>
                  <td className="px-3 py-3 text-right">{row.targetBooked > 0 ? formatDecimal(row.targetBooked, 1) : '—'}</td>
                  <td className="px-3 py-3 text-right">{row.actualBooked > 0 ? formatDecimal(row.actualBooked, 2) : '—'}</td>
                  <td className={`px-3 py-3 text-right ${targetVarianceClass(row.vsTarget)}`}>{row.targetBooked > 0 ? labourDayValue(row.vsTarget) : '—'}</td>
                  <td className="px-3 py-3 text-right"><TargetUseBar value={row.targetUsePct} /></td>
                  <td className={`px-3 py-3 text-right ${profitClass(-row.labourValueGap)}`}>{row.targetBooked > 0 ? formatCurrency(row.labourValueGap) : '—'}</td>
                  <td className="px-3 py-3 text-right">{row.untargetedDays > 0 ? formatDecimal(row.untargetedDays, 2) : '—'}</td>
                  <td className="px-3 py-3 text-right">{formatCurrency(row.labourRatePerDay)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LayerPlanVsActualTable({ rows }: { rows: LabourTargetLayerRow[] }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold text-slate-950">Layer plan vs actual</h2>
        <p className="text-sm text-slate-500">Every layer in every target sheet. Layers with no booking yet are the work still ahead.</p>
      </div>
      <div className="max-h-[620px] overflow-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1320px] border-collapse text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold">Application</th>
              <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold">Work Layer</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Target / flat</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Flats booked</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Target labour days</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Actual days</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Actual / flat</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">VS Target</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Target Use</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Labour value of gap</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Area done</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Days still ahead</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Entries</th>
            </tr>
          </thead>
          <tbody className="font-mono text-slate-950">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-sm text-slate-500">No target layer plan found.</td>
              </tr>
            ) : (
              rows.map((row) => {
                const isOver = row.vsTarget > 0.01;
                return (
                  <tr key={`layer-target-${row.application}-${row.workLayer}`} className={`border-b border-slate-100 hover:bg-slate-50 ${isOver ? 'bg-red-50' : ''}`}>
                    <td className="px-3 py-2 text-left font-sans text-slate-500">{row.application}</td>
                    <td className="px-3 py-2 text-left font-sans font-bold">
                      {row.workLayer}
                      {row.flatsBooked === 0 && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-slate-500">Not started</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{formatDecimal(row.targetPerFlat, 1)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.flatsBooked)} / {formatNumber(row.flatsTotal)}</td>
                    <td className="px-3 py-2 text-right">{row.targetDays > 0 ? formatDecimal(row.targetDays, 1) : '—'}</td>
                    <td className="px-3 py-2 text-right">{row.actualDays > 0 ? formatDecimal(row.actualDays, 2) : '—'}</td>
                    <td className={`px-3 py-2 text-right ${targetVarianceClass(row.actualPerFlat - row.targetPerFlat)}`}>{row.actualDays > 0 ? formatDecimal(row.actualPerFlat, 2) : '—'}</td>
                    <td className={`px-3 py-2 text-right ${targetVarianceClass(row.vsTarget)}`}>{row.targetDays > 0 ? labourDayValue(row.vsTarget) : '—'}</td>
                    <td className="px-3 py-2 text-right"><TargetUseBar value={row.targetUsePct} /></td>
                    <td className={`px-3 py-2 text-right ${profitClass(-row.labourValueGap)}`}>{row.targetDays > 0 ? formatCurrency(row.labourValueGap) : '—'}</td>
                    <td className="px-3 py-2 text-right">{row.areaDone > 0 ? formatNumber(row.areaDone) : '—'}</td>
                    <td className="px-3 py-2 text-right">{row.daysStillAhead > 0 ? formatDecimal(row.daysStillAhead, 1) : '—'}</td>
                    <td className="px-3 py-2 text-right">{row.entries > 0 ? formatNumber(row.entries) : '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FlatPositionAgainstTargetTable({ rows }: { rows: LabourTargetFlatPositionRow[] }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold text-slate-950">Flat position against target</h2>
        <p className="text-sm text-slate-500">Booked layers only, so a flat mid-way through is judged on the work it has actually done.</p>
      </div>
      <div className="max-h-[560px] overflow-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1320px] border-collapse text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold">Flat</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Layers booked</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Target labour days</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Actual days</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">VS Target</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Target Use</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Labour value of gap</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Untargeted days</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Full flat budget</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Days still ahead</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Area</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Productivity</th>
              <th className="border-b border-slate-200 px-3 py-3 text-right font-semibold">Net profit</th>
            </tr>
          </thead>
          <tbody className="font-mono text-slate-950">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-sm text-slate-500">No flat target position rows found.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`flat-target-${row.application}-${row.flatId}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-left font-sans font-bold">{row.application} · {row.flatId}</td>
                  <td className="px-3 py-2 text-right">{row.layersInPlan > 0 ? `${formatNumber(row.layersBooked)}/${formatNumber(row.layersInPlan)}` : '—'}</td>
                  <td className="px-3 py-2 text-right">{row.targetDays > 0 ? formatDecimal(row.targetDays, 1) : '—'}</td>
                  <td className="px-3 py-2 text-right">{row.actualDays > 0 ? formatDecimal(row.actualDays, 2) : '—'}</td>
                  <td className={`px-3 py-2 text-right ${targetVarianceClass(row.vsTarget)}`}>{row.targetDays > 0 ? labourDayValue(row.vsTarget) : '—'}</td>
                  <td className="px-3 py-2 text-right"><TargetUseBar value={row.targetUsePct} /></td>
                  <td className={`px-3 py-2 text-right ${profitClass(-row.labourValueGap)}`}>{row.targetDays > 0 ? formatCurrency(row.labourValueGap) : '—'}</td>
                  <td className="px-3 py-2 text-right">{row.untargetedDays > 0 ? formatDecimal(row.untargetedDays, 2) : '—'}</td>
                  <td className="px-3 py-2 text-right">{row.fullFlatBudget > 0 ? formatDecimal(row.fullFlatBudget, 1) : '—'}</td>
                  <td className="px-3 py-2 text-right">{row.daysStillAhead > 0 ? formatDecimal(row.daysStillAhead, 1) : '—'}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(row.area)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(row.productivity)}</td>
                  <td className={`px-3 py-2 text-right ${profitClass(row.netProfit)}`}>{formatCurrency(row.netProfit)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LabourTargetsTab({
  flatRows,
  kpis,
}: {
  flatRows: FlatSummaryRow[];
  kpis: ExecutiveSummaryResponse['kpis'];
}) {
  const model = useMemo(() => buildLabourTargetModel(flatRows, kpis), [flatRows, kpis]);

  return (
    <section>
      <LabourTargetSummary model={model} />
      <LabourTargetVarianceCharts model={model} />
      <TargetPositionByApplicationTable rows={model.applicationRows} />
      <LayerPlanVsActualTable rows={model.layerRows} />
      <FlatPositionAgainstTargetTable rows={model.flatRows} />
    </section>
  );
}

type BudgetFlatRollupRow = BudgetCostControlApplicationRow & {
  flatId: string;
  block: string;
  flatProgressPct: number;
  // Backward-compatible alias. Same as flatProgressPct.
  flatProgress: number;
  layers: BudgetCostControlFlatLayerRow[];
};

function budgetStatusClass(status: string) {
  const normalized = String(status || '').trim().toLowerCase();

  if (normalized === 'critical') return 'aph-status-critical';
  if (normalized === 'over budget' || normalized === 'at risk' || normalized === 'warning') return 'aph-status-warning';
  if (normalized === 'under budget') return 'aph-status-info';
  if (normalized === 'no data' || normalized === 'na' || normalized === 'n/a') return 'aph-status-neutral';
  return 'aph-status-healthy';
}

function budgetStatusFromVarPct(varPct: number, expectedCost: number, actualCost: number) {
  const pct = Number(varPct) || 0;

  if (expectedCost <= 0 && actualCost > 0) return 'Critical';
  if (pct > 5) return 'Critical';
  if (pct > 0) return 'Over Budget';
  if (pct >= -5) return 'On Track';
  return 'Under Budget';
}

function BudgetStatusTag({ status }: { status: string }) {
  return (
    <span className={`aph-status-badge ${budgetStatusClass(status)}`}>
      {status || 'On Track'}
    </span>
  );
}

function isBudgetLayerNotStarted(row: BudgetCostControlFlatLayerRow) {
  const progress = Number(row.layerProgressPct ?? row.progress ?? 0);
  const entries = Number(row.entries || 0);
  const actualDays = Number(row.actualDays || 0);
  const actualCost = Number(row.actualCost || 0);
  const actualMaterial = Number(row.actualMaterial || 0);

  return (
    progress <= 0 &&
    entries <= 0 &&
    actualDays <= 0 &&
    actualCost <= 0 &&
    actualMaterial <= 0
  );
}

function BudgetValueCells({
  row,
  progressValue,
}: {
  row: BudgetCostControlApplicationRow | BudgetFlatRollupRow | BudgetCostControlFlatLayerRow;
  progressValue?: number;
}) {
  const resolvedProgress = Number(
    progressValue ??
      ('layerProgressPct' in row ? row.layerProgressPct : undefined) ??
      ('flatProgressPct' in row ? row.flatProgressPct : undefined) ??
      ('progressPct' in row ? row.progressPct : undefined) ??
      row.progress ??
      0,
  );

  return (
    <>
      <td className="px-3 py-2 text-right">{formatNumber(row.budgetArea)}</td>
      <td className="px-3 py-2 text-right">{formatDecimal(resolvedProgress, 1)}%</td>
      <td className="px-3 py-2 text-right">{formatCurrency(row.budgetCost)}</td>
      <td className="px-3 py-2 text-right">{formatCurrency(row.expectedCost)}</td>
      <td className="px-3 py-2 text-right">{formatCurrency(row.actualCost)}</td>
      <td className={`px-3 py-2 text-right ${targetVarianceClass(row.variance)}`}>
        {row.variance > 0 ? '+' : ''}{formatCurrency(row.variance)}
      </td>
      <td className={`px-3 py-2 text-right ${targetVarianceClass(row.varPct)}`}>
        {row.varPct > 0 ? '+' : ''}{formatDecimal(row.varPct, 1)}%
      </td>
      <td className="px-3 py-2 text-right">{formatDecimal(row.budgetDays, 1)}</td>
      <td className="px-3 py-2 text-right">{formatDecimal(row.expectedDays, 1)}</td>
      <td className="px-3 py-2 text-right">{formatDecimal(row.actualDays, 1)}</td>
      <td className="px-3 py-2 text-right">{formatCurrency(row.budgetMaterial)}</td>
      <td className="px-3 py-2 text-right">{formatCurrency(row.expectedMaterial)}</td>
      <td className="px-3 py-2 text-right">{formatCurrency(row.actualMaterial)}</td>
      <td className="px-3 py-2 text-right">{formatNumber(row.entries)}</td>
      <td className="px-3 py-2 text-right"><BudgetStatusTag status={row.status} /></td>
    </>
  );
}

type BudgetSubsection = 'ba' | 'lab' | 'mat' | 'fc' | 'va' | 'tr' | 'dq';
type BudgetForecastBasis = 'performance' | 'budget';
type BudgetTrendGrain = 'day' | 'week' | 'month';

const BUDGET_THRESHOLDS = { ok: 5, watch: 10, over: 20 };

function budgetClampFactor(value: number) {
  return Math.min(4, Math.max(0.25, value));
}

function budgetPerformanceFactor(actual: number, expected: number, basis: BudgetForecastBasis) {
  if (basis !== 'performance' || expected <= 0) return 1;
  return budgetClampFactor(actual / expected);
}

function budgetVarianceStatus(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'No data';
  const pct = Number(value);
  if (pct > BUDGET_THRESHOLDS.over) return 'Critical';
  if (pct > BUDGET_THRESHOLDS.watch) return 'Over Budget';
  if (pct > BUDGET_THRESHOLDS.ok) return 'Watch';
  if (pct < -BUDGET_THRESHOLDS.ok) return 'Under Budget';
  return 'On Track';
}

type BudgetDerivedRow = {
  source: BudgetCostControlFlatLayerRow;
  application: string;
  flatId: string;
  block: string;
  workLayer: string;
  materialName: string;
  layerOrder: number;
  budgetArea: number;
  expectedArea: number;
  actualArea: number;
  remainingArea: number;
  budgetDays: number;
  expectedDays: number;
  actualDays: number;
  remainingDays: number;
  forecastDays: number;
  budgetLabour: number;
  expectedLabour: number;
  actualLabour: number;
  remainingLabour: number;
  forecastLabour: number;
  budgetMaterial: number;
  expectedMaterial: number;
  actualMaterial: number;
  remainingMaterial: number;
  forecastMaterial: number;
  budgetMaterialQty: number;
  expectedMaterialQty: number;
  actualMaterialQty: number;
  remainingMaterialQty: number;
  forecastMaterialQty: number;
  budgetRevenue: number;
  expectedRevenue: number;
  actualRevenue: number;
  remainingRevenue: number;
  forecastRevenue: number;
  budgetCost: number;
  expectedCost: number;
  actualCost: number;
  remainingCost: number;
  forecastCost: number;
  entries: number;
  layerProgressPct: number;
  materialCoverage: number;
  materialRatePerUnit: number;
};

function deriveBudgetLayerRow(
  row: BudgetCostControlFlatLayerRow,
  basis: BudgetForecastBasis,
): BudgetDerivedRow {
  const budgetArea = Number(row.budgetArea || 0);
  const progress = Math.max(0, Number(row.layerProgressPct ?? row.progress ?? 0));
  const expectedArea = budgetArea * Math.min(progress, 100) / 100;
  const actualArea = Number(row.actualArea || 0);
  const budgetDays = Number(row.budgetDays || 0);
  const expectedDays = Number(row.expectedDays || 0);
  const actualDays = Number(row.actualDays || 0);
  const budgetLabour = Number(row.budgetLabour || 0);
  const expectedLabour = Number(row.expectedLabour || 0);
  const actualLabour = Number(row.actualLabour || 0);
  const budgetMaterial = Number(row.budgetMaterial || 0);
  const expectedMaterial = Number(row.expectedMaterial || 0);
  const actualMaterial = Number(row.actualMaterial || 0);
  const budgetMaterialQty = Number(row.budgetMaterialQty || 0);
  const expectedMaterialQty = Number(row.expectedMaterialQty || 0);
  const actualMaterialQty = Number(row.actualMaterialQty || 0);
  const budgetRevenue = Number(row.budgetRevenue || 0);
  const expectedRevenue = Number(row.expectedRevenue || 0);
  const actualRevenue = Number(row.actualRevenue || 0);
  const budgetCost = Number(row.budgetCost || 0);
  const expectedCost = Number(row.expectedCost || 0);
  const actualCost = Number(row.actualCost || 0);

  const remainingDays = Math.max(0, budgetDays - expectedDays);
  const remainingLabour = Math.max(0, budgetLabour - expectedLabour);
  const remainingMaterial = Math.max(0, budgetMaterial - expectedMaterial);
  const remainingMaterialQty = Math.max(0, budgetMaterialQty - expectedMaterialQty);
  const remainingCost = Math.max(0, budgetCost - expectedCost);
  const remainingRevenue = Math.max(0, budgetRevenue - expectedRevenue);

  const dayFactor = budgetPerformanceFactor(actualDays, expectedDays, basis);
  const labourFactor = budgetPerformanceFactor(actualLabour, expectedLabour, basis);
  const materialFactor = budgetPerformanceFactor(actualMaterial, expectedMaterial, basis);
  const materialQtyFactor = budgetPerformanceFactor(actualMaterialQty, expectedMaterialQty, basis);

  return {
    source: row,
    application: row.application,
    flatId: row.flatId,
    block: row.block,
    workLayer: row.workLayer,
    materialName: row.materialNames || 'Unmapped material',
    layerOrder: Number(row.layerOrder || 999),
    budgetArea,
    expectedArea,
    actualArea,
    remainingArea: Math.max(0, budgetArea - expectedArea),
    budgetDays,
    expectedDays,
    actualDays,
    remainingDays,
    forecastDays: actualDays + remainingDays * dayFactor,
    budgetLabour,
    expectedLabour,
    actualLabour,
    remainingLabour,
    forecastLabour: actualLabour + remainingLabour * labourFactor,
    budgetMaterial,
    expectedMaterial,
    actualMaterial,
    remainingMaterial,
    forecastMaterial: actualMaterial + remainingMaterial * materialFactor,
    budgetMaterialQty,
    expectedMaterialQty,
    actualMaterialQty,
    remainingMaterialQty,
    forecastMaterialQty: actualMaterialQty + remainingMaterialQty * materialQtyFactor,
    budgetRevenue,
    expectedRevenue,
    actualRevenue,
    remainingRevenue,
    forecastRevenue: budgetRevenue,
    budgetCost,
    expectedCost,
    actualCost,
    remainingCost,
    forecastCost:
      actualLabour + remainingLabour * labourFactor +
      actualMaterial + remainingMaterial * materialFactor,
    entries: Number(row.entries || 0),
    layerProgressPct: progress,
    materialCoverage: Number(row.materialCoverage || 0),
    materialRatePerUnit: Number(row.materialRatePerUnit || 0),
  };
}

type BudgetAggregateRow = Omit<BudgetDerivedRow, 'source' | 'application' | 'flatId' | 'block' | 'workLayer' | 'materialName' | 'layerOrder'> & {
  key: string;
  label: string;
  sourceRows: BudgetDerivedRow[];
  applications: Set<string>;
  flats: Set<string>;
  layers: Set<string>;
  materialNames: Set<string>;
};

function emptyBudgetAggregate(key: string, label: string): BudgetAggregateRow {
  return {
    key,
    label,
    sourceRows: [],
    applications: new Set(),
    flats: new Set(),
    layers: new Set(),
    materialNames: new Set(),
    budgetArea: 0,
    expectedArea: 0,
    actualArea: 0,
    remainingArea: 0,
    budgetDays: 0,
    expectedDays: 0,
    actualDays: 0,
    remainingDays: 0,
    forecastDays: 0,
    budgetLabour: 0,
    expectedLabour: 0,
    actualLabour: 0,
    remainingLabour: 0,
    forecastLabour: 0,
    budgetMaterial: 0,
    expectedMaterial: 0,
    actualMaterial: 0,
    remainingMaterial: 0,
    forecastMaterial: 0,
    budgetMaterialQty: 0,
    expectedMaterialQty: 0,
    actualMaterialQty: 0,
    remainingMaterialQty: 0,
    forecastMaterialQty: 0,
    budgetRevenue: 0,
    expectedRevenue: 0,
    actualRevenue: 0,
    remainingRevenue: 0,
    forecastRevenue: 0,
    budgetCost: 0,
    expectedCost: 0,
    actualCost: 0,
    remainingCost: 0,
    forecastCost: 0,
    entries: 0,
    layerProgressPct: 0,
    materialCoverage: 0,
    materialRatePerUnit: 0,
  };
}

const BUDGET_SUM_KEYS = [
  'budgetArea', 'expectedArea', 'actualArea', 'remainingArea',
  'budgetDays', 'expectedDays', 'actualDays', 'remainingDays', 'forecastDays',
  'budgetLabour', 'expectedLabour', 'actualLabour', 'remainingLabour', 'forecastLabour',
  'budgetMaterial', 'expectedMaterial', 'actualMaterial', 'remainingMaterial', 'forecastMaterial',
  'budgetMaterialQty', 'expectedMaterialQty', 'actualMaterialQty', 'remainingMaterialQty', 'forecastMaterialQty',
  'budgetRevenue', 'expectedRevenue', 'actualRevenue', 'remainingRevenue', 'forecastRevenue',
  'budgetCost', 'expectedCost', 'actualCost', 'remainingCost', 'forecastCost', 'entries',
] as const satisfies readonly (keyof BudgetDerivedRow)[];

function aggregateBudgetRows(
  rows: BudgetDerivedRow[],
  getKey: (row: BudgetDerivedRow) => string,
  getLabel: (row: BudgetDerivedRow) => string,
) {
  const map = new Map<string, BudgetAggregateRow>();
  rows.forEach((row) => {
    const key = getKey(row) || 'Unspecified';
    const current = map.get(key) || emptyBudgetAggregate(key, getLabel(row) || key);
    current.sourceRows.push(row);
    current.applications.add(row.application);
    current.flats.add(`${row.application}__${row.flatId}`);
    current.layers.add(row.workLayer);
    if (row.materialName) current.materialNames.add(row.materialName);
    BUDGET_SUM_KEYS.forEach((field) => {
      current[field] += Number(row[field] || 0);
    });
    map.set(key, current);
  });

  return [...map.values()].map((row) => {
    row.layerProgressPct = row.budgetArea > 0 ? row.expectedArea * 100 / row.budgetArea : 0;
    row.materialCoverage = row.budgetMaterialQty > 0 ? row.budgetArea / row.budgetMaterialQty : 0;
    row.materialRatePerUnit = row.budgetMaterialQty > 0 ? row.budgetMaterial / row.budgetMaterialQty : 0;
    return row;
  });
}

function budgetDerivedMetrics(row: BudgetAggregateRow | BudgetDerivedRow) {
  const costVariance = row.actualCost - row.expectedCost;
  const costVariancePct = row.expectedCost > 0 ? costVariance * 100 / row.expectedCost : null;
  const labourVariance = row.actualLabour - row.expectedLabour;
  const labourVariancePct = row.expectedLabour > 0 ? labourVariance * 100 / row.expectedLabour : null;
  const dayVariance = row.actualDays - row.expectedDays;
  const dayVariancePct = row.expectedDays > 0 ? dayVariance * 100 / row.expectedDays : null;
  const materialVariance = row.actualMaterial - row.expectedMaterial;
  const materialVariancePct = row.expectedMaterial > 0 ? materialVariance * 100 / row.expectedMaterial : null;
  const qtyVariance = row.actualMaterialQty - row.expectedMaterialQty;
  const qtyVariancePct = row.expectedMaterialQty > 0 ? qtyVariance * 100 / row.expectedMaterialQty : null;
  const forecastVariance = row.forecastCost - row.budgetCost;
  const forecastVariancePct = row.budgetCost > 0 ? forecastVariance * 100 / row.budgetCost : null;
  const progress = row.budgetArea > 0 ? row.expectedArea * 100 / row.budgetArea : row.budgetCost > 0 ? row.expectedCost * 100 / row.budgetCost : 0;
  const budgetUsed = row.budgetCost > 0 ? row.expectedCost * 100 / row.budgetCost : 0;
  const costUsed = row.budgetCost > 0 ? row.actualCost * 100 / row.budgetCost : 0;
  const efficiency = costUsed > 0 ? progress / costUsed : null;
  const budgetProductivity = row.budgetDays > 0 ? row.budgetArea / row.budgetDays : 0;
  const actualProductivity = row.actualDays > 0 ? row.actualArea / row.actualDays : 0;
  const productivityVariancePct = budgetProductivity > 0 ? (actualProductivity - budgetProductivity) * 100 / budgetProductivity : null;
  const budgetMargin = row.budgetRevenue > 0 ? (row.budgetRevenue - row.budgetCost) * 100 / row.budgetRevenue : null;
  const actualMargin = row.actualRevenue > 0 ? (row.actualRevenue - row.actualCost) * 100 / row.actualRevenue : null;
  const forecastMargin = row.forecastRevenue > 0 ? (row.forecastRevenue - row.forecastCost) * 100 / row.forecastRevenue : null;
  const marginErosion = budgetMargin !== null && forecastMargin !== null ? forecastMargin - budgetMargin : null;
  return {
    costVariance, costVariancePct, labourVariance, labourVariancePct, dayVariance, dayVariancePct,
    materialVariance, materialVariancePct, qtyVariance, qtyVariancePct, forecastVariance, forecastVariancePct,
    progress, budgetUsed, costUsed, gap: progress - costUsed, efficiency, budgetProductivity, actualProductivity,
    productivityVariancePct, budgetMargin, actualMargin, forecastMargin, marginErosion,
  };
}

function BudgetVarianceText({ value, money = true }: { value: number; money?: boolean }) {
  if (Math.abs(value) < 0.005) return <span className="text-slate-400">—</span>;
  return <span className={value > 0 ? 'text-red-600' : 'text-emerald-700'}>{value > 0 ? '+' : ''}{money ? formatCurrency(value) : formatDecimal(value, 1)}</span>;
}

function BudgetProgressBar({ label, value, marker, tone = 'bg-blue-400' }: { label: string; value: number; marker?: number; tone?: string }) {
  return (
    <div className="grid grid-cols-[150px_1fr_72px] items-center gap-3 text-sm">
      <span className="truncate text-slate-700">{label}</span>
      <div className="relative h-4 rounded bg-slate-100">
        <span className={`absolute inset-y-0 left-0 rounded ${tone}`} style={{ width: `${Math.min(Math.max(value, 0), 120) / 1.2}%` }} />
        {marker !== undefined && <span className="absolute -top-1 -bottom-1 w-0.5 bg-slate-950/50" style={{ left: `${Math.min(Math.max(marker, 0), 120) / 1.2}%` }} />}
      </div>
      <span className="text-right font-mono font-semibold">{formatDecimal(value, 1)}%</span>
    </div>
  );
}

function budgetBucketKey(value: string, grain: BudgetTrendGrain) {
  if (!value) return '';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  if (grain === 'day') return value;
  if (grain === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const day = d.getDay() || 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - day + 1);
  return monday.toISOString().slice(0, 10);
}

function budgetBucketLabel(value: string, grain: BudgetTrendGrain) {
  if (!value) return '—';
  if (grain === 'month') {
    const [y, m] = value.split('-').map(Number);
    return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }
  return grain === 'week' ? `Week of ${fullDateLabel(value)}` : fullDateLabel(value);
}

type BudgetTrendBucket = {
  key: string;
  entries: number;
  area: number;
  labourDays: number;
  measuredArea: number;
  measuredDays: number;
  materialQty: number;
  actualLabour: number;
  expectedLabour: number;
  actualMaterial: number;
  expectedMaterial: number;
  actualCost: number;
  expectedCost: number;
  productivity: number;
  cumulativeActual: number;
  cumulativeExpected: number;
};

function buildBudgetTrendBuckets(
  rows: NonNullable<ExecutiveSummaryResponse['budgetCostControl']>['trendRows'],
  grain: BudgetTrendGrain,
) {
  const map = new Map<string, BudgetTrendBucket>();
  rows.forEach((row) => {
    const key = budgetBucketKey(row.workDate, grain);
    if (!key) return;
    const current = map.get(key) || {
      key, entries: 0, area: 0, labourDays: 0, measuredArea: 0, measuredDays: 0, materialQty: 0,
      actualLabour: 0, expectedLabour: 0, actualMaterial: 0, expectedMaterial: 0,
      actualCost: 0, expectedCost: 0, productivity: 0, cumulativeActual: 0, cumulativeExpected: 0,
    };
    current.entries += Number(row.entries || 0);
    current.area += Number(row.area || 0);
    current.labourDays += Number(row.labourDays || 0);
    current.measuredArea += Number(row.measuredArea || 0);
    current.measuredDays += Number(row.measuredDays || 0);
    current.materialQty += Number(row.materialQty || 0);
    current.actualLabour += Number(row.actualLabour || 0);
    current.expectedLabour += Number(row.expectedLabour || 0);
    current.actualMaterial += Number(row.actualMaterial || 0);
    current.expectedMaterial += Number(row.expectedMaterial || 0);
    current.actualCost += Number(row.actualCost || 0);
    current.expectedCost += Number(row.expectedCost || 0);
    map.set(key, current);
  });
  const result = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  let actual = 0;
  let expected = 0;
  result.forEach((row) => {
    row.productivity = safeDivide(row.measuredArea, row.measuredDays);
    actual += row.actualCost;
    expected += row.expectedCost;
    row.cumulativeActual = actual;
    row.cumulativeExpected = expected;
  });
  return result;
}

function BudgetTrendChart({
  rows,
  series,
  valueFormatter = (value) => formatCurrency(value),
}: {
  rows: BudgetTrendBucket[];
  series: { label: string; value: (row: BudgetTrendBucket) => number; dashed?: boolean }[];
  valueFormatter?: (value: number) => string;
}) {
  if (!rows.length) return <div className="py-10 text-center text-sm text-slate-500">No dated work entries in the current filter.</div>;
  const width = 720;
  const height = 150;
  const pad = { l: 12, r: 12, t: 12, b: 22 };
  const values = series.flatMap((item) => rows.map(item.value));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (index: number) => pad.l + (rows.length <= 1 ? 0 : index / (rows.length - 1) * (width - pad.l - pad.r));
  const y = (value: number) => pad.t + (max - value) / span * (height - pad.t - pad.b);
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-[150px] w-full" role="img">
        <line x1={pad.l} y1={height - pad.b} x2={width - pad.r} y2={height - pad.b} stroke="currentColor" opacity="0.15" />
        {series.map((item, seriesIndex) => {
          const points = rows.map((row, index) => `${x(index)},${y(item.value(row))}`).join(' ');
          return (
            <polyline
              key={item.label}
              points={points}
              fill="none"
              stroke="currentColor"
              opacity={seriesIndex === 0 ? 0.9 : 0.45}
              strokeWidth={seriesIndex === 0 ? 2.2 : 1.8}
              strokeDasharray={item.dashed ? '6 5' : undefined}
            />
          );
        })}
        {rows.map((row, index) => index % Math.max(1, Math.ceil(rows.length / 6)) === 0 ? (
          <text key={row.key} x={x(index)} y={height - 4} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.55">
            {budgetBucketLabel(row.key, 'day').replace(/\s\d{4}$/, '')}
          </text>
        ) : null)}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 font-mono text-[11px] text-slate-500">
        {series.map((item) => <span key={item.label}>{item.label}: {valueFormatter(item.value(rows[rows.length - 1]))}</span>)}
      </div>
    </div>
  );
}

function BudgetHorizontalBars({ rows, value, formatter }: { rows: { label: string; amount: number }[]; value?: (row: { label: string; amount: number }) => number; formatter?: (value: number) => string }) {
  const finalRows = rows.filter((row) => Number.isFinite(row.amount)).slice(0, 12);
  const max = Math.max(1, ...finalRows.map((row) => Math.abs(value ? value(row) : row.amount)));
  return (
    <div className="space-y-2">
      {finalRows.length === 0 ? <div className="py-6 text-center text-sm text-slate-500">No rows found.</div> : finalRows.map((row) => {
        const n = value ? value(row) : row.amount;
        return (
          <div key={row.label} className="grid grid-cols-[minmax(130px,1fr)_1.5fr_110px] items-center gap-3 text-sm">
            <span className="truncate" title={row.label}>{row.label}</span>
            <div className="relative h-3 overflow-hidden rounded bg-slate-100"><span className={`absolute inset-y-0 ${n < 0 ? 'right-1/2 bg-emerald-500' : 'left-1/2 bg-red-500'}`} style={{ width: `${Math.abs(n) / max * 50}%` }} /></div>
            <span className={`text-right font-mono ${n > 0 ? 'text-red-600' : n < 0 ? 'text-emerald-700' : ''}`}>{formatter ? formatter(n) : formatCurrency(n)}</span>
          </div>
        );
      })}
    </div>
  );
}

function BudgetCostControlTab({
  data,
}: {
  data: NonNullable<ExecutiveSummaryResponse['budgetCostControl']>;
}) {
  const [openFlats, setOpenFlats] = useState<Set<string>>(new Set());
  const [openLayers, setOpenLayers] = useState<Set<string>>(new Set());
  const [subsection, setSubsection] = useState<BudgetSubsection>('ba');
  const [forecastBasis, setForecastBasis] = useState<BudgetForecastBasis>('performance');
  const [trendGrain, setTrendGrain] = useState<BudgetTrendGrain>('day');

  const applicationRows = data?.applicationSummary || [];
  const layerRows = data?.flatDrilldownRows || [];
  const trendSourceRows = data?.trendRows || [];

  const derivedRows = useMemo(() => layerRows.map((row) => deriveBudgetLayerRow(row, forecastBasis)), [layerRows, forecastBasis]);
  const projectTotals = useMemo(() => aggregateBudgetRows(derivedRows, () => 'project', () => 'Project')[0] || emptyBudgetAggregate('project', 'Project'), [derivedRows]);
  const applicationGroups = useMemo(() => aggregateBudgetRows(derivedRows, (row) => row.application, (row) => row.application).sort((a, b) => naturalCompare(a.label, b.label)), [derivedRows]);
  const flatGroupsDerived = useMemo(() => aggregateBudgetRows(derivedRows, (row) => `${row.application}__${row.flatId}`, (row) => `${row.application} · ${row.flatId}`).sort((a, b) => naturalCompare(a.label, b.label)), [derivedRows]);
  const layerGroups = useMemo(() => aggregateBudgetRows(derivedRows, (row) => row.workLayer, (row) => row.workLayer).sort((a, b) => {
    const ao = Math.min(...a.sourceRows.map((row) => row.layerOrder));
    const bo = Math.min(...b.sourceRows.map((row) => row.layerOrder));
    return ao - bo || naturalCompare(a.label, b.label);
  }), [derivedRows]);
  const materialGroups = useMemo(() => aggregateBudgetRows(derivedRows.filter((row) => row.budgetMaterial > 0 || row.actualMaterial > 0 || row.actualMaterialQty > 0), (row) => row.materialName || 'Unmapped material', (row) => row.materialName || 'Unmapped material').sort((a, b) => b.actualMaterial - a.actualMaterial), [derivedRows]);
  const trendRows = useMemo(() => buildBudgetTrendBuckets(trendSourceRows, trendGrain), [trendSourceRows, trendGrain]);
  const totals = budgetDerivedMetrics(projectTotals);

  const physicalBudgetArea = useMemo(() => applicationRows.reduce((sum, row) => sum + Number(row.budgetArea || 0), 0), [applicationRows]);
  const physicalProgress = useMemo(() => physicalBudgetArea > 0 ? applicationRows.reduce((sum, row) => sum + Number(row.budgetArea || 0) * Number(row.progressPct ?? row.progress ?? 0) / 100, 0) * 100 / physicalBudgetArea : 0, [applicationRows, physicalBudgetArea]);
  const physicalCompletedArea = physicalBudgetArea * physicalProgress / 100;
  const physicalRemainingArea = Math.max(0, physicalBudgetArea - physicalCompletedArea);

  const flatGroups = useMemo(() => {
    const map = new Map<string, BudgetFlatRollupRow>();
    layerRows.forEach((row) => {
      const key = `${row.application}__${row.flatId}`;
      const current = map.get(key) || {
        application: row.application, flatId: row.flatId, block: row.block, flats: 1,
        budgetArea: row.budgetArea, progress: row.flatProgressPct ?? row.flatProgress,
        progressPct: row.flatProgressPct ?? row.flatProgress, expectedProgressPct: 0,
        flatProgressPct: row.flatProgressPct ?? row.flatProgress, flatProgress: row.flatProgressPct ?? row.flatProgress,
        budgetCost: 0, expectedCost: 0, actualCost: 0, variance: 0, varPct: 0,
        budgetDays: 0, expectedDays: 0, actualDays: 0, budgetMaterial: 0, expectedMaterial: 0,
        actualMaterial: 0, entries: 0, status: 'On Track', layers: [],
      };
      current.budgetArea = Math.max(current.budgetArea, row.budgetArea);
      current.progress = row.flatProgressPct ?? row.flatProgress;
      current.progressPct = row.flatProgressPct ?? row.flatProgress;
      current.flatProgressPct = row.flatProgressPct ?? row.flatProgress;
      current.flatProgress = row.flatProgressPct ?? row.flatProgress;
      current.budgetCost += Number(row.budgetCost || 0);
      current.expectedCost += Number(row.expectedCost || 0);
      current.actualCost += Number(row.actualCost || 0);
      current.budgetDays += Number(row.budgetDays || 0);
      current.expectedDays += Number(row.expectedDays || 0);
      current.actualDays += Number(row.actualDays || 0);
      current.budgetMaterial += Number(row.budgetMaterial || 0);
      current.expectedMaterial += Number(row.expectedMaterial || 0);
      current.actualMaterial += Number(row.actualMaterial || 0);
      current.entries += Number(row.entries || 0);
      current.layers.push(row);
      map.set(key, current);
    });
    return Array.from(map.values()).map((row) => {
      const variance = row.actualCost - row.expectedCost;
      const varPct = row.expectedCost > 0 ? variance * 100 / row.expectedCost : row.actualCost > 0 ? 100 : 0;
      return { ...row, expectedProgressPct: row.budgetCost > 0 ? row.expectedCost * 100 / row.budgetCost : 0, variance, varPct, status: budgetVarianceStatus(varPct), layers: [...row.layers].sort(compareLayerOrder) };
    }).sort((a, b) => naturalCompare(a.application, b.application) || naturalCompare(a.flatId, b.flatId));
  }, [layerRows]);

  const allFlatKeys = useMemo(() => flatGroups.map((row) => `${row.application}__${row.flatId}`), [flatGroups]);
  const toggleFlat = (key: string) => setOpenFlats((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const toggleLayer = (key: string) => setOpenLayers((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const openAll = () => setOpenFlats(new Set(allFlatKeys));
  const closeAll = () => { setOpenFlats(new Set()); setOpenLayers(new Set()); };

  const flatRiskRows = useMemo(() => flatGroupsDerived.map((row) => ({ row, d: budgetDerivedMetrics(row) })), [flatGroupsDerived]);
  const risks = [...flatRiskRows].filter((item) => item.d.costVariance > 0).sort((a, b) => b.d.costVariance - a.d.costVariance).slice(0, 5);
  const savings = [...flatRiskRows].filter((item) => item.d.costVariance < 0).sort((a, b) => a.d.costVariance - b.d.costVariance).slice(0, 5);
  const layerVarianceRows = useMemo(() => layerGroups.map((row) => ({ row, d: budgetDerivedMetrics(row) })), [layerGroups]);
  const materialVarianceRows = useMemo(() => materialGroups.map((row) => ({ row, d: budgetDerivedMetrics(row) })), [materialGroups]);

  const alerts = useMemo(() => {
    const out: { level: 'good' | 'warn' | 'crit'; tag: string; text: string; amount: string }[] = [];
    if (totals.gap < -BUDGET_THRESHOLDS.ok && projectTotals.budgetCost > 0) out.push({ level: 'crit', tag: 'Cost vs progress', text: `Cost is running ahead of progress — ${formatDecimal(totals.costUsed, 1)}% of budget consumed against ${formatDecimal(totals.progress, 1)}% physical completion.`, amount: `${formatDecimal(Math.abs(totals.gap), 1)} pp` });
    else if (totals.gap > BUDGET_THRESHOLDS.ok && projectTotals.actualCost > 0) out.push({ level: 'good', tag: 'Cost vs progress', text: `Progress is ahead of cost — ${formatDecimal(totals.progress, 1)}% complete on ${formatDecimal(totals.costUsed, 1)}% of budget.`, amount: `+${formatDecimal(totals.gap, 1)} pp` });
    if (totals.forecastVariancePct !== null && totals.forecastVariancePct > BUDGET_THRESHOLDS.ok) out.push({ level: 'crit', tag: 'Forecast', text: 'At the current burn rate the project finishes over budget.', amount: formatCurrency(totals.forecastVariance) });
    if (totals.marginErosion !== null && totals.marginErosion < -1) out.push({ level: 'warn', tag: 'Margin', text: `Forecast margin ${formatDecimal(totals.forecastMargin || 0, 1)}% against a budgeted ${formatDecimal(totals.budgetMargin || 0, 1)}%.`, amount: `${formatDecimal(totals.marginErosion, 1)} pp` });
    flatRiskRows.slice().sort((a, b) => b.d.costVariance - a.d.costVariance).slice(0, 3).forEach((item) => { if ((item.d.costVariancePct || 0) > BUDGET_THRESHOLDS.watch) out.push({ level: (item.d.costVariancePct || 0) > BUDGET_THRESHOLDS.over ? 'crit' : 'warn', tag: 'Flat', text: `${item.row.label} has consumed more than the budget earned for the work done there.`, amount: formatCurrency(item.d.costVariance) }); });
    return out.slice(0, 8);
  }, [totals, projectTotals, flatRiskRows]);

  const kpi = (label: string, value: ReactNode, sub: ReactNode, cls = '') => <KpiCard label={label} value={String(value)} sub={String(sub)} valueClassName={cls} />;

  const budgetSummaryRows = [
    ['Total cost', projectTotals.budgetCost, projectTotals.expectedCost, projectTotals.actualCost, projectTotals.forecastCost, 'money'],
    ['Labour cost', projectTotals.budgetLabour, projectTotals.expectedLabour, projectTotals.actualLabour, projectTotals.forecastLabour, 'money'],
    ['Material cost', projectTotals.budgetMaterial, projectTotals.expectedMaterial, projectTotals.actualMaterial, projectTotals.forecastMaterial, 'money'],
    ['Labour days', projectTotals.budgetDays, projectTotals.expectedDays, projectTotals.actualDays, projectTotals.forecastDays, 'number'],
    ['Material quantity', projectTotals.budgetMaterialQty, projectTotals.expectedMaterialQty, projectTotals.actualMaterialQty, projectTotals.forecastMaterialQty, 'number'],
    ['Area (sqft)', projectTotals.budgetArea, projectTotals.expectedArea, projectTotals.actualArea, projectTotals.budgetArea, 'number'],
    ['Revenue', projectTotals.budgetRevenue, projectTotals.expectedRevenue, projectTotals.actualRevenue, projectTotals.forecastRevenue, 'money'],
    ['Margin', projectTotals.budgetRevenue - projectTotals.budgetCost, projectTotals.expectedRevenue - projectTotals.expectedCost, projectTotals.actualRevenue - projectTotals.actualCost, projectTotals.forecastRevenue - projectTotals.forecastCost, 'money'],
  ] as const;

  function renderBudgetVsActual() {
    return (
      <div className="space-y-7">
        <section>
          <div className="mb-3 flex flex-wrap items-baseline gap-3"><h2 className="text-lg font-bold text-slate-950">Budget summary</h2><p className="text-sm text-slate-500">Expected to date is the budget earned by the work physically executed, not the calendar.</p></div>
          <div className="overflow-auto rounded-md border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1100px] border-collapse text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500"><tr><th className="px-3 py-3 text-left">Metric</th><th className="px-3 py-3 text-right">Budget</th><th className="px-3 py-3 text-right">Expected to date</th><th className="px-3 py-3 text-right">Actual</th><th className="px-3 py-3 text-right">Variance</th><th className="px-3 py-3 text-right">Variance %</th><th className="px-3 py-3 text-right">Forecast</th><th className="px-3 py-3 text-right">Forecast variance</th><th className="px-3 py-3 text-right">Status</th></tr></thead>
              <tbody className="font-mono">{budgetSummaryRows.map(([label, budget, expected, actual, forecast, fmt]) => { const variance = actual - expected; const variancePct = expected > 0 ? variance * 100 / expected : null; const forecastVariance = forecast - budget; const render = (v: number) => fmt === 'money' ? formatCurrency(v) : formatDecimal(v, 1); return <tr key={label} className="border-t border-slate-100"><td className="px-3 py-2 text-left font-sans font-semibold">{label}</td><td className="px-3 py-2 text-right">{render(budget)}</td><td className="px-3 py-2 text-right">{render(expected)}</td><td className="px-3 py-2 text-right">{render(actual)}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={variance} money={fmt === 'money'} /></td><td className={`px-3 py-2 text-right ${variancePct !== null && variancePct > 0 ? 'text-red-600' : variancePct !== null && variancePct < 0 ? 'text-emerald-700' : ''}`}>{variancePct === null ? '—' : `${variancePct > 0 ? '+' : ''}${formatDecimal(variancePct, 1)}%`}</td><td className="px-3 py-2 text-right">{render(forecast)}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={forecastVariance} money={fmt === 'money'} /></td><td className="px-3 py-2 text-right"><BudgetStatusTag status={budgetVarianceStatus(variancePct)} /></td></tr>; })}</tbody>
            </table>
          </div>
        </section>

        <section><div className="mb-3 flex flex-wrap items-baseline gap-3"><h2 className="text-lg font-bold text-slate-950">Consumption against progress</h2><p className="text-sm text-slate-500">If the cost bar runs past the progress bar, the job is buying less work than it is paying for.</p></div><div className="grid gap-4 lg:grid-cols-2"><div className="space-y-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm"><BudgetProgressBar label="Physical progress" value={totals.progress} tone="bg-emerald-500" /><BudgetProgressBar label="Budget consumed" value={totals.budgetUsed} marker={totals.progress} /><BudgetProgressBar label="Actual cost consumed" value={totals.costUsed} marker={totals.progress} tone={totals.costUsed > totals.progress + 5 ? 'bg-red-500' : 'bg-orange-400'} /><p className="border-t border-slate-100 pt-3 text-sm text-slate-500">Cost efficiency index <b className={`font-mono ${totals.efficiency !== null && totals.efficiency < 0.98 ? 'text-red-600' : totals.efficiency !== null && totals.efficiency > 1.02 ? 'text-emerald-700' : 'text-slate-950'}`}>{totals.efficiency === null ? '—' : formatDecimal(totals.efficiency, 2)}</b> · gap {totals.gap >= 0 ? '+' : ''}{formatDecimal(totals.gap, 1)} pp.</p></div><div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"><h3 className="mb-3 font-bold">Budget waterfall</h3><div className="space-y-3 font-mono text-sm"><div className="flex justify-between"><span>Budget</span><b>{formatCurrency(projectTotals.budgetCost)}</b></div><div className="flex justify-between"><span>Labour forecast variance</span><b className={projectTotals.forecastLabour - projectTotals.budgetLabour > 0 ? 'text-red-600' : 'text-emerald-700'}>{formatCurrency(projectTotals.forecastLabour - projectTotals.budgetLabour)}</b></div><div className="flex justify-between"><span>Material forecast variance</span><b className={projectTotals.forecastMaterial - projectTotals.budgetMaterial > 0 ? 'text-red-600' : 'text-emerald-700'}>{formatCurrency(projectTotals.forecastMaterial - projectTotals.budgetMaterial)}</b></div><div className="flex justify-between border-t border-slate-200 pt-3"><span>Forecast</span><b>{formatCurrency(projectTotals.forecastCost)}</b></div></div></div></div></section>

        <section><div className="mb-3"><h2 className="text-lg font-bold">Cost per sqft</h2></div><div className="overflow-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-3 text-left">Basis</th><th className="px-3 py-3 text-right">Labour ₹/sqft</th><th className="px-3 py-3 text-right">Material ₹/sqft</th><th className="px-3 py-3 text-right">Total ₹/sqft</th><th className="px-3 py-3 text-right">Area used</th></tr></thead><tbody className="font-mono"><tr className="border-t"><td className="px-3 py-2 font-sans font-semibold">Budget</td><td className="px-3 py-2 text-right">{formatMoneyPerSqft(safeDivide(projectTotals.budgetLabour, projectTotals.budgetArea))}</td><td className="px-3 py-2 text-right">{formatMoneyPerSqft(safeDivide(projectTotals.budgetMaterial, projectTotals.budgetArea))}</td><td className="px-3 py-2 text-right">{formatMoneyPerSqft(safeDivide(projectTotals.budgetCost, projectTotals.budgetArea))}</td><td className="px-3 py-2 text-right">{formatNumber(projectTotals.budgetArea)} budgeted</td></tr><tr className="border-t"><td className="px-3 py-2 font-sans font-semibold">Actual</td><td className="px-3 py-2 text-right">{formatMoneyPerSqft(safeDivide(projectTotals.actualLabour, projectTotals.actualArea))}</td><td className="px-3 py-2 text-right">{formatMoneyPerSqft(safeDivide(projectTotals.actualMaterial, projectTotals.actualArea))}</td><td className="px-3 py-2 text-right">{formatMoneyPerSqft(safeDivide(projectTotals.actualCost, projectTotals.actualArea))}</td><td className="px-3 py-2 text-right">{formatNumber(projectTotals.actualArea)} executed</td></tr><tr className="border-t"><td className="px-3 py-2 font-sans font-semibold">Forecast</td><td className="px-3 py-2 text-right">{formatMoneyPerSqft(safeDivide(projectTotals.forecastLabour, projectTotals.budgetArea))}</td><td className="px-3 py-2 text-right">{formatMoneyPerSqft(safeDivide(projectTotals.forecastMaterial, projectTotals.budgetArea))}</td><td className="px-3 py-2 text-right">{formatMoneyPerSqft(safeDivide(projectTotals.forecastCost, projectTotals.budgetArea))}</td><td className="px-3 py-2 text-right">{formatNumber(projectTotals.budgetArea)} at completion</td></tr></tbody></table></div></section>

        <section><div className="mb-3"><h2 className="text-lg font-bold">Application summary</h2></div><div className="overflow-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[1550px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Application','Budget area','Progress','Budget cost','Expected','Actual','Variance','Var %','Forecast','Forecast var','Budget days','Expected days','Actual days','Budget material','Expected material','Actual material','Status'].map((h, i) => <th key={h} className={`px-3 py-3 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead><tbody className="font-mono">{applicationGroups.map((row) => { const d = budgetDerivedMetrics(row); return <tr key={row.key} className="border-t"><td className="px-3 py-2 text-left font-sans font-semibold">{row.label}</td><td className="px-3 py-2 text-right">{formatNumber(row.budgetArea)}</td><td className="px-3 py-2 text-right">{formatDecimal(d.progress, 1)}%</td><td className="px-3 py-2 text-right">{formatCurrency(row.budgetCost)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.expectedCost)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.actualCost)}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={d.costVariance} /></td><td className="px-3 py-2 text-right">{d.costVariancePct === null ? '—' : `${d.costVariancePct > 0 ? '+' : ''}${formatDecimal(d.costVariancePct,1)}%`}</td><td className="px-3 py-2 text-right">{formatCurrency(row.forecastCost)}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={d.forecastVariance} /></td><td className="px-3 py-2 text-right">{formatDecimal(row.budgetDays,1)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.expectedDays,1)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.actualDays,1)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.budgetMaterial)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.expectedMaterial)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.actualMaterial)}</td><td className="px-3 py-2 text-right"><BudgetStatusTag status={budgetVarianceStatus(d.costVariancePct)} /></td></tr>; })}</tbody></table></div></section>

        <section><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-950">Flat drilldown</h2><p className="text-sm text-slate-500">Click a flat for its layers. Click a layer to show its material. Layer sequence comes from indr.layer.</p></div><div className="flex gap-2"><button type="button" onClick={openAll} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm">Expand all</button><button type="button" onClick={closeAll} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm">Collapse all</button></div></div><div className="aph-budget-table-shell overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"><table className="aph-budget-table aph-budget-flat-table w-full border-collapse text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.14em] text-slate-500"><tr>{['Flat / Layer','Budget Area','Progress','Budget Cost','Expected','Actual','Variance','Var %','Budget Days','Expected Days','Actual Days','Budget Material','Expected Material','Actual Material','Entries','Status'].map((h, i) => <th key={h} className={`border-b border-slate-200 px-3 py-3 font-semibold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead><tbody className="font-mono text-slate-950">{flatGroups.length === 0 ? <tr><td colSpan={16} className="px-3 py-8 text-center text-sm text-slate-500">No flat budget rows found.</td></tr> : flatGroups.map((flat) => { const key = `${flat.application}__${flat.flatId}`; const isOpen = openFlats.has(key); return <Fragment key={key}><tr onClick={() => toggleFlat(key)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"><td className="px-3 py-2 text-left font-sans font-bold"><span className="mr-2 text-blue-400">{isOpen ? '▼' : '▶'}</span>{flat.flatId || '-'} <span className="text-slate-400">{flat.application}</span></td><BudgetValueCells row={flat} progressValue={flat.flatProgressPct ?? flat.flatProgress} /></tr>{isOpen && flat.layers.map((layer, index) => { const layerKey = `${key}__${layer.workLayer}__${index}`; const layerOpen = openLayers.has(layerKey); return <tr key={layerKey} onClick={() => toggleLayer(layerKey)} className="cursor-pointer border-b border-slate-100 bg-slate-50/50"><td className="px-3 py-2 pl-8 text-left font-sans"><span className="mr-2 text-blue-400">{layerOpen ? '▼' : '▶'}</span>{layer.workLayer}{isBudgetLayerNotStarted(layer) && <span className="aph-status-badge aph-status-neutral ml-2">Not Started</span>}{layerOpen && <div className="mt-1 text-xs text-slate-500">Material · {layer.materialNames || 'No material mapped'}</div>}</td><BudgetValueCells row={layer} progressValue={layer.layerProgressPct ?? layer.progress} /></tr>; })}</Fragment>; })}</tbody></table></div></section>
      </div>
    );
  }

  function renderLabourBudget() {
    const labourRows = layerGroups.filter((row) => row.budgetDays > 0 || row.actualDays > 0);
    return <div className="space-y-7"><section><div className="mb-3"><h2 className="text-lg font-bold">Labour budget vs actual</h2><p className="text-sm text-slate-500">Target labour days and labour cost come directly from the existing ZOS budget source.</p></div><div className="max-h-[620px] overflow-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[1650px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Layer','Budget area','Executed area','Budget days','Expected days','Actual days','Remaining days','Forecast days','Day variance','Variance %','Budget labour ₹','Actual labour ₹','Cost variance','Budget productivity','Actual productivity','Productivity var %','Status'].map((h,i)=><th key={h} className={`px-3 py-3 ${i?'text-right':'text-left'}`}>{h}</th>)}</tr></thead><tbody className="font-mono">{labourRows.map((row) => { const d=budgetDerivedMetrics(row); return <tr key={row.key} className="border-t"><td className="px-3 py-2 text-left font-sans font-semibold">{row.label}</td><td className="px-3 py-2 text-right">{formatNumber(row.budgetArea)}</td><td className="px-3 py-2 text-right">{formatNumber(row.actualArea)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.budgetDays,1)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.expectedDays,1)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.actualDays,1)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.remainingDays,1)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.forecastDays,1)}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={d.dayVariance} money={false}/></td><td className="px-3 py-2 text-right">{d.dayVariancePct===null?'—':`${d.dayVariancePct>0?'+':''}${formatDecimal(d.dayVariancePct,1)}%`}</td><td className="px-3 py-2 text-right">{formatCurrency(row.budgetLabour)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.actualLabour)}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={d.labourVariance}/></td><td className="px-3 py-2 text-right">{formatNumber(d.budgetProductivity)}</td><td className="px-3 py-2 text-right">{formatNumber(d.actualProductivity)}</td><td className={`px-3 py-2 text-right ${d.productivityVariancePct!==null&&d.productivityVariancePct<0?'text-red-600':'text-emerald-700'}`}>{d.productivityVariancePct===null?'—':`${d.productivityVariancePct>0?'+':''}${formatDecimal(d.productivityVariancePct,1)}%`}</td><td className="px-3 py-2 text-right"><BudgetStatusTag status={budgetVarianceStatus(d.dayVariancePct)} /></td></tr>;})}</tbody></table></div></section>
      <section><div className="mb-3"><h2 className="text-lg font-bold">Labour day forecast</h2><p className="text-sm text-slate-500">Remaining area ÷ expected productivity, added to what has already been booked.</p></div><div className="overflow-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[980px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Application','Remaining area','Expected productivity','Remaining days','Actual to date','Forecast total','Budget total','Variance','Status'].map((h,i)=><th key={h} className={`px-3 py-3 ${i?'text-right':'text-left'}`}>{h}</th>)}</tr></thead><tbody className="font-mono">{applicationGroups.map((row)=>{const d=budgetDerivedMetrics(row); const expProd=forecastBasis==='performance'&&d.actualProductivity>0?d.actualProductivity:d.budgetProductivity; const rem=expProd>0?row.remainingArea/expProd:row.remainingDays; const f=row.actualDays+rem; const v=f-row.budgetDays; return <tr key={row.key} className="border-t"><td className="px-3 py-2 text-left font-sans font-semibold">{row.label}</td><td className="px-3 py-2 text-right">{formatNumber(row.remainingArea)}</td><td className="px-3 py-2 text-right">{formatNumber(expProd)}</td><td className="px-3 py-2 text-right">{formatDecimal(rem,1)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.actualDays,1)}</td><td className="px-3 py-2 text-right">{formatDecimal(f,1)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.budgetDays,1)}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={v} money={false}/></td><td className="px-3 py-2 text-right"><BudgetStatusTag status={budgetVarianceStatus(row.budgetDays>0?v*100/row.budgetDays:null)}/></td></tr>})}</tbody></table></div></section>
      <div className="grid gap-4 lg:grid-cols-2"><div className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">Productivity trend</h3><BudgetTrendChart rows={trendRows} series={[{label:'Actual productivity',value:(r)=>r.productivity},{label:'Baseline productivity',value:()=>totals.budgetProductivity,dashed:true}]} valueFormatter={formatNumber}/></div><div className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">Labour days per {trendGrain}</h3><BudgetTrendChart rows={trendRows} series={[{label:'Labour days',value:(r)=>r.labourDays}]} valueFormatter={(v)=>formatDecimal(v,1)}/></div></div>
      <div className="grid gap-4 lg:grid-cols-2"><div className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">Labour overrun by layer</h3><BudgetHorizontalBars rows={[...layerVarianceRows].sort((a,b)=>b.d.dayVariance-a.d.dayVariance).slice(0,10).map((x)=>({label:x.row.label,amount:x.d.dayVariance}))} formatter={(v)=>`${v>0?'+':''}${formatDecimal(v,1)} d`}/></div><div className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">Labour saving by layer</h3><BudgetHorizontalBars rows={[...layerVarianceRows].sort((a,b)=>a.d.dayVariance-b.d.dayVariance).slice(0,10).map((x)=>({label:x.row.label,amount:x.d.dayVariance}))} formatter={(v)=>`${v>0?'+':''}${formatDecimal(v,1)} d`}/></div></div>
    </div>;
  }

  function renderMaterialBudget() {
    return <div className="space-y-7"><section><div className="mb-3"><h2 className="text-lg font-bold">Material budget vs actual</h2><p className="text-sm text-slate-500">Expected quantity is the baseline requirement earned by the work executed — never the full project requirement.</p></div><div className="max-h-[620px] overflow-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[1500px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Material','Budget qty','Expected qty','Actual qty','Remaining qty','Forecast qty','Qty variance','Qty var %','Budget cost','Expected cost','Actual cost','Cost variance','Cost var %','Forecast cost','Status'].map((h,i)=><th key={h} className={`px-3 py-3 ${i?'text-right':'text-left'}`}>{h}</th>)}</tr></thead><tbody className="font-mono">{materialGroups.map((row)=>{const d=budgetDerivedMetrics(row); return <tr key={row.key} className="border-t"><td className="px-3 py-2 text-left font-sans"><b>{row.label}</b><div className="text-[11px] text-slate-400">{row.layers.size} layers · {row.applications.size} applications</div></td><td className="px-3 py-2 text-right">{formatDecimal(row.budgetMaterialQty,2)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.expectedMaterialQty,2)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.actualMaterialQty,2)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.remainingMaterialQty,2)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.forecastMaterialQty,2)}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={d.qtyVariance} money={false}/></td><td className="px-3 py-2 text-right">{d.qtyVariancePct===null?'—':`${d.qtyVariancePct>0?'+':''}${formatDecimal(d.qtyVariancePct,1)}%`}</td><td className="px-3 py-2 text-right">{formatCurrency(row.budgetMaterial)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.expectedMaterial)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.actualMaterial)}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={d.materialVariance}/></td><td className="px-3 py-2 text-right">{d.materialVariancePct===null?'—':`${d.materialVariancePct>0?'+':''}${formatDecimal(d.materialVariancePct,1)}%`}</td><td className="px-3 py-2 text-right">{formatCurrency(row.forecastMaterial)}</td><td className="px-3 py-2 text-right"><BudgetStatusTag status={budgetVarianceStatus(d.qtyVariancePct ?? d.materialVariancePct)}/></td></tr>})}</tbody></table></div></section>
      <section><div className="mb-3"><h2 className="text-lg font-bold">Physical consumption and coverage</h2><p className="text-sm text-slate-500">Money hides wastage. Coverage does not.</p></div><div className="overflow-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Material','Ideal coverage','Ideal qty for work done','Actual qty used','Actual coverage','Efficiency','Over / under ideal','Over / under %','Cost of the gap','Status'].map((h,i)=><th key={h} className={`px-3 py-3 ${i?'text-right':'text-left'}`}>{h}</th>)}</tr></thead><tbody className="font-mono">{materialGroups.map((row)=>{const d=budgetDerivedMetrics(row); const ideal=safeDivide(row.budgetArea,row.budgetMaterialQty); const actual=safeDivide(row.expectedArea,row.actualMaterialQty); const eff=ideal>0&&actual>0?actual*100/ideal:null; const gapCost=d.qtyVariance*row.materialRatePerUnit; return <tr key={`cov-${row.key}`} className="border-t"><td className="px-3 py-2 text-left font-sans font-semibold">{row.label}</td><td className="px-3 py-2 text-right">{ideal>0?`${formatNumber(ideal)} sqft`:'—'}</td><td className="px-3 py-2 text-right">{formatDecimal(row.expectedMaterialQty,2)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.actualMaterialQty,2)}</td><td className="px-3 py-2 text-right">{actual>0?`${formatNumber(actual)} sqft`:'—'}</td><td className={`px-3 py-2 text-right ${eff!==null&&eff<95?'text-red-600':eff!==null&&eff>105?'text-emerald-700':''}`}>{eff===null?'—':`${formatDecimal(eff,1)}%`}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={d.qtyVariance} money={false}/></td><td className="px-3 py-2 text-right">{d.qtyVariancePct===null?'—':`${d.qtyVariancePct>0?'+':''}${formatDecimal(d.qtyVariancePct,1)}%`}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={gapCost}/></td><td className="px-3 py-2 text-right"><BudgetStatusTag status={budgetVarianceStatus(d.qtyVariancePct)}/></td></tr>})}</tbody></table></div></section>
      <div className="grid gap-4 lg:grid-cols-2"><div className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">Material cost per {trendGrain}</h3><BudgetTrendChart rows={trendRows} series={[{label:'Actual material',value:(r)=>r.actualMaterial},{label:'Expected material',value:(r)=>r.expectedMaterial,dashed:true}]}/></div><div className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">Top materials by cost variance</h3><BudgetHorizontalBars rows={[...materialVarianceRows].sort((a,b)=>Math.abs(b.d.materialVariance)-Math.abs(a.d.materialVariance)).slice(0,12).map((x)=>({label:x.row.label,amount:x.d.materialVariance}))}/></div></div>
    </div>;
  }

  function renderForecast() {
    const lines = [
      ['Labour days', projectTotals.budgetDays, projectTotals.actualDays, projectTotals.remainingDays, projectTotals.forecastDays - projectTotals.actualDays, projectTotals.forecastDays, false],
      ['Labour cost', projectTotals.budgetLabour, projectTotals.actualLabour, projectTotals.remainingLabour, projectTotals.forecastLabour - projectTotals.actualLabour, projectTotals.forecastLabour, true],
      ['Material quantity', projectTotals.budgetMaterialQty, projectTotals.actualMaterialQty, projectTotals.remainingMaterialQty, projectTotals.forecastMaterialQty - projectTotals.actualMaterialQty, projectTotals.forecastMaterialQty, false],
      ['Material cost', projectTotals.budgetMaterial, projectTotals.actualMaterial, projectTotals.remainingMaterial, projectTotals.forecastMaterial - projectTotals.actualMaterial, projectTotals.forecastMaterial, true],
      ['Total cost', projectTotals.budgetCost, projectTotals.actualCost, projectTotals.remainingCost, projectTotals.forecastCost - projectTotals.actualCost, projectTotals.forecastCost, true],
      ['Revenue', projectTotals.budgetRevenue, projectTotals.actualRevenue, projectTotals.remainingRevenue, projectTotals.forecastRevenue - projectTotals.actualRevenue, projectTotals.forecastRevenue, true],
      ['Margin', projectTotals.budgetRevenue-projectTotals.budgetCost, projectTotals.actualRevenue-projectTotals.actualCost, 0, 0, projectTotals.forecastRevenue-projectTotals.forecastCost, true],
    ] as const;
    return <div className="space-y-7"><section><div className="mb-3"><h2 className="text-lg font-bold">Estimate at completion</h2><p className="text-sm text-slate-500">{forecastBasis==='performance'?'Remaining work is priced at the rate completed work actually achieved, clamped between 0.25× and 4× of baseline.':'Remaining work is priced exactly at baseline; only completed work carries variance.'}</p></div><div className="overflow-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Line','Budget','Actual to date','Remaining at baseline','Remaining forecast','Forecast total','Forecast variance','Status'].map((h,i)=><th key={h} className={`px-3 py-3 ${i?'text-right':'text-left'}`}>{h}</th>)}</tr></thead><tbody className="font-mono">{lines.map(([label,b,a,r,rf,f,money])=>{const v=f-b; const pct=b>0?v*100/b:null; const render=(x:number)=>money?formatCurrency(x):formatDecimal(x,1); return <tr key={label} className="border-t"><td className="px-3 py-2 text-left font-sans font-semibold">{label}</td><td className="px-3 py-2 text-right">{render(b)}</td><td className="px-3 py-2 text-right">{render(a)}</td><td className="px-3 py-2 text-right">{label==='Margin'?'—':render(r)}</td><td className="px-3 py-2 text-right">{label==='Margin'?'—':render(rf)}</td><td className="px-3 py-2 text-right">{render(f)}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={v} money={money}/></td><td className="px-3 py-2 text-right"><BudgetStatusTag status={budgetVarianceStatus(label==='Revenue'||label==='Margin'?(pct===null?null:-pct):pct)}/></td></tr>})}</tbody></table></div></section>
      <section><div className="mb-3"><h2 className="text-lg font-bold">Remaining work</h2><p className="text-sm text-slate-500">What is still to be executed, and what it is expected to take.</p></div><div className="overflow-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Application','Remaining area','Remaining %','Remaining days','Remaining material qty','Remaining budget','Spent so far','Forecast total','Budget total','Forecast variance','Status'].map((h,i)=><th key={h} className={`px-3 py-3 ${i?'text-right':'text-left'}`}>{h}</th>)}</tr></thead><tbody className="font-mono">{applicationGroups.map((row)=>{const d=budgetDerivedMetrics(row); return <tr key={row.key} className="border-t"><td className="px-3 py-2 text-left font-sans font-semibold">{row.label}</td><td className="px-3 py-2 text-right">{formatNumber(row.remainingArea)}</td><td className="px-3 py-2 text-right">{formatDecimal(100-d.progress,1)}%</td><td className="px-3 py-2 text-right">{formatDecimal(row.remainingDays,1)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.remainingMaterialQty,2)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.remainingCost)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.actualCost)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.forecastCost)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.budgetCost)}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={d.forecastVariance}/></td><td className="px-3 py-2 text-right"><BudgetStatusTag status={budgetVarianceStatus(d.forecastVariancePct)}/></td></tr>})}</tbody></table></div></section>
      <section><div className="mb-3"><h2 className="text-lg font-bold">Project cost control</h2><p className="text-sm text-slate-500">Revenue, labour and material lines use the existing ZOS plan and actual sources.</p></div><div className="overflow-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[800px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-3 text-left">Line</th><th className="px-3 py-3 text-right">Budget</th><th className="px-3 py-3 text-right">Actual</th><th className="px-3 py-3 text-right">Forecast</th><th className="px-3 py-3 text-right">Forecast vs budget</th></tr></thead><tbody className="font-mono">{[['Revenue',projectTotals.budgetRevenue,projectTotals.actualRevenue,projectTotals.forecastRevenue],['Labour cost',projectTotals.budgetLabour,projectTotals.actualLabour,projectTotals.forecastLabour],['Material cost',projectTotals.budgetMaterial,projectTotals.actualMaterial,projectTotals.forecastMaterial],['Total cost',projectTotals.budgetCost,projectTotals.actualCost,projectTotals.forecastCost],['Margin',projectTotals.budgetRevenue-projectTotals.budgetCost,projectTotals.actualRevenue-projectTotals.actualCost,projectTotals.forecastRevenue-projectTotals.forecastCost]].map(([label,b,a,f])=><tr key={String(label)} className="border-t"><td className="px-3 py-2 text-left font-sans font-semibold">{label}</td><td className="px-3 py-2 text-right">{formatCurrency(Number(b))}</td><td className="px-3 py-2 text-right">{formatCurrency(Number(a))}</td><td className="px-3 py-2 text-right">{formatCurrency(Number(f))}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={Number(f)-Number(b)}/></td></tr>)}</tbody></table></div></section>
    </div>;
  }

  function renderVariance() {
    const layerOver = [...layerVarianceRows].sort((a,b)=>b.d.dayVariance-a.d.dayVariance).slice(0,10);
    const layerSave = [...layerVarianceRows].sort((a,b)=>a.d.dayVariance-b.d.dayVariance).slice(0,10);
    return <div className="space-y-7"><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">Top 10 labour overrun layers</h3><BudgetHorizontalBars rows={layerOver.map((x)=>({label:x.row.label,amount:x.d.dayVariance}))} formatter={(v)=>`${v>0?'+':''}${formatDecimal(v,1)} d`}/></div><div className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">Top 10 labour saving layers</h3><BudgetHorizontalBars rows={layerSave.map((x)=>({label:x.row.label,amount:x.d.dayVariance}))} formatter={(v)=>`${v>0?'+':''}${formatDecimal(v,1)} d`}/></div></div>
      <div className="grid gap-4 lg:grid-cols-3"><div className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">Material wastage by application</h3><BudgetHorizontalBars rows={applicationGroups.map((row)=>({label:row.label,amount:row.actualMaterial-row.expectedMaterial})).sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount))}/></div><div className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">Material wastage by layer</h3><BudgetHorizontalBars rows={layerGroups.map((row)=>({label:row.label,amount:row.actualMaterial-row.expectedMaterial})).sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount))}/></div><div className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">Material wastage by flat</h3><BudgetHorizontalBars rows={flatGroupsDerived.map((row)=>({label:row.label,amount:row.actualMaterial-row.expectedMaterial})).sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount))}/></div></div>
      <section><div className="mb-3"><h2 className="text-lg font-bold">Financial variance by flat</h2><p className="text-sm text-slate-500">Sortable-style variance view following the same 5 / 10 / 20 percent management thresholds as the reference.</p></div><div className="max-h-[560px] overflow-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[1250px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Flat','Progress','Expected cost','Actual cost','Cost variance','Var %','Labour variance','Material variance','Forecast variance','Margin erosion','Status'].map((h,i)=><th key={h} className={`px-3 py-3 ${i?'text-right':'text-left'}`}>{h}</th>)}</tr></thead><tbody className="font-mono">{[...flatRiskRows].sort((a,b)=>b.d.costVariance-a.d.costVariance).map(({row,d})=><tr key={row.key} className="border-t"><td className="px-3 py-2 text-left font-sans font-semibold">{row.label}</td><td className="px-3 py-2 text-right">{formatDecimal(d.progress,1)}%</td><td className="px-3 py-2 text-right">{formatCurrency(row.expectedCost)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.actualCost)}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={d.costVariance}/></td><td className="px-3 py-2 text-right">{d.costVariancePct===null?'—':`${d.costVariancePct>0?'+':''}${formatDecimal(d.costVariancePct,1)}%`}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={d.labourVariance}/></td><td className="px-3 py-2 text-right"><BudgetVarianceText value={d.materialVariance}/></td><td className="px-3 py-2 text-right"><BudgetVarianceText value={d.forecastVariance}/></td><td className={`px-3 py-2 text-right ${d.marginErosion!==null&&d.marginErosion<0?'text-red-600':'text-emerald-700'}`}>{d.marginErosion===null?'—':`${d.marginErosion>0?'+':''}${formatDecimal(d.marginErosion,1)} pp`}</td><td className="px-3 py-2 text-right"><BudgetStatusTag status={budgetVarianceStatus(d.costVariancePct)}/></td></tr>)}</tbody></table></div></section>
    </div>;
  }

  function renderTrends() {
    return <div className="space-y-7"><div><div className="mb-3 flex items-baseline gap-3"><h2 className="text-lg font-bold">Cost over time</h2><p className="text-sm text-slate-500">Expected is the budget earned on the day the work was executed, so the two lines share a calendar.</p></div><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">Actual vs expected cost</h3><BudgetTrendChart rows={trendRows} series={[{label:'Actual',value:(r)=>r.actualCost},{label:'Expected',value:(r)=>r.expectedCost,dashed:true}]}/></div><div className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">Cumulative consumption</h3><BudgetTrendChart rows={trendRows} series={[{label:'Actual cumulative',value:(r)=>r.cumulativeActual},{label:'Expected cumulative',value:(r)=>r.cumulativeExpected,dashed:true}]}/></div></div></div>
      <div className="grid gap-4 xl:grid-cols-3">{[["Labour cost",(r:BudgetTrendBucket)=>r.actualLabour,(r:BudgetTrendBucket)=>r.expectedLabour],["Material cost",(r:BudgetTrendBucket)=>r.actualMaterial,(r:BudgetTrendBucket)=>r.expectedMaterial],["Labour days",(r:BudgetTrendBucket)=>r.labourDays,null],["Area executed",(r:BudgetTrendBucket)=>r.area,null],["Productivity",(r:BudgetTrendBucket)=>r.productivity,null],["Material quantity",(r:BudgetTrendBucket)=>r.materialQty,null]].map(([title,actual,expected])=><div key={String(title)} className="rounded-md border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold">{String(title)}</h3><BudgetTrendChart rows={trendRows} series={[{label:'Actual',value:actual as (r:BudgetTrendBucket)=>number},...(expected?[{label:'Expected',value:expected as (r:BudgetTrendBucket)=>number,dashed:true}]:[])]} valueFormatter={String(title)==='Productivity'?formatNumber:String(title)==='Labour days'||String(title)==='Material quantity'?(v)=>formatDecimal(v,1):String(title)==='Area executed'?formatNumber:formatCurrency}/></div>)}</div>
      <section><div className="mb-3"><h2 className="text-lg font-bold">Period detail</h2></div><div className="max-h-[560px] overflow-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[1250px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Period','Entries','Area','Labour days','Productivity','Actual labour','Expected labour','Actual material','Expected material','Actual cost','Expected cost','Variance','Cumulative variance'].map((h,i)=><th key={h} className={`px-3 py-3 ${i?'text-right':'text-left'}`}>{h}</th>)}</tr></thead><tbody className="font-mono">{trendRows.map((row)=><tr key={row.key} className="border-t"><td className="px-3 py-2 text-left font-sans">{budgetBucketLabel(row.key,trendGrain)}</td><td className="px-3 py-2 text-right">{formatNumber(row.entries)}</td><td className="px-3 py-2 text-right">{formatNumber(row.area)}</td><td className="px-3 py-2 text-right">{formatDecimal(row.labourDays,1)}</td><td className="px-3 py-2 text-right">{formatNumber(row.productivity)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.actualLabour)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.expectedLabour)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.actualMaterial)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.expectedMaterial)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.actualCost)}</td><td className="px-3 py-2 text-right">{formatCurrency(row.expectedCost)}</td><td className="px-3 py-2 text-right"><BudgetVarianceText value={row.actualCost-row.expectedCost}/></td><td className="px-3 py-2 text-right"><BudgetVarianceText value={row.cumulativeActual-row.cumulativeExpected}/></td></tr>)}</tbody></table></div></section>
    </div>;
  }

  function renderDataQuality() {
    const totalEntries = derivedRows.reduce((sum,row)=>sum+row.entries,0);
    const datedEntries = trendSourceRows.reduce((sum,row)=>sum+Number(row.entries||0),0);
    const checks = [
      {label:'Actual work with no budget baseline', rows: derivedRows.filter((row)=>row.entries>0&&row.budgetCost<=0), note:'Booked work that could not find a matching costing baseline.'},
      {label:'Budget layers not yet started', rows: derivedRows.filter((row)=>row.budgetCost>0&&row.entries<=0&&row.layerProgressPct<=0), note:'Planned layer cells with no work booked yet.'},
      {label:'Layer progress above 105%', rows: derivedRows.filter((row)=>row.layerProgressPct>105), note:'Layer progress is materially above a complete layer.'},
      {label:'Actual material cost with no material budget', rows: derivedRows.filter((row)=>row.actualMaterial>0&&row.budgetMaterial<=0), note:'Material spend exists but the matching baseline has no material allowance.'},
      {label:'Actual material quantity with no material mapping', rows: derivedRows.filter((row)=>row.actualMaterialQty>0&&(!row.materialName||row.materialName==='Unmapped material')), note:'Consumption is present but no material name is mapped in the costing baseline.'},
      {label:'Booked cells with no measurable area', rows: derivedRows.filter((row)=>row.entries>0&&row.actualArea<=0), note:'These entries stay in cost/labour but cannot support per-sqft measures.'},
    ];
    const undated = Math.max(0,totalEntries-datedEntries);
    const findingCount = checks.filter((c)=>c.rows.length>0).length + (undated>0?1:0);
    return <div className="space-y-7"><section><div className="mb-3"><h2 className="text-lg font-bold">Data quality</h2><p className="text-sm text-slate-500">Database-backed equivalent of the reference checks. CSV import-only warnings are intentionally omitted because ZOS reads canonical Supabase sources.</p></div><div className="grid overflow-hidden rounded-md border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Checks run" value={String(checks.length+1)} sub="on the filtered budget data"/><KpiCard label="Checks with findings" value={String(findingCount)} sub={findingCount?'review before trusting variance':'nothing flagged'} valueClassName={findingCount?'text-red-600':'text-emerald-700'}/><KpiCard label="Work entries checked" value={formatNumber(totalEntries)} sub="in scope"/><KpiCard label="Baselines in scope" value={formatNumber(derivedRows.length)} sub="application–flat–layer"/></div></section><div className="overflow-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[850px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-3 text-left">Check</th><th className="px-3 py-3 text-right">Records</th><th className="px-3 py-3 text-left">What it means</th></tr></thead><tbody>{checks.map((check)=><tr key={check.label} className="border-t"><td className="px-3 py-2 font-semibold">{check.label}</td><td className={`px-3 py-2 text-right font-mono ${check.rows.length?'text-red-600':'text-emerald-700'}`}>{check.rows.length}</td><td className="px-3 py-2 text-slate-500">{check.note}{check.rows.length>0&&<div className="mt-1 max-w-[900px] truncate font-mono text-[11px] text-slate-400">{check.rows.slice(0,8).map((row)=>`${row.application} · ${row.flatId} · ${row.workLayer}`).join(' | ')}</div>}</td></tr>)}<tr className="border-t"><td className="px-3 py-2 font-semibold">Work entries with no readable date</td><td className={`px-3 py-2 text-right font-mono ${undated?'text-red-600':'text-emerald-700'}`}>{formatNumber(undated)}</td><td className="px-3 py-2 text-slate-500">Excluded from budget trend charts but counted elsewhere.</td></tr></tbody></table></div></div>;
  }

  const subnav: { id: BudgetSubsection; label: string }[] = [
    {id:'ba',label:'Budget vs actual'}, {id:'lab',label:'Labour budget'}, {id:'mat',label:'Material budget'},
    {id:'fc',label:'Forecast'}, {id:'va',label:'Variance analysis'}, {id:'tr',label:'Trends'}, {id:'dq',label:'Data quality'},
  ];

  return (
    <section className="space-y-6 aph-budget-cost-control">
      <div className="rounded-md border border-blue-100 bg-blue-50/70 p-3">
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Forecast basis</label><select value={forecastBasis} onChange={(e)=>setForecastBasis(e.target.value as BudgetForecastBasis)} className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"><option value="performance">Current performance</option><option value="budget">Budget rate</option></select></div>
          <div><label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Trend grain</label><select value={trendGrain} onChange={(e)=>setTrendGrain(e.target.value as BudgetTrendGrain)} className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select></div>
          <p className="text-xs text-slate-500">Variance thresholds follow the reference: On track ±5%, Watch &gt;5%, Over budget &gt;10%, Critical &gt;20%. ZOS already owns canonical area, labour-day and date rules, so CSV-only assumption switches are not duplicated.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-3"><h2 className="text-lg font-bold text-slate-950">Project cost control</h2><p className="text-sm text-slate-500">Budget is earned down to the work physically executed before anything is compared.</p></div>
      <div className="grid overflow-hidden rounded-md border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-8">
        {kpi('Total budget',formatCurrency(projectTotals.budgetCost),'labour + material at baseline')}
        {kpi('Expected to date',formatCurrency(projectTotals.expectedCost),`${formatDecimal(totals.progress,1)}% of the work is done`)}
        {kpi('Actual cost',formatCurrency(projectTotals.actualCost),`${formatDecimal(totals.costUsed,1)}% of total budget`)}
        {kpi('Cost variance',`${totals.costVariance>0?'+':''}${formatCurrency(totals.costVariance)}`,`${totals.costVariancePct===null?'—':`${totals.costVariancePct>0?'+':''}${formatDecimal(totals.costVariancePct,1)}%`} against expected`,totals.costVariance>0?'text-red-600':totals.costVariance<0?'text-emerald-700':'')}
        {kpi('Forecast cost',formatCurrency(projectTotals.forecastCost),forecastBasis==='performance'?'remaining at current rate':'remaining at budget rate')}
        {kpi('Forecast variance',`${totals.forecastVariance>0?'+':''}${formatCurrency(totals.forecastVariance)}`,totals.forecastVariancePct===null?'—':`${totals.forecastVariancePct>0?'+':''}${formatDecimal(totals.forecastVariancePct,1)}% against total budget`,totals.forecastVariance>0?'text-red-600':totals.forecastVariance<0?'text-emerald-700':'')}
        {kpi('Cost efficiency index',totals.efficiency===null?'—':formatDecimal(totals.efficiency,2),'progress ÷ cost consumed',totals.efficiency!==null&&totals.efficiency<0.98?'text-red-600':totals.efficiency!==null&&totals.efficiency>1.02?'text-emerald-700':'')}
        {kpi('Cost per sqft',formatMoneyPerSqft(safeDivide(projectTotals.actualCost,projectTotals.actualArea)),`budget ${formatMoneyPerSqft(safeDivide(projectTotals.budgetCost,projectTotals.budgetArea))} · forecast ${formatMoneyPerSqft(safeDivide(projectTotals.forecastCost,projectTotals.budgetArea))}`)}
      </div>
      <div className="grid overflow-hidden rounded-md border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-8">
        {kpi('Budget labour days',formatDecimal(projectTotals.budgetDays,1),'full scope')}{kpi('Expected labour days',formatDecimal(projectTotals.expectedDays,1),'for the work done')}{kpi('Actual labour days',formatDecimal(projectTotals.actualDays,1),totals.dayVariancePct===null?'—':`${totals.dayVariancePct>0?'+':''}${formatDecimal(totals.dayVariancePct,1)}% against expected`,totals.dayVariance>0?'text-red-600':totals.dayVariance<0?'text-emerald-700':'')}{kpi('Remaining labour days',formatDecimal(projectTotals.remainingDays,1),'work not yet started')}{kpi('Forecast labour days',formatDecimal(projectTotals.forecastDays,1),`${formatCurrency(projectTotals.forecastLabour-projectTotals.budgetLabour)} on labour cost`,projectTotals.forecastDays>projectTotals.budgetDays?'text-red-600':projectTotals.forecastDays<projectTotals.budgetDays?'text-emerald-700':'')}{kpi('Productivity',formatNumber(totals.actualProductivity),`baseline ${formatNumber(totals.budgetProductivity)} sqft/day`,totals.productivityVariancePct!==null&&totals.productivityVariancePct<0?'text-red-600':'')}{kpi('Material budget',formatCurrency(projectTotals.budgetMaterial),`${formatDecimal(projectTotals.budgetMaterialQty,2)} units`)}{kpi('Material actual',formatCurrency(projectTotals.actualMaterial),totals.materialVariancePct===null?'—':`${totals.materialVariancePct>0?'+':''}${formatDecimal(totals.materialVariancePct,1)}% against expected`,totals.materialVariance>0?'text-red-600':totals.materialVariance<0?'text-emerald-700':'')}
      </div>
      <div className="grid overflow-hidden rounded-md border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-8">
        {kpi('Total area',formatNumber(physicalBudgetArea),'sqft in scope')}{kpi('Completed area',formatNumber(physicalCompletedArea),`${formatDecimal(physicalProgress,1)}% physically complete`)}{kpi('Remaining area',formatNumber(physicalRemainingArea),'sqft still to execute')}{kpi('Budget consumed',`${formatDecimal(totals.budgetUsed,1)}%`,'earned ÷ total budget')}{kpi('Cost consumed',`${formatDecimal(totals.costUsed,1)}%`,'actual ÷ total budget',totals.gap<-5?'text-red-600':'')}{kpi('Budget revenue',projectTotals.budgetRevenue>0?formatCurrency(projectTotals.budgetRevenue):'—',totals.budgetMargin===null?'margin —':`margin ${formatDecimal(totals.budgetMargin,1)}%`)}{kpi('Forecast margin',totals.forecastMargin===null?'—':`${formatDecimal(totals.forecastMargin,1)}%`,totals.marginErosion===null?'—':`${totals.marginErosion>0?'+':''}${formatDecimal(totals.marginErosion,1)} pp against budget`,totals.marginErosion!==null&&totals.marginErosion<0?'text-red-600':totals.marginErosion!==null&&totals.marginErosion>0?'text-emerald-700':'')}{kpi('Layers in scope',formatNumber(derivedRows.length),`${derivedRows.filter((r)=>r.layerProgressPct>=99.9).length} complete · ${derivedRows.filter((r)=>r.layerProgressPct>0&&r.layerProgressPct<99.9).length} part · ${derivedRows.filter((r)=>r.layerProgressPct<=0).length} not started`)}
      </div>

      {totals.gap < -BUDGET_THRESHOLDS.ok && projectTotals.budgetCost > 0 && <div className="rounded-md border border-red-200 border-l-4 border-l-red-600 bg-red-50 p-4"><h3 className="font-bold uppercase text-red-700">Cost is running ahead of progress</h3><p className="mt-1 text-sm text-red-800">Cost consumption is <b>{formatDecimal(Math.abs(totals.gap),1)} percentage points</b> ahead of physical progress — {formatDecimal(totals.costUsed,1)}% of the budget spent against {formatDecimal(totals.progress,1)}% of work executed. At the current rate the job finishes at {formatCurrency(projectTotals.forecastCost)} against a budget of {formatCurrency(projectTotals.budgetCost)}.</p></div>}

      <div className="grid gap-4 xl:grid-cols-3"><div className="rounded-md border border-slate-200 bg-white p-4"><div className="mb-3 flex justify-between"><b>Top 5 risks</b><span className="text-xs text-slate-400">largest cost overrun</span></div>{risks.length?risks.map(({row,d},i)=><div key={row.key} className="grid grid-cols-[20px_1fr_auto] gap-2 border-b border-slate-100 py-2 text-sm"><span className="font-mono text-slate-400">{i+1}</span><span>{row.label}<small className="block text-slate-400">expected {formatCurrency(row.expectedCost)} · actual {formatCurrency(row.actualCost)}</small></span><b className="font-mono text-red-600">{formatCurrency(d.costVariance)}</b></div>):<div className="py-5 text-sm text-slate-500">No flat is over its earned budget.</div>}</div><div className="rounded-md border border-slate-200 bg-white p-4"><div className="mb-3 flex justify-between"><b>Top 5 savings</b><span className="text-xs text-slate-400">largest underspend</span></div>{savings.length?savings.map(({row,d},i)=><div key={row.key} className="grid grid-cols-[20px_1fr_auto] gap-2 border-b border-slate-100 py-2 text-sm"><span className="font-mono text-slate-400">{i+1}</span><span>{row.label}<small className="block text-slate-400">expected {formatCurrency(row.expectedCost)} · actual {formatCurrency(row.actualCost)}</small></span><b className="font-mono text-emerald-700">{formatCurrency(d.costVariance)}</b></div>):<div className="py-5 text-sm text-slate-500">No flat is under its earned budget.</div>}</div><div className="rounded-md border border-slate-200 bg-white p-4"><div className="mb-3 flex justify-between"><b>Management alerts</b><span className="text-xs text-slate-400">generated from ZOS data</span></div>{alerts.length?alerts.map((a,i)=><div key={`${a.tag}-${i}`} className={`mb-2 border-l-4 p-2 text-sm ${a.level==='crit'?'border-red-600 bg-red-50':a.level==='warn'?'border-orange-400 bg-orange-50':'border-emerald-600 bg-emerald-50'}`}><b className="text-[10px] uppercase text-slate-500">{a.tag}</b> — {a.text}<span className="float-right font-mono font-semibold">{a.amount}</span></div>):<div className="py-5 text-sm text-slate-500">Nothing is outside the thresholds.</div>}</div></div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 pt-2">{subnav.map((item)=><button key={item.id} type="button" onClick={()=>setSubsection(item.id)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${subsection===item.id?'border-slate-950 font-semibold text-slate-950':'border-transparent text-slate-500 hover:text-slate-950'}`}>{item.label}</button>)}</div>

      {subsection==='ba'&&renderBudgetVsActual()}{subsection==='lab'&&renderLabourBudget()}{subsection==='mat'&&renderMaterialBudget()}{subsection==='fc'&&renderForecast()}{subsection==='va'&&renderVariance()}{subsection==='tr'&&renderTrends()}{subsection==='dq'&&renderDataQuality()}
    </section>
  );
}


type EntryReviewSubsection = 'entries' | 'painters';

type EntryReviewColumnKey =
  | 'check'
  | 'state'
  | 'wstat'
  | 'flat'
  | 'app'
  | 'layer'
  | 'painter'
  | 'area'
  | 'hours'
  | 'labour'
  | 'prod'
  | 'cover'
  | 'mat'
  | 'matqty'
  | 'how'
  | 'remark';

const ENTRY_REVIEW_COLUMNS: { key: EntryReviewColumnKey; label: string; width: number; align: 'left' | 'right' }[] = [
  { key: 'check', label: 'Check', width: 96, align: 'left' },
  { key: 'state', label: 'Check status', width: 138, align: 'left' },
  { key: 'wstat', label: 'Work status', width: 100, align: 'left' },
  { key: 'flat', label: 'Flat', width: 130, align: 'left' },
  { key: 'app', label: 'Application', width: 150, align: 'left' },
  { key: 'layer', label: 'Work layer', width: 160, align: 'left' },
  { key: 'painter', label: 'Painter', width: 180, align: 'left' },
  { key: 'area', label: 'Area', width: 88, align: 'right' },
  { key: 'hours', label: 'Hours', width: 76, align: 'right' },
  { key: 'labour', label: 'Labour days', width: 96, align: 'right' },
  { key: 'prod', label: 'Productivity', width: 126, align: 'right' },
  { key: 'cover', label: 'Coverage', width: 126, align: 'right' },
  { key: 'mat', label: 'Material', width: 170, align: 'left' },
  { key: 'matqty', label: 'Material used', width: 104, align: 'right' },
  { key: 'how', label: 'Method', width: 100, align: 'left' },
  { key: 'remark', label: 'Remark', width: 220, align: 'left' },
];

function splitReviewPainters(value: string) {
  return String(value || '')
    .split(/[,;|/&]+|\s+and\s+/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function reviewIsChecked(row: EntryReviewRow) {
  return row.reviewStatus === 'approved' || row.reviewStatus === 'rejected' || Boolean(row.reviewComment.trim());
}

function reviewDateLabel(value: string) {
  if (!value) return 'No date';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function reviewDateTimeLabel(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function deviationTone(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'aph-rv-dev-neutral';
  if (Math.abs(value) <= 10) return 'aph-rv-dev-neutral';
  return value > 0 ? 'aph-rv-dev-good' : 'aph-rv-dev-bad';
}

function ReviewActualBaseline({
  actual,
  baseline,
  deviation,
  formatter,
  unit,
}: {
  actual: number;
  baseline: number;
  deviation: number | null;
  formatter: (value: number) => string;
  unit?: string;
}) {
  if (!(actual > 0)) return <span className="aph-rv-dim">—</span>;

  return (
    <span className="aph-rv-metric">
      <span>{formatter(actual)}{unit ? <small> {unit}</small> : null}</span>
      {baseline > 0 && deviation !== null ? (
        <small className={deviationTone(deviation)}>
          {deviation >= 0 ? '+' : ''}{formatDecimal(deviation, 0)}% <i>vs {formatter(baseline)}</i>
        </small>
      ) : (
        <small className="aph-rv-dim">no baseline</small>
      )}
    </span>
  );
}

function EntryReviewStatus({ row }: { row: EntryReviewRow }) {
  const commentedOnly = row.reviewStatus === 'open' && Boolean(row.reviewComment.trim());
  const label =
    row.reviewStatus === 'approved'
      ? 'Approved'
      : row.reviewStatus === 'rejected'
        ? 'Rejected'
        : commentedOnly
          ? 'Commented'
          : 'Open';

  const cls =
    row.reviewStatus === 'approved'
      ? 'aph-rv-status-approved'
      : row.reviewStatus === 'rejected'
        ? 'aph-rv-status-rejected'
        : commentedOnly
          ? 'aph-rv-status-commented'
          : 'aph-rv-status-open';

  return (
    <div className="aph-rv-state-wrap">
      <span className={`aph-rv-status ${cls}`}>{label}</span>
      {row.reviewComment && (
        <span className="aph-rv-comment" title={row.reviewComment}>“{row.reviewComment}”</span>
      )}
      {(row.reviewedBy || row.reviewedAt) && (
        <span className="aph-rv-by" title={`${row.reviewedBy || '—'} · ${reviewDateTimeLabel(row.reviewedAt)}`}>
          {row.reviewedBy || '—'}
          {row.reviewedAt && <small>{reviewDateTimeLabel(row.reviewedAt)}</small>}
        </span>
      )}
    </div>
  );
}

function EntryReviewTab({
  token,
  projectId,
  filters,
  refreshVersion,
  reviewerName,
}: {
  token: string;
  projectId: string;
  filters: ExecutiveSummaryFilters;
  refreshVersion: number;
  reviewerName: string;
}) {
  const [subsection, setSubsection] = useState<EntryReviewSubsection>('entries');
  const [data, setData] = useState<EntryReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mutatingId, setMutatingId] = useState('');
  const [error, setError] = useState('');
  const [reviewFilters, setReviewFilters] = useState<EntryReviewFilters>({});
  const [appliedReviewFilters, setAppliedReviewFilters] = useState<EntryReviewFilters>({});
  const [openReviewFilterKey, setOpenReviewFilterKey] = useState<string | null>(null);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const requestRef = useRef(0);

  const storageKey = `zos-entry-review-widths-${projectId}`;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (saved && typeof saved === 'object') setColumnWidths(saved);
    } catch {
      setColumnWidths({});
    }
  }, [storageKey]);

  const loadFirstPage = useCallback(async () => {
    if (!token || !projectId) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');

    try {
      const next = await fetchEntryReview(token, projectId, filters, appliedReviewFilters, 400, 0);
      if (requestId !== requestRef.current) return;
      setData(next);
      setCollapsedDays(new Set());
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load entry review');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [appliedReviewFilters, filters, projectId, token]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage, refreshVersion]);

  const rows = data?.rows || [];
  const summary = data?.summary;
  const options = data?.options;

  const groupedRows = useMemo(() => {
    const map = new Map<string, EntryReviewRow[]>();
    rows.forEach((row) => {
      const key = row.workDate || '—';
      const current = map.get(key) || [];
      current.push(row);
      map.set(key, current);
    });

    return Array.from(map.entries())
      .sort(([a], [b]) => {
        if (a === '—') return 1;
        if (b === '—') return -1;
        return b.localeCompare(a);
      })
      .map(([date, items]) => ({ date, items }));
  }, [rows]);

  const checkedPct = summary?.entriesInView
    ? Math.round((summary.checked / summary.entriesInView) * 100)
    : 0;

  const applyReviewFilters = useCallback(() => {
    setAppliedReviewFilters({ ...reviewFilters });
    setOpenReviewFilterKey(null);
  }, [reviewFilters]);

  function setReviewFilter(key: keyof EntryReviewFilters, value: string) {
    setReviewFilters((current) => ({ ...current, [key]: value || undefined }));
  }

  function resetReviewFilters() {
    setReviewFilters({});
    setAppliedReviewFilters({});
    setOpenReviewFilterKey(null);
  }

  async function loadMore(showAll = false) {
    if (!data || loadingMore || !data.pagination.hasMore) return;
    setLoadingMore(true);
    setError('');
    try {
      let allRows = [...data.rows];
      let offset = allRows.length;
      let latest = data;

      do {
        latest = await fetchEntryReview(token, projectId, filters, appliedReviewFilters, 400, offset);
        allRows = [...allRows, ...latest.rows];
        offset = allRows.length;
        if (!showAll) break;
      } while (offset < latest.pagination.total);

      setData({
        ...latest,
        rows: allRows,
        pagination: {
          ...latest.pagination,
          offset: 0,
          total: latest.pagination.total,
          hasMore: allRows.length < latest.pagination.total,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more review entries');
    } finally {
      setLoadingMore(false);
    }
  }

  function updateSummaryForMutation(before: EntryReviewRow, after: EntryReviewRow) {
    setData((current) => {
      if (!current) return current;
      const nextSummary = { ...current.summary };
      const beforeChecked = reviewIsChecked(before);
      const afterChecked = reviewIsChecked(after);
      if (beforeChecked !== afterChecked) nextSummary.checked += afterChecked ? 1 : -1;
      if (before.reviewStatus !== after.reviewStatus) {
        if (before.reviewStatus === 'approved') nextSummary.approved -= 1;
        if (before.reviewStatus === 'rejected') nextSummary.rejected -= 1;
        if (after.reviewStatus === 'approved') nextSummary.approved += 1;
        if (after.reviewStatus === 'rejected') nextSummary.rejected += 1;
      }
      const beforeComment = Boolean(before.reviewComment.trim());
      const afterComment = Boolean(after.reviewComment.trim());
      if (beforeComment !== afterComment) nextSummary.withComment += afterComment ? 1 : -1;
      return {
        ...current,
        summary: nextSummary,
        rows: current.rows.map((row) => (row.id === after.id ? after : row)),
      };
    });
  }

  async function mutateReview(row: EntryReviewRow, payload: { status?: 'open' | 'approved' | 'rejected'; comment?: string | null }) {
    setMutatingId(row.id);
    setError('');
    try {
      const result = await updateEntryReview(token, projectId, row.id, payload);
      const after: EntryReviewRow = {
        ...row,
        reviewStatus: result.reviewStatus,
        reviewComment: result.reviewComment || '',
        reviewedBy: result.reviewedBy || '',
        reviewedAt: result.reviewedAt,
      };

      if (appliedReviewFilters.reviewStatus) {
        await loadFirstPage();
      } else {
        updateSummaryForMutation(row, after);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update entry review');
    } finally {
      setMutatingId('');
    }
  }

  async function commentOnRow(row: EntryReviewRow) {
    const next = window.prompt('Comment on this entry', row.reviewComment || '');
    if (next === null) return;
    await mutateReview(row, { comment: next.trim() });
  }

  async function exportDecisions() {
    setLoadingMore(true);
    setError('');
    try {
      const all: EntryReviewRow[] = [];
      let offset = 0;
      let total = 1;
      const exportFilters: EntryReviewFilters = {};
      while (offset < total) {
        const result = await fetchEntryReview(token, projectId, filters, exportFilters, 400, offset);
        all.push(...result.rows);
        total = result.pagination.total;
        offset = all.length;
        if (!result.rows.length) break;
      }

      const reviewed = all.filter(reviewIsChecked);
      if (!reviewed.length) {
        window.alert('No entries have been approved, rejected or commented on yet.');
        return;
      }

      const headers = [
        'Backend ID','Block','Application','Flat','Work Layer','Date','Painter','Area','Labour days',
        'Labour Cost','Material Cost','Decision','Comment','By','When',
      ];
      const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const body = reviewed.map((row) => [
        row.id,row.block,row.application,row.flat,row.workLayer,row.workDate,row.painterNames,row.area,row.labourDays,
        row.labourCost,row.materialCost,
        row.reviewStatus === 'open' ? 'commented' : row.reviewStatus,
        row.reviewComment,row.reviewedBy,row.reviewedAt || '',
      ]);
      const blob = new Blob(
        [[headers, ...body].map((line) => line.map(csvCell).join(',')).join('\r\n')],
        { type: 'text/csv;charset=utf-8' },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `zos-entry-review-${reviewed.length}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export review decisions');
    } finally {
      setLoadingMore(false);
    }
  }

  async function clearDecisions() {
    const confirmed = window.confirm(
      'Clear every approval, rejection and comment in the current Entry Review scope? This cannot be undone.',
    );
    if (!confirmed) return;

    setLoadingMore(true);
    setError('');
    try {
      const all: EntryReviewRow[] = [];
      let offset = 0;
      let total = 1;
      const scopeFilters: EntryReviewFilters = { ...appliedReviewFilters };
      while (offset < total) {
        const result = await fetchEntryReview(token, projectId, filters, scopeFilters, 400, offset);
        all.push(...result.rows);
        total = result.pagination.total;
        offset = all.length;
        if (!result.rows.length) break;
      }

      const reviewed = all.filter(reviewIsChecked);
      for (let index = 0; index < reviewed.length; index += 10) {
        await Promise.all(
          reviewed.slice(index, index + 10).map((row) => clearEntryReview(token, projectId, row.id)),
        );
      }
      await loadFirstPage();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear review decisions');
    } finally {
      setLoadingMore(false);
    }
  }

  function startResize(index: number, event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const column = ENTRY_REVIEW_COLUMNS[index];
    const startWidth = columnWidths[column.key] || column.width;

    function move(moveEvent: PointerEvent) {
      const nextWidth = Math.max(64, Math.round(startWidth + moveEvent.clientX - startX));
      setColumnWidths((current) => ({ ...current, [column.key]: nextWidth }));
    }

    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setColumnWidths((current) => {
        try { localStorage.setItem(storageKey, JSON.stringify(current)); } catch {}
        return current;
      });
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  function resetWidths() {
    setColumnWidths({});
    try { localStorage.removeItem(storageKey); } catch {}
  }

  const painterCards = useMemo(() => {
    const selected = parseMultiValue(appliedReviewFilters.painters);
    const report = data?.painterReport || [];
    return selected.length
      ? report.filter((item) => selected.some((name) => normalizeFilterValue(name) === normalizeFilterValue(item.painter)))
      : report.slice(0, 3);
  }, [appliedReviewFilters.painters, data?.painterReport]);

  if (loading && !data) {
    return (
      <div className="aph-skeleton-card" aria-label="Loading Entry Review">
        <span /><span /><span />
      </div>
    );
  }

  return (
    <section className="aph-entry-review">
      {error && <div className="aph-alert aph-alert-error">{error}</div>}

      <div className="aph-kpi-grid aph-rv-kpis">
        <KpiCard label="Entries in view" value={formatNumber(summary?.entriesInView || 0)} sub="after the filters above" />
        <KpiCard label="Checked" value={formatNumber(summary?.checked || 0)} sub={`${checkedPct}% of them`} />
        <KpiCard label="Approved" value={formatNumber(summary?.approved || 0)} sub=" " valueClassName="text-emerald-600" />
        <KpiCard label="Rejected" value={formatNumber(summary?.rejected || 0)} sub=" " valueClassName="text-red-500" />
        <KpiCard label="With a comment" value={formatNumber(summary?.withComment || 0)} sub="review notes" />
        <KpiCard label="Painters" value={formatNumber(summary?.painters || 0)} sub="named on these entries" />
        <KpiCard label="Working hours" value={(summary?.workingHours || 0) > 0 ? formatDecimal(summary?.workingHours || 0, 1) : '—'} sub="recorded against painters" />
        <KpiCard label="Days covered" value={formatNumber(summary?.daysCovered || 0)} sub="with at least one entry" />
      </div>

      <div className="aph-rv-subnav" role="tablist" aria-label="Entry Review views">
        <button type="button" className={subsection === 'entries' ? 'active' : ''} onClick={() => setSubsection('entries')}>Entry log</button>
        <button type="button" className={subsection === 'painters' ? 'active' : ''} onClick={() => setSubsection('painters')}>Painter report</button>
      </div>

      <div className="aph-rv-toolbar">
        <SearchableMultiSelect
          filterKey="review-date"
          label="Date"
          value={reviewFilters.dates || ''}
          options={toMultiSelectOptions(options?.dates || [])}
          allLabel="All dates"
          onChange={(value) => setReviewFilter('dates', value)}
          onApply={applyReviewFilters}
          openFilterKey={openReviewFilterKey}
          setOpenFilterKey={setOpenReviewFilterKey}
        />
        <SearchableMultiSelect
          filterKey="review-painter"
          label="Painter"
          value={reviewFilters.painters || ''}
          options={toMultiSelectOptions(options?.painters || [])}
          allLabel="All painters"
          onChange={(value) => setReviewFilter('painters', value)}
          onApply={applyReviewFilters}
          openFilterKey={openReviewFilterKey}
          setOpenFilterKey={setOpenReviewFilterKey}
        />
        {subsection === 'entries' && (
          <>
            <SearchableMultiSelect
              filterKey="review-layer"
              label="Work layer"
              value={reviewFilters.workLayers || ''}
              options={toMultiSelectOptions(options?.workLayers || [])}
              allLabel="All layers"
              onChange={(value) => setReviewFilter('workLayers', value)}
              onApply={applyReviewFilters}
              openFilterKey={openReviewFilterKey}
              setOpenFilterKey={setOpenReviewFilterKey}
            />
            <SearchableMultiSelect
              filterKey="review-work-status"
              label="Work status"
              value={reviewFilters.workStatuses || ''}
              options={toMultiSelectOptions(options?.workStatuses || [])}
              allLabel="All statuses"
              onChange={(value) => setReviewFilter('workStatuses', value)}
              onApply={applyReviewFilters}
              openFilterKey={openReviewFilterKey}
              setOpenFilterKey={setOpenReviewFilterKey}
            />
            <label className="aph-field aph-rv-state-filter">
              <span>Check status</span>
              <select
                value={reviewFilters.reviewStatus || ''}
                onChange={(event) => {
                  const value = event.target.value as EntryReviewFilters['reviewStatus'];
                  const next = { ...reviewFilters, reviewStatus: value || undefined };
                  setReviewFilters(next);
                  setAppliedReviewFilters(next);
                }}
              >
                <option value="">All states</option>
                <option value="open">Open</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="commented">With a comment</option>
              </select>
            </label>
          </>
        )}
        <button type="button" className="aph-btn aph-btn-ghost" onClick={resetReviewFilters}>Reset review filters</button>

        <div className="aph-rv-toolbar-spacer" />

        {subsection === 'entries' ? (
          <>
            <span className="aph-rv-who">Checking as <b>{reviewerName || 'admin'}</b></span>
            <button type="button" className="aph-btn aph-btn-ghost" onClick={() => setCollapsedDays(new Set())}>Expand days</button>
            <button
              type="button"
              className="aph-btn aph-btn-ghost"
              onClick={() => setCollapsedDays(new Set(groupedRows.map((group) => group.date)))}
            >
              Collapse days
            </button>
            <button type="button" className="aph-btn aph-btn-ghost" onClick={() => void exportDecisions()} disabled={loadingMore}>Export decisions</button>
            <button type="button" className="aph-btn aph-btn-ghost aph-btn-danger" onClick={() => void clearDecisions()} disabled={loadingMore}>Clear decisions</button>
            <button type="button" className="aph-btn aph-btn-ghost" onClick={resetWidths}>Reset widths</button>
          </>
        ) : (
          <span className="aph-rv-note">Where one entry names several painters, its area and labour split equally between them. Hours count in full against each, as recorded.</span>
        )}
      </div>

      {subsection === 'entries' ? (
        <>
          {!rows.length ? (
            <div className="aph-rv-empty">No entries match these pickers.</div>
          ) : (
            <div className="aph-table-scroll aph-rv-table-shell">
              <table className="aph-rv-table">
                <colgroup>
                  {ENTRY_REVIEW_COLUMNS.map((column) => (
                    <col key={column.key} style={{ width: columnWidths[column.key] || column.width }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {ENTRY_REVIEW_COLUMNS.map((column, index) => (
                      <th key={column.key} className={column.align === 'right' ? 'text-right' : 'text-left'}>
                        {column.label}
                        <span className="aph-rv-resizer" onPointerDown={(event) => startResize(index, event)} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupedRows.map((group) => {
                    const collapsed = collapsedDays.has(group.date);
                    const area = group.items.reduce((sum, row) => sum + row.area, 0);
                    const hours = group.items.reduce((sum, row) => sum + row.workingHours, 0);
                    const labour = group.items.reduce((sum, row) => sum + row.labourDays, 0);
                    const cost = group.items.reduce((sum, row) => sum + row.labourCost + row.materialCost, 0);
                    const approved = group.items.filter((row) => row.reviewStatus === 'approved').length;
                    const rejected = group.items.filter((row) => row.reviewStatus === 'rejected').length;
                    const open = group.items.length - approved - rejected;

                    return (
                      <Fragment key={group.date}>
                        <tr
                          className="aph-rv-day-row"
                          onClick={() => setCollapsedDays((current) => {
                            const next = new Set(current);
                            if (next.has(group.date)) next.delete(group.date); else next.add(group.date);
                            return next;
                          })}
                        >
                          <td colSpan={ENTRY_REVIEW_COLUMNS.length}>
                            <span className="aph-rv-caret">{collapsed ? '▶' : '▼'}</span>
                            <b>{reviewDateLabel(group.date)}</b>
                            <span className="aph-rv-day-chips">
                              <span>{group.items.length} {group.items.length === 1 ? 'entry' : 'entries'}</span>
                              <span>{formatNumber(area)} sqft</span>
                              {hours > 0 && <span>{formatDecimal(hours, 1)} h</span>}
                              <span>{formatDecimal(labour, 1)} labour days</span>
                              <span>{formatCurrency(cost)}</span>
                              {approved > 0 && <span className="good">{approved} approved</span>}
                              {rejected > 0 && <span className="bad">{rejected} rejected</span>}
                              {open > 0 && <span className="pending">{open} open</span>}
                            </span>
                          </td>
                        </tr>
                        {!collapsed && group.items.map((row) => {
                          const painters = splitReviewPainters(row.painterNames);
                          const ops = !isAnalyticsBillableLayer(row.workLayer);
                          const rowClass = row.reviewStatus === 'approved'
                            ? 'aph-rv-row aph-rv-row-approved'
                            : row.reviewStatus === 'rejected'
                              ? 'aph-rv-row aph-rv-row-rejected'
                              : 'aph-rv-row';

                          return (
                            <tr key={row.id} className={rowClass}>
                              <td className="text-left">
                                <span className="aph-rv-actions">
                                  <button
                                    type="button"
                                    className={row.reviewStatus === 'approved' ? 'approve active' : 'approve'}
                                    disabled={mutatingId === row.id}
                                    onClick={() => void mutateReview(row, { status: row.reviewStatus === 'approved' ? 'open' : 'approved' })}
                                    title="Approve"
                                  >✓</button>
                                  <button
                                    type="button"
                                    className={row.reviewStatus === 'rejected' ? 'reject active' : 'reject'}
                                    disabled={mutatingId === row.id}
                                    onClick={() => void mutateReview(row, { status: row.reviewStatus === 'rejected' ? 'open' : 'rejected' })}
                                    title="Reject"
                                  >✕</button>
                                  <button
                                    type="button"
                                    className={row.reviewComment ? 'comment active' : 'comment'}
                                    disabled={mutatingId === row.id}
                                    onClick={() => void commentOnRow(row)}
                                    title="Comment"
                                  >✎</button>
                                </span>
                              </td>
                              <td className="text-left"><EntryReviewStatus row={row} /></td>
                              <td className="text-left"><span className={`aph-rv-work-status ${normalizeFilterValue(row.workStatus) === 'done' ? 'done' : 'other'}`}>{row.workStatus || '—'}</span></td>
                              <td className="text-left"><b>{row.flat || '—'}</b>{row.block && <small className="aph-rv-sub">{row.block}</small>}</td>
                              <td className="text-left">{row.application || '—'}</td>
                              <td className="text-left">{row.workLayer || '—'}{ops && <span className="aph-rv-ops">OPS</span>}</td>
                              <td className="text-left" title={painters.join(', ')}>
                                {painters.length ? (
                                  <span className="aph-rv-painters">
                                    {painters.slice(0, 2).map((painter) => <span key={painter}>{painter}</span>)}
                                    {painters.length > 2 && <span>+{painters.length - 2}</span>}
                                  </span>
                                ) : <span className="aph-rv-dim">—</span>}
                              </td>
                              <td className="text-right">{formatNumber(row.area)}</td>
                              <td className="text-right">{row.workingHours > 0 ? formatDecimal(row.workingHours, 1) : '—'}</td>
                              <td className="text-right">{row.labourDays > 0 ? formatDecimal(row.labourDays, 1) : '—'}</td>
                              <td className="text-right">
                                <ReviewActualBaseline actual={row.productivity} baseline={row.targetProductivity} deviation={row.productivityDeviationPct} formatter={formatNumber} unit="sqft/day" />
                              </td>
                              <td className="text-right">
                                <ReviewActualBaseline actual={row.coverage} baseline={row.targetCoverage} deviation={row.coverageDeviationPct} formatter={formatNumber} unit="sqft/unit" />
                              </td>
                              <td className="text-left"><span className="aph-rv-material" title={row.materialName}>{row.materialName || '—'}</span></td>
                              <td className="text-right">{row.materialUsed > 0 ? formatDecimal(row.materialUsed, 1) : '—'}</td>
                              <td className="text-left"><span className="aph-rv-method">{row.machineOrManual || '—'}</span></td>
                              <td className="text-left"><span className="aph-rv-remark" title={row.remark}>{row.remark || '—'}</span></td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data && data.pagination.total > rows.length && (
            <div className="aph-rv-morebar">
              {formatNumber(rows.length)} of {formatNumber(data.pagination.total)} entries shown — {formatNumber(data.pagination.total - rows.length)} more.
              <button type="button" className="aph-btn aph-btn-ghost" disabled={loadingMore} onClick={() => void loadMore(false)}>
                {loadingMore ? 'Loading…' : `Show ${formatNumber(Math.min(400, data.pagination.total - rows.length))} more`}
              </button>
              <button type="button" className="aph-btn aph-btn-ghost" disabled={loadingMore} onClick={() => void loadMore(true)}>Show all</button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="aph-table-scroll aph-rv-painter-table-shell">
            <table>
              <thead>
                <tr>
                  <th className="text-left">Painter</th>
                  <th className="text-right">Days on site</th>
                  <th className="text-right">Working hours</th>
                  <th className="text-right">Labour days</th>
                  <th className="text-right">Area done</th>
                  <th className="text-right">Sqft / labour day</th>
                  <th className="text-right">Sqft / hour</th>
                  <th className="text-right">Layers</th>
                  <th className="text-left">Most of their time</th>
                  <th className="text-right">Flats</th>
                  <th className="text-left">Worked on</th>
                  <th className="text-left">First → last</th>
                  <th className="text-right">Labour cost</th>
                  <th className="text-right">Entries</th>
                </tr>
              </thead>
              <tbody>
                {(data?.painterReport || []).map((item) => (
                  <tr key={item.painter}>
                    <td className="text-left"><b>{item.painter}</b></td>
                    <td className="text-right">{formatNumber(item.daysOnSite)}</td>
                    <td className="text-right">{item.workingHours > 0 ? formatDecimal(item.workingHours, 1) : '—'}</td>
                    <td className="text-right">{formatDecimal(item.labourDays, 1)}</td>
                    <td className="text-right">{formatNumber(item.area)}</td>
                    <td className="text-right">{formatNumber(item.productivity)}</td>
                    <td className="text-right">{item.workingHours > 0 ? formatNumber(item.sqftPerHour) : '—'}</td>
                    <td className="text-right" title={item.layerList.join(', ')}>{formatNumber(item.layers)}</td>
                    <td className="text-left">{item.topLayer || '—'}{item.topLayer && <span className="aph-rv-sub">{Math.round(item.topShare * 100)}% of their area</span>}</td>
                    <td className="text-right">{formatNumber(item.flats)}</td>
                    <td className="text-left"><span className="aph-rv-sub">{item.applications.slice(0, 3).join(', ')}{item.applications.length > 3 ? ` +${item.applications.length - 3}` : ''}</span></td>
                    <td className="text-left"><span className="aph-rv-sub">{item.firstDate ? reviewDateLabel(item.firstDate) : '—'} → {item.lastDate ? reviewDateLabel(item.lastDate) : '—'}</span></td>
                    <td className="text-right">{formatCurrency(item.labourCost)}</td>
                    <td className="text-right">{formatNumber(item.entries)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {painterCards.length > 0 && (
            <>
              <div className="aph-rv-painter-heading">
                <h2>{parseMultiValue(appliedReviewFilters.painters).length ? painterCards.map((item) => item.painter).join(', ') : 'The three busiest painters'}</h2>
                {!parseMultiValue(appliedReviewFilters.painters).length && <span>Tick names in the Painter picker to see only them.</span>}
              </div>
              <div className="aph-rv-painter-cards">
                {painterCards.map((item) => <PainterReviewCard key={item.painter} painter={item} />)}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function PainterReviewCard({ painter }: { painter: EntryReviewPainterReportRow }) {
  const byLayer = painter.layerBreakdown || [];
  const byDay = painter.dayBreakdown || [];
  const maxArea = Math.max(1, ...byLayer.map((item) => item.area));

  return (
    <div className="aph-rv-painter-card">
      <div className="aph-rv-painter-head">
        <h3>{painter.painter}</h3>
        <div>
          <span><b>{formatNumber(painter.daysOnSite)}</b> days</span>
          <span><b>{formatNumber(painter.area)}</b> sqft</span>
          {painter.workingHours > 0 && <span><b>{formatDecimal(painter.workingHours, 1)}</b> hours</span>}
          <span><b>{formatDecimal(painter.labourDays, 1)}</b> labour days</span>
          <span><b>{formatNumber(painter.productivity)}</b> sqft/day</span>
          <span><b>{formatNumber(painter.layers)}</b> layers</span>
          <span><b>{formatNumber(painter.flats)}</b> flats</span>
        </div>
      </div>
      <div className="aph-rv-painter-grid">
        <div>
          <h4>By work layer</h4>
          <div className="aph-table-scroll aph-rv-mini-scroll">
            <table>
              <thead><tr><th className="text-left">Layer</th><th className="text-right">Area</th><th className="text-right">Labour days</th><th className="text-right">Sqft / day</th><th className="text-right">Flats</th><th className="text-right">Entries</th></tr></thead>
              <tbody>
                {byLayer.length ? byLayer.map((item) => (
                  <tr key={item.workLayer}>
                    <td className="text-left aph-rv-layer-bar-cell"><span style={{ width: `${(item.area / maxArea) * 100}%` }} /><b>{item.workLayer}</b></td>
                    <td className="text-right">{formatNumber(item.area)}</td>
                    <td className="text-right">{formatDecimal(item.labourDays, 1)}</td>
                    <td className="text-right">{item.labourDays > 0 ? formatNumber(item.area / item.labourDays) : '—'}</td>
                    <td className="text-right">{item.flats}</td>
                    <td className="text-right">{item.entries}</td>
                  </tr>
                )) : <tr><td colSpan={6} className="text-left aph-rv-dim">No layer detail found for this painter.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h4>Day by day</h4>
          <div className="aph-table-scroll aph-rv-mini-scroll">
            <table>
              <thead><tr><th className="text-left">Date</th><th className="text-right">Entries</th><th className="text-right">Flats</th><th className="text-right">Layers</th><th className="text-right">Area</th><th className="text-right">Hours</th><th className="text-right">Sqft / day</th></tr></thead>
              <tbody>
                {byDay.length ? byDay.map((item) => (
                  <tr key={item.workDate}>
                    <td className="text-left">{reviewDateLabel(item.workDate)}</td>
                    <td className="text-right">{item.entries}</td>
                    <td className="text-right">{item.flats}</td>
                    <td className="text-right">{item.layers}</td>
                    <td className="text-right">{formatNumber(item.area)}</td>
                    <td className="text-right">{item.workingHours > 0 ? formatDecimal(item.workingHours, 1) : '—'}</td>
                    <td className="text-right">{item.labourDays > 0 ? formatNumber(item.area / item.labourDays) : '—'}</td>
                  </tr>
                )) : <tr><td colSpan={7} className="text-left aph-rv-dim">No day detail found for this painter.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

type ReportRangeMode = 'today' | 'yday' | 'week' | 'lweek' | 'month' | 'custom';

type ReportWindow = {
  from: string;
  to: string;
  label: string;
};

type ReportPlausibilityBand = 'badLow' | 'watchLow' | 'ok' | 'watchHigh' | 'badHigh';
type ReportPlausibilityLevel = 'bad' | 'watch' | 'ok' | 'none';

type ReportDimensionGrade = {
  band: ReportPlausibilityBand | null;
  actual: number;
  target: number;
  ratio: number | null;
  why: string;
};

type ReportPlausibility = {
  level: ReportPlausibilityLevel;
  reasons: string[];
  productivity: ReportDimensionGrade;
  coverage: ReportDimensionGrade;
};

type ReportGroup = {
  key: string;
  label: string;
  entries: number;
  area: number;
  labourDays: number;
  measuredArea: number;
  measuredDays: number;
  hours: number;
  revenue: number;
  cost: number;
  targetDays: number;
  productivity: number;
  targetProductivity: number;
};

const REPORT_DAY_MS = 86_400_000;
const REPORT_RANGE_BUTTONS: Array<{ id: ReportRangeMode; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
  { id: 'lweek', label: 'Last week' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom range' },
];

function reportNormalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function reportPainters(value: string) {
  return String(value || '')
    .split(/\s*(?:,|;|\||\/|&)\s*|\s+and\s+/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function reportIsoFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function reportDateFromIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function reportShiftIso(value: string, days: number) {
  const date = reportDateFromIso(value);
  if (!date) return value;
  date.setDate(date.getDate() + days);
  return reportIsoFromDate(date);
}

function reportLongDate(value: string) {
  const date = reportDateFromIso(value);
  if (!date) return value || 'No date';
  return date.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function reportShortDate(value: string) {
  const date = reportDateFromIso(value);
  if (!date) return value || '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function reportWindow(mode: ReportRangeMode, customFrom: string, customTo: string): ReportWindow {
  const todayDate = new Date();
  const today = reportIsoFromDate(todayDate);

  if (mode === 'today') {
    return { from: today, to: today, label: `Today · ${reportLongDate(today)}` };
  }

  if (mode === 'yday') {
    const day = reportShiftIso(today, -1);
    return { from: day, to: day, label: `Yesterday · ${reportLongDate(day)}` };
  }

  if (mode === 'week') {
    const date = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
    const dow = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - dow);
    const from = reportIsoFromDate(date);
    return { from, to: today, label: `This week · ${reportLongDate(from)} to ${reportLongDate(today)}` };
  }

  if (mode === 'lweek') {
    const date = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
    const dow = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - dow - 1);
    const to = reportIsoFromDate(date);
    date.setDate(date.getDate() - 6);
    const from = reportIsoFromDate(date);
    return { from, to, label: `Last week · ${reportLongDate(from)} to ${reportLongDate(to)}` };
  }

  if (mode === 'month') {
    const from = reportIsoFromDate(new Date(todayDate.getFullYear(), todayDate.getMonth(), 1));
    return { from, to: today, label: `This month · ${reportLongDate(from)} to ${reportLongDate(today)}` };
  }

  return {
    from: customFrom,
    to: customTo,
    label: `Custom · ${customFrom ? reportLongDate(customFrom) : 'earliest'} to ${customTo ? reportLongDate(customTo) : 'latest'}`,
  };
}

function reportPreviousWindow(windowValue: ReportWindow): ReportWindow | null {
  const from = reportDateFromIso(windowValue.from);
  const to = reportDateFromIso(windowValue.to);
  if (!from || !to) return null;
  const spanDays = Math.round((to.getTime() - from.getTime()) / REPORT_DAY_MS) + 1;
  const previousTo = reportShiftIso(windowValue.from, -1);
  const previousFrom = reportShiftIso(previousTo, -(spanDays - 1));
  return { from: previousFrom, to: previousTo, label: `${reportLongDate(previousFrom)} to ${reportLongDate(previousTo)}` };
}

function reportInWindow(row: AnalyticsReportRow, windowValue: ReportWindow) {
  if (!row.workDate) return false;
  if (windowValue.from && row.workDate < windowValue.from) return false;
  if (windowValue.to && row.workDate > windowValue.to) return false;
  return true;
}

function reportBand(actual: number, target: number, kind: 'prod' | 'cov'): ReportDimensionGrade {
  if (!(actual > 0)) {
    return {
      band: null,
      actual,
      target,
      ratio: null,
      why: kind === 'prod' ? 'No area or no labour on this entry' : 'No area or no quantity on this entry',
    };
  }
  if (!(target > 0)) {
    return {
      band: null,
      actual,
      target,
      ratio: null,
      why: `No target ${kind === 'prod' ? 'rate' : 'coverage'} for this work`,
    };
  }
  const ratio = actual / target;
  const band: ReportPlausibilityBand =
    ratio < 0.5 ? 'badLow' :
    ratio < 0.8 ? 'watchLow' :
    ratio <= 1.2 ? 'ok' :
    ratio <= 1.5 ? 'watchHigh' : 'badHigh';
  return { band, actual, target, ratio, why: '' };
}

function reportPlausibility(row: AnalyticsReportRow): ReportPlausibility {
  const reasons: string[] = [];
  let level: ReportPlausibilityLevel = 'ok';
  const bump = (next: ReportPlausibilityLevel) => {
    if (next === 'bad') level = 'bad';
    else if (next === 'watch' && level !== 'bad') level = 'watch';
  };

  const productivity = row.area > 0 && row.labourDays > 0 ? row.area / row.labourDays : 0;
  const coverage = row.area > 0 && row.materialUsed > 0 ? row.area / row.materialUsed : 0;

  if (productivity > 4000) { bump('bad'); reasons.push(`${formatNumber(productivity)} sqft in one labour day`); }
  if (productivity > 0 && productivity < 15) { bump('watch'); reasons.push(`only ${formatDecimal(productivity, 1)} sqft per labour day`); }
  if (row.workingHours > 24) { bump('bad'); reasons.push(`${formatDecimal(row.workingHours, 1)} hours in a day`); }
  if (row.labourDays > 30) { bump('bad'); reasons.push(`${formatDecimal(row.labourDays, 1)} labour days on one entry`); }
  if (row.area > 0 && row.labourDays <= 0 && row.labourCost > 0) { bump('watch'); reasons.push('labour cost with no labour days'); }
  if (row.materialUsed > 0 && row.area <= 0) { bump('watch'); reasons.push('material used against no area'); }
  if (row.flatArea > 0 && row.area > row.flatArea * 1.1) {
    bump('watch');
    reasons.push(`${formatNumber(row.area)} booked on a flat measuring ${formatNumber(row.flatArea)}`);
  }

  const p = reportBand(productivity, row.targetProductivity, 'prod');
  const c = reportBand(coverage, row.targetCoverage, 'cov');

  const dimensionLevel = (grade: ReportDimensionGrade) => {
    if (!grade.band || grade.band === 'ok') return grade.band === 'ok' ? 'ok' : 'none';
    return grade.band === 'badLow' || grade.band === 'badHigh' ? 'bad' : 'watch';
  };

  const pLevel = dimensionLevel(p);
  const cLevel = dimensionLevel(c);
  if (pLevel === 'bad' || cLevel === 'bad') bump('bad');
  else if (pLevel === 'watch' || cLevel === 'watch') bump('watch');

  if (p.band && p.band !== 'ok' && p.ratio != null) {
    reasons.push(`productivity ${Math.round(p.ratio * 100)}% of target`);
  }
  if (c.band && c.band !== 'ok' && c.ratio != null) {
    reasons.push(`coverage ${Math.round(c.ratio * 100)}% of target`);
  }

  if (!p.band && !c.band && level === 'ok') level = 'none';
  return { level, reasons, productivity: p, coverage: c };
}

function reportGradeLabel(grade: ReportDimensionGrade) {
  if (!grade.band) return '—';
  if (grade.band === 'badLow') return 'Impossible low';
  if (grade.band === 'watchLow') return 'Doubtful low';
  if (grade.band === 'ok') return 'Normal';
  if (grade.band === 'watchHigh') return 'Doubtful high';
  return 'Impossible high';
}

function reportGradeClass(grade: ReportDimensionGrade) {
  if (!grade.band) return 'aph-report-tag-muted';
  if (grade.band === 'ok') return 'aph-report-tag-good';
  if (grade.band === 'watchLow' || grade.band === 'watchHigh') return 'aph-report-tag-watch';
  return 'aph-report-tag-bad';
}

function ReportPlausibilityCell({ row }: { row: AnalyticsReportRow }) {
  const result = reportPlausibility(row);
  const dimensions = [
    { key: 'Prod', grade: result.productivity },
    { key: 'Cov', grade: result.coverage },
  ];
  return (
    <div className="aph-report-plausibility">
      {dimensions.map(({ key, grade }) => (
        <div key={key} className="aph-report-plausibility-line">
          <span>{key}</span>
          <b className={`aph-report-status ${reportGradeClass(grade)}`} title={grade.why || undefined}>
            {reportGradeLabel(grade)}
            {grade.ratio != null && <small>{Math.round(grade.ratio * 100)}%</small>}
          </b>
        </div>
      ))}
      {result.reasons.length > 0 && <em title={result.reasons.join(' · ')}>{result.reasons[0]}</em>}
    </div>
  );
}

function reportTotals(rows: AnalyticsReportRow[]) {
  let area = 0;
  let labourDays = 0;
  let hours = 0;
  let labourCost = 0;
  let materialCost = 0;
  let revenue = 0;
  let measuredArea = 0;
  let measuredDays = 0;
  let supportDays = 0;
  let billableArea = 0;
  let operationalArea = 0;
  const flats = new Set<string>();
  const applications = new Set<string>();
  const layers = new Set<string>();
  const painters = new Set<string>();
  const dates = new Set<string>();

  rows.forEach((row) => {
    area += row.area;
    labourDays += row.labourDays;
    hours += row.workingHours > 0 ? row.workingHours : 0;
    labourCost += row.labourCost;
    materialCost += row.materialCost;
    revenue += row.revenue;
    if (row.area > 0 && row.labourDays > 0) {
      measuredArea += row.area;
      measuredDays += row.labourDays;
    } else if (row.labourDays > 0) {
      supportDays += row.labourDays;
    }
    if (row.revenue > 0) billableArea += row.area;
    else operationalArea += row.area;
    if (row.flatId) flats.add(`${reportNormalize(row.application)}|${reportNormalize(row.flatId)}`);
    if (row.application) applications.add(row.application);
    if (row.workLayer) layers.add(`${reportNormalize(row.application)}|${reportNormalize(row.workLayer)}`);
    reportPainters(row.painterNames).forEach((painter) => painters.add(reportNormalize(painter)));
    if (row.workDate) dates.add(row.workDate);
  });

  const cost = labourCost + materialCost;
  const profit = revenue - cost;
  return {
    entries: rows.length,
    area,
    labourDays,
    hours,
    labourCost,
    materialCost,
    revenue,
    cost,
    profit,
    productivity: measuredDays > 0 ? measuredArea / measuredDays : 0,
    supportDays,
    billableArea,
    operationalArea,
    flats: flats.size,
    applications: applications.size,
    layers: layers.size,
    painters: painters.size,
    days: dates.size,
  };
}

function reportReviewTotals(rows: AnalyticsReportRow[]) {
  let approved = 0;
  let approvedRevenue = 0;
  let rejected = 0;
  let rejectedRevenue = 0;
  let open = 0;
  let openRevenue = 0;
  rows.forEach((row) => {
    if (row.reviewStatus === 'approved') {
      approved += 1;
      approvedRevenue += row.revenue;
    } else if (row.reviewStatus === 'rejected') {
      rejected += 1;
      rejectedRevenue += row.revenue;
    } else {
      open += 1;
      openRevenue += row.revenue;
    }
  });
  return { approved, approvedRevenue, rejected, rejectedRevenue, open, openRevenue };
}

function reportGroups(
  rows: AnalyticsReportRow[],
  keyFor: (row: AnalyticsReportRow) => string,
  labelFor: (row: AnalyticsReportRow) => string = keyFor,
): ReportGroup[] {
  const map = new Map<string, ReportGroup & { targetSeen: Set<string> }>();
  rows.forEach((row) => {
    const key = keyFor(row);
    if (!key) return;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        label: labelFor(row),
        entries: 0,
        area: 0,
        labourDays: 0,
        measuredArea: 0,
        measuredDays: 0,
        hours: 0,
        revenue: 0,
        cost: 0,
        targetDays: 0,
        productivity: 0,
        targetProductivity: 0,
        targetSeen: new Set<string>(),
      };
      map.set(key, group);
    }
    group.entries += 1;
    group.area += row.area;
    group.labourDays += row.labourDays;
    group.hours += row.workingHours > 0 ? row.workingHours : 0;
    group.revenue += row.revenue;
    group.cost += row.labourCost + row.materialCost;
    if (row.area > 0 && row.labourDays > 0) {
      group.measuredArea += row.area;
      group.measuredDays += row.labourDays;
    }
    const targetKey = `${reportNormalize(row.application)}|${reportNormalize(row.flatId)}|${reportNormalize(row.workLayer)}`;
    if (row.targetDays > 0 && !group.targetSeen.has(targetKey)) {
      group.targetSeen.add(targetKey);
      group.targetDays += row.targetDays;
    }
  });

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      productivity: group.measuredDays > 0 ? group.measuredArea / group.measuredDays : 0,
      targetProductivity: group.targetDays > 0 ? group.area / group.targetDays : 0,
    }))
    .sort((a, b) => b.area - a.area || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

function reportMoney3(value: number) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
}

function reportQuantity(value: number) {
  const n = Number(value) || 0;
  if (!n) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function reportKpiDelta(current: number, previous: number | null, kind: 'number' | 'area' | 'days' | 'money') {
  if (previous == null) return 'no comparable period';
  if (!previous && !current) return '—';
  const delta = current - previous;
  const pct = previous > 0 ? (delta * 100) / previous : null;
  const prefix = delta > 0 ? '+' : '';
  const formatted = kind === 'money'
    ? formatCurrency(delta)
    : kind === 'days'
      ? `${formatDecimal(delta, 1)} days`
      : kind === 'area'
        ? `${formatNumber(delta)} sqft`
        : formatNumber(delta);
  return `${prefix}${formatted}${pct == null ? '' : ` (${pct > 0 ? '+' : ''}${formatDecimal(pct, 1)}%)`}`;
}

function ReportSectionHeading({ title, hint }: { title: string; hint: ReactNode }) {
  return (
    <div className="aph-report-section-heading">
      <h2>{title}</h2>
      <span>{hint}</span>
    </div>
  );
}

function ReportKpiGrid({ items }: { items: Array<{ label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' }> }) {
  return (
    <div className="aph-report-kpis">
      {items.map((item, index) => (
        <div key={index} className="aph-report-kpi">
          <span>{item.label}</span>
          <strong className={item.tone === 'good' ? 'aph-report-positive' : item.tone === 'bad' ? 'aph-report-negative' : ''}>{item.value}</strong>
          <small>{item.sub || '\u00a0'}</small>
        </div>
      ))}
    </div>
  );
}

function ReportStatus({ row }: { row: AnalyticsReportRow }) {
  const commented = Boolean(row.reviewComment?.trim());
  return (
    <div className="aph-report-check-state">
      {row.reviewStatus === 'approved' ? (
        <span className="aph-report-status aph-report-tag-good">Approved</span>
      ) : row.reviewStatus === 'rejected' ? (
        <span className="aph-report-status aph-report-tag-bad">Rejected</span>
      ) : commented ? (
        <span className="aph-report-status aph-report-tag-watch">Commented</span>
      ) : (
        <span className="aph-report-status aph-report-tag-muted">Open</span>
      )}
      {row.revenue > 0 && <span className="aph-report-status aph-report-tag-info">Billable</span>}
      {commented && <small title={row.reviewComment}>{row.reviewComment}</small>}
    </div>
  );
}

function ReportDeviation({ actual, target, unit }: { actual: number; target: number; unit: string }) {
  if (!(actual > 0)) return <span className="aph-report-dim">—</span>;
  const delta = target > 0 ? ((actual - target) * 100) / target : null;
  return (
    <span className="aph-report-measure">
      {formatDecimal(actual, actual >= 100 ? 0 : 1)}
      {unit && <small>{unit}</small>}
      {delta == null ? (
        <em>no baseline</em>
      ) : (
        <em className={Math.abs(delta) <= 20 ? '' : delta >= 0 ? 'aph-report-positive' : 'aph-report-negative'}>
          {delta >= 0 ? '+' : ''}{formatDecimal(delta, 0)}% <i>vs {formatDecimal(target, target >= 100 ? 0 : 1)}</i>
        </em>
      )}
    </span>
  );
}

function ReportTableExportButton({ tableId, filename }: { tableId: string; filename: string }) {
  return (
    <button
      type="button"
      className="aph-report-mini"
      onClick={() => {
        const table = document.getElementById(tableId) as HTMLTableElement | null;
        if (!table) return;
        downloadCsvText(filename, tableToCsv(table));
      }}
    >
      Export CSV
    </button>
  );
}

function ReportProductivityTable({ id, title, label, groups, note }: { id: string; title: string; label: string; groups: ReportGroup[]; note?: ReactNode }) {
  if (!groups.length) return null;
  return (
    <div className="aph-report-card">
      <div className="aph-report-card-head">
        <h3>{title}</h3>
        {note && <span>{note}</span>}
        <ReportTableExportButton tableId={id} filename={`${slugForFileName(title)}.csv`} />
      </div>
      <div className="aph-table-scroll aph-report-table-scroll">
        <table id={id}>
          <thead><tr><th>{label}</th><th>Entries</th><th>Area (sqft)</th><th>Labour days</th><th>Actual sqft/labour-day</th><th>Target sqft/labour-day</th><th>vs target</th></tr></thead>
          <tbody>
            {groups.map((group) => {
              const vs = group.productivity > 0 && group.targetProductivity > 0 ? (group.productivity * 100) / group.targetProductivity : null;
              return (
                <tr key={group.key}>
                  <td>{group.label}</td>
                  <td>{formatNumber(group.entries)}</td>
                  <td>{group.area > 0 ? formatNumber(group.area) : '—'}</td>
                  <td>{group.labourDays > 0 ? formatDecimal(group.labourDays, 1) : '—'}</td>
                  <td>{group.productivity > 0 ? formatDecimal(group.productivity, group.productivity >= 100 ? 0 : 1) : '—'}</td>
                  <td>{group.targetProductivity > 0 ? formatDecimal(group.targetProductivity, group.targetProductivity >= 100 ? 0 : 1) : '—'}</td>
                  <td className={vs == null ? '' : vs >= 100 ? 'aph-report-positive' : vs < 80 ? 'aph-report-negative' : ''}>{vs == null ? '—' : `${formatDecimal(vs, 0)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnalyticsReportTab({
  token,
  projectId,
  projectName,
  filters,
  refreshVersion,
}: {
  token: string;
  projectId: string;
  projectName: string;
  filters: ExecutiveSummaryFilters;
  refreshVersion: number;
}) {
  const [data, setData] = useState<AnalyticsReportResponse>({ recordCount: 0, rows: [] });
  const [loadingReport, setLoadingReport] = useState(true);
  const [reportError, setReportError] = useState('');
  const [rangeMode, setRangeMode] = useState<ReportRangeMode>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [painterFilter, setPainterFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [entryCap, setEntryCap] = useState(300);
  const [openReportFilter, setOpenReportFilter] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!token || !projectId) return;
    const requestId = ++requestRef.current;
    setLoadingReport(true);
    setReportError('');
    fetchAnalyticsReport(token, projectId, filters)
      .then((response) => {
        if (requestId !== requestRef.current) return;
        setData(response);
        setCollapsedDays(new Set());
        setEntryCap(300);
      })
      .catch((error) => {
        if (requestId !== requestRef.current) return;
        setReportError(error instanceof Error ? error.message : 'Failed to load report');
      })
      .finally(() => {
        if (requestId === requestRef.current) setLoadingReport(false);
      });
  }, [filters, projectId, refreshVersion, token]);

  const windowValue = useMemo(() => reportWindow(rangeMode, customFrom, customTo), [customFrom, customTo, rangeMode]);
  const previousWindow = useMemo(() => reportPreviousWindow(windowValue), [windowValue]);

  const painterOptions = useMemo(() => {
    const map = new Map<string, string>();
    data.rows.forEach((row) => reportPainters(row.painterNames).forEach((painter) => {
      const key = reportNormalize(painter);
      if (key && !map.has(key)) map.set(key, painter);
    }));
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((item) => ({ label: item, value: item }));
  }, [data.rows]);

  const statusOptions = useMemo(() => {
    const values = Array.from(new Set(data.rows.map((row) => row.workStatus).filter(Boolean))).sort();
    return values.map((item) => ({ label: item, value: item }));
  }, [data.rows]);

  const currentRows = useMemo(() => {
    const painters = new Set(parseMultiValue(painterFilter).map(reportNormalize));
    const statuses = new Set(parseMultiValue(statusFilter).map(reportNormalize));
    const q = search.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (!reportInWindow(row, windowValue)) return false;
      if (painters.size) {
        const names = reportPainters(row.painterNames).map(reportNormalize);
        if (!names.some((name) => painters.has(name))) return false;
      }
      if (statuses.size && !statuses.has(reportNormalize(row.workStatus))) return false;
      if (q) {
        const haystack = `${row.flatId} ${row.workLayer} ${row.application} ${row.painterNames} ${row.materialName} ${row.remark}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [data.rows, painterFilter, search, statusFilter, windowValue]);

  // Netlify compares with the same global scope immediately before the period;
  // its local Report painter/status/search controls do not alter that benchmark.
  const previousRows = useMemo(
    () => previousWindow ? data.rows.filter((row) => reportInWindow(row, previousWindow)) : [],
    [data.rows, previousWindow],
  );

  const totals = useMemo(() => reportTotals(currentRows), [currentRows]);
  const previousTotals = useMemo(() => previousRows.length ? reportTotals(previousRows) : null, [previousRows]);
  const reviewTotals = useMemo(() => reportReviewTotals(currentRows), [currentRows]);

  const dayGroups = useMemo(() => {
    const map = new Map<string, AnalyticsReportRow[]>();
    currentRows.forEach((row) => {
      if (!row.workDate) return;
      const rows = map.get(row.workDate) || [];
      rows.push(row);
      map.set(row.workDate, rows);
    });
    return Array.from(map.entries())
      .map(([date, rows]) => ({ date, rows }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [currentRows]);

  const visibleDayGroups = useMemo(() => {
    let painted = 0;
    return dayGroups.map((group) => {
      const collapsed = collapsedDays.has(group.date);
      const showRows = !collapsed && painted < entryCap;
      if (showRows) painted += group.rows.length;
      return { ...group, collapsed, showRows };
    });
  }, [collapsedDays, dayGroups, entryCap]);

  const paintedRows = visibleDayGroups.reduce((sum, group) => sum + (group.showRows ? group.rows.length : 0), 0);
  const hiddenRows = Math.max(0, currentRows.length - paintedRows);

  const globalScopeText = useMemo(() => {
    const parts: string[] = [];
    if (filters.block) parts.push(`Block: ${multiValueLabel(filters.block)}`);
    if (filters.application) parts.push(`Application: ${multiValueLabel(filters.application)}`);
    if (filters.flat) parts.push(`Flat: ${multiValueLabel(filters.flat)}`);
    if (filters.workLayer) parts.push(`Work layer: ${multiValueLabel(filters.workLayer)}`);
    if (filters.from || filters.to) parts.push(`Global date filter: ${filters.from || 'earliest'} to ${filters.to || 'latest'}`);
    if (filters.billing && filters.billing !== 'all') parts.push(`Billing: ${filters.billing === 'billable' ? 'billable only' : 'non-billable only'}`);
    if (filters.profitability && filters.profitability !== 'all') parts.push(`Profitability: ${multiValueLabel(filters.profitability)}`);
    return parts.join(' · ');
  }, [filters]);

  const productivityByDay = useMemo(() => reportGroups(currentRows, (row) => row.workDate, (row) => reportShortDate(row.workDate)).sort((a, b) => b.key.localeCompare(a.key)), [currentRows]);
  const productivityByBlock = useMemo(() => reportGroups(currentRows, (row) => row.block), [currentRows]);
  const productivityByApplication = useMemo(() => reportGroups(currentRows, (row) => row.application), [currentRows]);
  const productivityByLayer = useMemo(() => reportGroups(currentRows, (row) => row.workLayer), [currentRows]);

  const painterGroups = useMemo(() => {
    const map = new Map<string, ReportGroup>();
    currentRows.forEach((row) => {
      const painters = reportPainters(row.painterNames);
      if (!painters.length) return;
      const share = 1 / painters.length;
      painters.forEach((painter) => {
        const key = reportNormalize(painter);
        const current = map.get(key) || {
          key,
          label: painter,
          entries: 0,
          area: 0,
          labourDays: 0,
          measuredArea: 0,
          measuredDays: 0,
          hours: 0,
          revenue: 0,
          cost: 0,
          targetDays: 0,
          productivity: 0,
          targetProductivity: 0,
        };
        current.entries += 1;
        current.area += row.area * share;
        current.labourDays += row.labourDays * share;
        current.hours += row.workingHours > 0 ? row.workingHours : 0;
        if (row.area > 0 && row.labourDays > 0) {
          current.measuredArea += row.area * share;
          current.measuredDays += row.labourDays * share;
        }
        current.productivity = current.measuredDays > 0 ? current.measuredArea / current.measuredDays : 0;
        map.set(key, current);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.area - a.area || a.label.localeCompare(b.label));
  }, [currentRows]);

  const materialRows = useMemo(() => {
    const map = new Map<string, {
      key: string; name: string; entries: number; area: number; quantity: number; hasQuantity: boolean; cost: number; targetCoverage: number; targetRate: number;
    }>();
    currentRows.forEach((row) => {
      if (!row.materialName) return;
      const key = reportNormalize(row.materialName);
      const current = map.get(key) || { key, name: row.materialName, entries: 0, area: 0, quantity: 0, hasQuantity: false, cost: 0, targetCoverage: 0, targetRate: 0 };
      current.entries += 1;
      current.area += row.area;
      current.cost += row.materialCost;
      if (row.materialUsed > 0) { current.quantity += row.materialUsed; current.hasQuantity = true; }
      if (!(current.targetCoverage > 0) && row.targetCoverage > 0) current.targetCoverage = row.targetCoverage;
      if (!(current.targetRate > 0) && row.materialRate > 0) current.targetRate = row.materialRate;
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
  }, [currentRows]);

  const applicationMaterialRows = useMemo(() => {
    const map = new Map<string, { key: string; application: string; material: string; area: number; quantity: number; hasQuantity: boolean; cost: number }>();
    currentRows.forEach((row) => {
      if (!row.materialName) return;
      const key = `${reportNormalize(row.application)}|${reportNormalize(row.materialName)}`;
      const current = map.get(key) || { key, application: row.application, material: row.materialName, area: 0, quantity: 0, hasQuantity: false, cost: 0 };
      current.area += row.area;
      current.cost += row.materialCost;
      if (row.materialUsed > 0) { current.quantity += row.materialUsed; current.hasQuantity = true; }
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost).slice(0, 40);
  }, [currentRows]);

  const profitabilityByApplication = useMemo(() => reportGroups(currentRows, (row) => row.application).filter((group) => group.revenue > 0 || group.cost > 0).sort((a, b) => b.revenue - a.revenue), [currentRows]);

  const alerts = useMemo(() => {
    const result: Array<{ level: 'critical' | 'watch'; title: string; detail: string; where: string }> = [];
    const push = (level: 'critical' | 'watch', title: string, detail: string, where: string) => result.push({ level, title, detail, where });

    if (reviewTotals.open) push('watch', 'Work awaiting approval', `${formatNumber(reviewTotals.open)} ${reviewTotals.open === 1 ? 'entry has' : 'entries have'} not been approved or rejected${reviewTotals.openRevenue > 0 ? `, carrying ${formatCurrency(reviewTotals.openRevenue)} of work value` : ''}.`, 'Entry review → Entry log');
    if (reviewTotals.approvedRevenue > 0) push('watch', 'Approved work not yet billable from this source', `${formatCurrency(reviewTotals.approvedRevenue)} of approved work value. Analytics has no invoice record in this report, so whether it has been billed cannot be checked here.`, 'Billing system');

    const impossible = currentRows.filter((row) => reportPlausibility(row).level === 'bad');
    const doubtful = currentRows.filter((row) => reportPlausibility(row).level === 'watch');
    if (impossible.length) push('critical', 'Entries that cannot be right', `${formatNumber(impossible.length)} ${impossible.length === 1 ? 'entry is' : 'entries are'} graded impossible against the target rates.`, 'Entry review');
    if (doubtful.length) push('watch', 'Entries worth a second look', `${formatNumber(doubtful.length)} ${doubtful.length === 1 ? 'entry sits' : 'entries sit'} far enough from the target rate to be doubtful.`, 'Entry review');

    const noArea = currentRows.filter((row) => !(row.area > 0));
    if (noArea.length) push('watch', 'Missing work measurement', `${formatNumber(noArea.length)} ${noArea.length === 1 ? 'entry carries' : 'entries carry'} no area, so they add nothing to productivity or coverage.`, 'Work entry');
    const noLabour = currentRows.filter((row) => row.area > 0 && !(row.labourDays > 0));
    if (noLabour.length) push('watch', 'Missing labour', `${formatNumber(noLabour.length)} ${noLabour.length === 1 ? 'entry has' : 'entries have'} area but no labour days; productivity cannot be measured.`, 'Work entry');
    const noCost = currentRows.filter((row) => row.area > 0 && !(row.labourCost > 0) && !(row.materialCost > 0));
    if (noCost.length) push('watch', 'Missing cost', `${formatNumber(noCost.length)} ${noCost.length === 1 ? 'entry carries' : 'entries carry'} work but neither labour nor material cost.`, 'Work entry');
    const materialNoQty = currentRows.filter((row) => row.materialCost > 0 && !(row.materialUsed > 0));
    if (materialNoQty.length) push('watch', 'Material cost without a quantity', `${formatNumber(materialNoQty.length)} ${materialNoQty.length === 1 ? 'entry books' : 'entries book'} material cost with no quantity, so coverage cannot be checked.`, 'Work entry');

    productivityByLayer.forEach((group) => {
      if (!(group.productivity > 0) || !(group.targetProductivity > 0)) return;
      const vs = (group.productivity * 100) / group.targetProductivity;
      if (vs < 70) push('critical', `Low productivity — ${group.label}`, `${formatDecimal(group.productivity, 1)} sqft per labour day against ${formatDecimal(group.targetProductivity, 1)} (${formatDecimal(vs, 0)}% of target) over ${formatNumber(group.area)} sqft.`, `${formatNumber(group.entries)} entries in this period`);
      else if (vs < 85) push('watch', `Below target — ${group.label}`, `${formatDecimal(group.productivity, 1)} against ${formatDecimal(group.targetProductivity, 1)} sqft per labour day (${formatDecimal(vs, 0)}%).`, `${formatNumber(group.entries)} entries`);
    });

    materialRows.forEach((material) => {
      if (!(material.targetCoverage > 0) || !(material.quantity > 0) || !(material.area > 0)) return;
      const actual = material.area / material.quantity;
      const ratio = actual / material.targetCoverage;
      if (ratio < 0.75) {
        const expected = material.area / material.targetCoverage;
        const over = material.quantity - expected;
        push(ratio < 0.6 ? 'critical' : 'watch', `Material above standard — ${material.name}`, `${reportQuantity(material.quantity)} used where the coverage standard allows ${reportQuantity(expected)} for ${formatNumber(material.area)} sqft — ${reportQuantity(over)} more than standard.`, 'Material section above');
      }
    });

    const flatGroups = reportGroups(currentRows, (row) => `${reportNormalize(row.application)}|${reportNormalize(row.flatId)}`, (row) => `${row.application} · ${row.flatId}`)
      .filter((group) => group.revenue > 0 && group.cost - group.revenue > Math.max(1000, group.revenue * 0.1))
      .sort((a, b) => (a.revenue - a.cost) - (b.revenue - b.cost));
    flatGroups.slice(0, 5).forEach((group) => push('watch', `Cost above value — ${group.label}`, `${formatCurrency(group.cost)} of labour and material against ${formatCurrency(group.revenue)} of work value in this period.`, `${formatNumber(group.entries)} entries`));
    if (flatGroups.length > 5) {
      const rest = flatGroups.slice(5);
      push('watch', `${rest.length} more flats costing more than their value`, `Together ${formatCurrency(rest.reduce((sum, group) => sum + group.cost, 0))} of labour and material against ${formatCurrency(rest.reduce((sum, group) => sum + group.revenue, 0))} of work value.`, 'Flat-wise analysis');
    }
    return result;
  }, [currentRows, materialRows, productivityByLayer, reviewTotals]);

  function exportFullReport() {
    const lines: CsvCell[][] = [];
    lines.push(['Zobocon — Report']);
    lines.push(['Period', windowValue.label]);
    lines.push(['Project', projectName || projectId]);
    lines.push(['Generated', new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC']);
    if (painterFilter) lines.push(['Painter', multiValueLabel(painterFilter)]);
    if (statusFilter) lines.push(['Work status', multiValueLabel(statusFilter)]);
    if (search) lines.push(['Search', search]);
    lines.push([]);
    lines.push(['Work status','Plausibility','Productivity plausibility','Coverage plausibility','Check status','Checked by','Date','Entry id','Site','Block','Application','Flat','Layer','Area sqft','Painters','Hours','Labour days','Productivity sqft per labour day','Target productivity','Productivity vs target %','Material name','Material used','Material unit cost','Coverage sqft per unit','Target coverage','Coverage vs target %','Material cost','Labour cost','Work value']);
    currentRows.forEach((row) => {
      const plausibility = reportPlausibility(row);
      const productivity = row.area > 0 && row.labourDays > 0 ? row.area / row.labourDays : 0;
      const coverage = row.area > 0 && row.materialUsed > 0 ? row.area / row.materialUsed : 0;
      lines.push([
        row.workStatus,
        plausibility.level === 'bad' ? 'Impossible' : plausibility.level === 'watch' ? 'Doubtful' : plausibility.level === 'ok' ? 'Plausible' : 'No baseline',
        reportGradeLabel(plausibility.productivity),
        reportGradeLabel(plausibility.coverage),
        row.reviewStatus || (row.reviewComment ? 'commented' : 'open'),
        row.reviewedBy,
        row.workDate,
        row.id,
        projectName || projectId,
        row.block,
        row.application,
        row.flatId,
        row.workLayer,
        row.area,
        row.painterNames,
        row.workingHours,
        row.labourDays,
        productivity,
        row.targetProductivity,
        productivity > 0 && row.targetProductivity > 0 ? (productivity * 100) / row.targetProductivity : '',
        row.materialName,
        row.materialUsed,
        row.materialRate,
        coverage,
        row.targetCoverage,
        coverage > 0 && row.targetCoverage > 0 ? (coverage * 100) / row.targetCoverage : '',
        row.materialCost,
        row.labourCost,
        row.revenue,
      ]);
    });
    lines.push([]);
    lines.push(['Period summary']);
    lines.push(['Work entries', totals.entries]);
    lines.push(['Area completed (sqft)', totals.area || 'not recorded']);
    lines.push(['Flats', totals.flats, 'Applications', totals.applications]);
    lines.push(['Labour days', totals.labourDays || 'not recorded']);
    lines.push(['Working hours', totals.hours || 'not recorded']);
    lines.push(['Productivity (sqft per labour day, measured work only)', totals.productivity || 'not measurable']);
    lines.push(['Work value completed', totals.revenue || 'not recorded']);
    lines.push(['Material cost', totals.materialCost || 'not recorded']);
    lines.push(['Labour cost', totals.labourCost || 'not recorded']);
    lines.push(['Gross profit (operational estimate)', totals.revenue > 0 ? totals.profit : 'not measurable']);
    lines.push(['Work value billed', 'not in this source']);
    lines.push(['Cash collected', 'not in this source']);
    const csv = lines.map((row) => row.map(csvEscape).join(',')).join('\r\n');
    downloadCsvText(`zobocon-report_${windowValue.from || 'start'}_${windowValue.to || 'end'}.csv`, csv);
  }

  if (loadingReport) {
    return <div className="aph-skeleton-card" aria-label="Loading report"><span /><span /><span /></div>;
  }

  if (reportError) {
    return <div className="aph-alert aph-alert-error">{reportError}</div>;
  }

  const latestDate = data.rows.map((row) => row.workDate).filter(Boolean).sort().at(-1) || '';
  const previous = previousTotals;

  const dayColumns = {
    id: currentRows.some((row) => Boolean(row.id)),
    block: currentRows.some((row) => Boolean(row.block)),
    painter: currentRows.some((row) => reportPainters(row.painterNames).length > 0),
    hours: currentRows.some((row) => row.workingHours > 0),
    productivity: currentRows.some((row) => row.area > 0 && row.labourDays > 0),
    coverage: currentRows.some((row) => row.area > 0 && row.materialUsed > 0),
    material: currentRows.some((row) => Boolean(row.materialName)),
    materialUsed: currentRows.some((row) => row.materialUsed > 0),
    materialCost: currentRows.some((row) => row.materialCost > 0),
    labourCost: currentRows.some((row) => row.labourCost > 0),
    revenue: currentRows.some((row) => row.revenue > 0),
  };

  const activeDayColumnCount = 9 + [dayColumns.id, dayColumns.block, dayColumns.painter, dayColumns.hours, dayColumns.productivity, dayColumns.coverage, dayColumns.material, dayColumns.materialUsed, dayColumns.materialCost, dayColumns.labourCost, dayColumns.revenue].filter(Boolean).length;

  return (
    <div className="aph-report">
      <div className="aph-report-toolbar">
        <div className="aph-report-ranges">
          {REPORT_RANGE_BUTTONS.map((range) => (
            <button key={range.id} type="button" className={rangeMode === range.id ? 'active' : ''} onClick={() => { setRangeMode(range.id); setEntryCap(300); }}>
              {range.label}
            </button>
          ))}
        </div>
        {rangeMode === 'custom' && (
          <>
            <label><span>From</span><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label>
            <label><span>To</span><input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label>
          </>
        )}
        {painterOptions.length > 0 && (
          <SearchableMultiSelect filterKey="report-painter" label="Painter" value={painterFilter} options={painterOptions} allLabel="All painters" onChange={setPainterFilter} onApply={() => {}} openFilterKey={openReportFilter} setOpenFilterKey={setOpenReportFilter} className="aph-report-local-filter" />
        )}
        {statusOptions.length > 1 && (
          <SearchableMultiSelect filterKey="report-status" label="Work status" value={statusFilter} options={statusOptions} allLabel="All statuses" onChange={setStatusFilter} onApply={() => {}} openFilterKey={openReportFilter} setOpenFilterKey={setOpenReportFilter} className="aph-report-local-filter" />
        )}
        <label className="aph-report-search"><span>Search</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Flat, layer, painter, material" /></label>
        <div className="aph-report-toolbar-spacer" />
        <button type="button" className="aph-report-mini" onClick={() => setCollapsedDays(new Set())}>Expand days</button>
        <button type="button" className="aph-report-mini" onClick={() => setCollapsedDays(new Set(dayGroups.map((group) => group.date)))}>Collapse days</button>
        <button type="button" className="aph-report-mini" onClick={exportFullReport}>Export report</button>
      </div>

      <div className="aph-report-period">
        <b>{windowValue.label}</b>
        <span>{projectName || projectId}</span>
        {globalScopeText && <small>{globalScopeText}</small>}
      </div>

      {!currentRows.length ? (
        <div className="aph-report-card"><div className="aph-report-empty"><b>No work entries in this period.</b><br />{latestDate ? <>The latest entry anywhere in the current Analytics scope is <b>{reportLongDate(latestDate)}</b>. <button type="button" className="aph-report-mini" onClick={() => { setRangeMode('custom'); setCustomFrom(latestDate); setCustomTo(latestDate); }}>Show that day</button></> : 'Nothing is in scope after the current Analytics filters.'}</div></div>
      ) : (
        <>
          <ReportSectionHeading title="Work entries, day by day" hint="Every record in the period, newest day first. Each day closes with a total that is the sum of exactly the rows above it. Click a day heading to collapse it." />
          <div className="aph-report-card">
            <div className="aph-table-scroll aph-report-table-scroll aph-report-day-table-wrap">
              <table className="aph-report-day-table">
                <thead><tr>
                  <th>Work status</th><th>Plausibility</th><th>Check status</th>
                  {dayColumns.id && <th>Entry</th>}<th>Site</th>{dayColumns.block && <th>Block</th>}<th>Application</th><th>Flat</th><th>Layer / activity</th><th>Area (sqft)</th>
                  {dayColumns.painter && <th>Worker / team</th>}{dayColumns.hours && <th>Hours</th>}<th>Labour days</th>{dayColumns.productivity && <th>Productivity</th>}{dayColumns.coverage && <th>Coverage</th>}
                  {dayColumns.material && <th>Material</th>}{dayColumns.materialUsed && <th>Material used</th>}{dayColumns.materialCost && <th>Material cost</th>}{dayColumns.labourCost && <th>Labour cost</th>}{dayColumns.revenue && <th>Work value</th>}
                </tr></thead>
                <tbody>
                  {visibleDayGroups.map((group) => {
                    const groupTotals = reportTotals(group.rows);
                    const groupPainters = new Set(group.rows.flatMap((row) => reportPainters(row.painterNames).map(reportNormalize)));
                    const applications = new Set(group.rows.map((row) => row.application).filter(Boolean));
                    const flats = new Set(group.rows.map((row) => `${reportNormalize(row.application)}|${reportNormalize(row.flatId)}`));
                    const materialNames = new Set(group.rows.map((row) => row.materialName).filter(Boolean));
                    const materialQuantity = materialNames.size === 1 ? group.rows.reduce((sum, row) => sum + row.materialUsed, 0) : 0;
                    return (
                      <Fragment key={group.date}>
                        <tr className="aph-report-day-row" onClick={() => setCollapsedDays((current) => { const next = new Set(current); if (next.has(group.date)) next.delete(group.date); else next.add(group.date); return next; })}>
                          <td colSpan={activeDayColumnCount}>
                            <span className={group.collapsed ? 'aph-report-caret' : 'aph-report-caret open'}>▶</span>
                            <b>{reportLongDate(group.date)}</b>
                            <span className="aph-report-day-chips">
                              <i>{group.rows.length} {group.rows.length === 1 ? 'entry' : 'entries'}</i><i>{flats.size} {flats.size === 1 ? 'flat' : 'flats'}</i><i>{applications.size} {applications.size === 1 ? 'application' : 'applications'}</i><i>{groupTotals.area > 0 ? `${formatNumber(groupTotals.area)} sqft` : 'area not recorded'}</i>{groupPainters.size > 0 && <i>{groupPainters.size} {groupPainters.size === 1 ? 'painter' : 'painters'}</i>}{groupTotals.hours > 0 && <i>{formatDecimal(groupTotals.hours, 1)} h</i>}{groupTotals.labourDays > 0 && <i>{formatDecimal(groupTotals.labourDays, 1)} labour days</i>}{groupTotals.revenue > 0 && <i>{formatCurrency(groupTotals.revenue)} work value</i>}
                            </span>
                          </td>
                        </tr>
                        {group.showRows && group.rows.map((row) => {
                          const productivity = row.area > 0 && row.labourDays > 0 ? row.area / row.labourDays : 0;
                          const coverage = row.area > 0 && row.materialUsed > 0 ? row.area / row.materialUsed : 0;
                          const painters = reportPainters(row.painterNames);
                          return (
                            <tr key={`${group.date}-${row.id}`}>
                              <td><span className={`aph-report-work-status ${reportNormalize(row.workStatus) === 'done' ? 'done' : reportNormalize(row.workStatus) === 'pending' ? 'pending' : ''}`}>{row.workStatus || '—'}</span></td>
                              <td><ReportPlausibilityCell row={row} /></td>
                              <td><ReportStatus row={row} /></td>
                              {dayColumns.id && <td className="aph-report-mono">{row.id || '—'}</td>}
                              <td>{projectName || projectId}</td>
                              {dayColumns.block && <td>{row.block || '—'}</td>}
                              <td>{row.application || '—'}</td><td>{row.flatId || '—'}</td><td>{row.workLayer || '—'}</td><td>{row.area > 0 ? formatNumber(row.area) : '—'}</td>
                              {dayColumns.painter && <td>{painters.length ? <div className="aph-report-workers">{painters.map((painter) => <span key={painter}>{painter}</span>)}</div> : '—'}</td>}
                              {dayColumns.hours && <td>{row.workingHours > 0 ? formatDecimal(row.workingHours, 1) : '—'}</td>}
                              <td>{row.labourDays > 0 ? formatDecimal(row.labourDays, 1) : '—'}</td>
                              {dayColumns.productivity && <td><ReportDeviation actual={productivity} target={row.targetProductivity} unit="sqft/day" /></td>}
                              {dayColumns.coverage && <td><ReportDeviation actual={coverage} target={row.targetCoverage} unit="sqft/unit" /></td>}
                              {dayColumns.material && <td title={row.materialName}>{row.materialName || '—'}</td>}
                              {dayColumns.materialUsed && <td>{row.materialUsed > 0 ? reportQuantity(row.materialUsed) : '—'}</td>}
                              {dayColumns.materialCost && <td>{row.materialCost > 0 ? formatCurrency(row.materialCost) : '—'}</td>}
                              {dayColumns.labourCost && <td>{row.labourCost > 0 ? formatCurrency(row.labourCost) : '—'}</td>}
                              {dayColumns.revenue && <td>{row.revenue > 0 ? formatCurrency(row.revenue) : '—'}</td>}
                            </tr>
                          );
                        })}
                        {group.showRows && (
                          <tr className="aph-report-subtotal"><td colSpan={activeDayColumnCount}>Day total · {group.rows.length} entries · {flats.size} flats · {applications.size} applications · {groupTotals.area > 0 ? `${formatNumber(groupTotals.area)} sqft` : 'area not recorded'} · {groupTotals.labourDays > 0 ? `${formatDecimal(groupTotals.labourDays, 1)} labour days` : 'labour not recorded'}{groupTotals.materialCost > 0 ? ` · ${formatCurrency(groupTotals.materialCost)} material` : ''}{groupTotals.labourCost > 0 ? ` · ${formatCurrency(groupTotals.labourCost)} labour` : ''}{groupTotals.revenue > 0 ? ` · ${formatCurrency(groupTotals.revenue)} work value` : ''}{materialNames.size === 1 && materialQuantity > 0 ? ` · ${Array.from(materialNames)[0]} ${reportQuantity(materialQuantity)}` : ''}</td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {hiddenRows > 0 ? <div className="aph-report-morebar">{formatNumber(paintedRows)} of {formatNumber(currentRows.length)} entries shown — {formatNumber(hiddenRows)} more. <button type="button" className="aph-report-mini" onClick={() => setEntryCap((current) => current + 300)}>Show {formatNumber(Math.min(300, hiddenRows))} more</button><button type="button" className="aph-report-mini" onClick={() => setEntryCap(Number.MAX_SAFE_INTEGER)}>Show all</button></div> : entryCap > 300 && <div className="aph-report-morebar">All {formatNumber(currentRows.length)} entries shown. <button type="button" className="aph-report-mini" onClick={() => setEntryCap(300)}>Back to 300</button></div>}
          </div>

          <ReportSectionHeading title="Period summary" hint={previous ? 'Every figure here is the sum of the entries listed above. The comparison is against the same length of time immediately before this period.' : 'Every figure here is the sum of the entries listed above. No comparable earlier period is available in this data.'} />
          <div className="aph-report-subheading">Operational</div>
          <ReportKpiGrid items={[
            { label: 'Work entries', value: formatNumber(totals.entries), sub: reportKpiDelta(totals.entries, previous?.entries ?? null, 'number') },
            { label: 'Area completed', value: totals.area > 0 ? <>{formatNumber(totals.area)} <small>sqft</small></> : '—', sub: reportKpiDelta(totals.area, previous?.area ?? null, 'area') },
            { label: 'Flats worked on', value: formatNumber(totals.flats), sub: `${totals.applications} application${totals.applications === 1 ? '' : 's'} · ${totals.layers} layer-applications` },
            { label: 'Painters on site', value: totals.painters ? formatNumber(totals.painters) : '—', sub: 'named on these entries' },
            { label: 'Labour days', value: totals.labourDays > 0 ? formatDecimal(totals.labourDays, 1) : '—', sub: reportKpiDelta(totals.labourDays, previous?.labourDays ?? null, 'days') },
            { label: 'Working hours', value: totals.hours > 0 ? formatDecimal(totals.hours, 1) : '—', sub: totals.hours > 0 ? 'as recorded against painters' : 'not recorded' },
            { label: 'Productivity', value: totals.productivity > 0 ? <>{formatDecimal(totals.productivity, totals.productivity >= 100 ? 0 : 1)} <small>sqft/labour-day</small></> : '—', sub: totals.supportDays > 0 ? `${formatDecimal(totals.supportDays, 1)} support days held out` : 'area ÷ labour days, this period' },
            { label: 'Days with work', value: formatNumber(totals.days), sub: 'inside the selected period' },
          ]} />
          <div className="aph-report-subheading">Financial <span>operational figures from work entries, not accounting records</span></div>
          <ReportKpiGrid items={[
            { label: 'Work value completed', value: totals.revenue > 0 ? formatCurrency(totals.revenue) : '—', sub: reportKpiDelta(totals.revenue, previous?.revenue ?? null, 'money') },
            { label: 'Of that, approved', value: reviewTotals.approvedRevenue > 0 ? formatCurrency(reviewTotals.approvedRevenue) : '—', sub: `${reviewTotals.approved} of ${totals.entries} entries approved on Entry review` },
            { label: 'Work value billed', value: '—', sub: 'no invoice data in this source' },
            { label: 'Payments collected', value: '—', sub: 'no receipt data in this source' },
            { label: 'Material cost', value: totals.materialCost > 0 ? formatCurrency(totals.materialCost) : '—', sub: reportKpiDelta(totals.materialCost, previous?.materialCost ?? null, 'money') },
            { label: 'Labour cost', value: totals.labourCost > 0 ? formatCurrency(totals.labourCost) : '—', sub: reportKpiDelta(totals.labourCost, previous?.labourCost ?? null, 'money') },
            { label: <>Gross profit <i>est</i></>, value: totals.revenue > 0 ? formatCurrency(totals.profit) : '—', sub: totals.revenue > 0 ? 'value − labour − material' : 'needs client value', tone: totals.profit > 0 ? 'good' : totals.profit < 0 ? 'bad' : undefined },
            { label: <>Gross margin <i>est</i></>, value: totals.revenue > 0 ? `${formatDecimal((totals.profit * 100) / totals.revenue, 1)}%` : '—', sub: totals.revenue > 0 ? 'of work value completed' : 'needs client value', tone: totals.profit > 0 ? 'good' : totals.profit < 0 ? 'bad' : undefined },
          ]} />

          <ReportSectionHeading title="Productivity" hint={<>Measured as <b>sqft per labour day</b> throughout — area executed divided by labour days booked against it. Target productivity uses the labour days allowed for each flat/layer once.</>} />
          {productivityByDay.length > 0 && <div className="aph-report-card"><div className="aph-report-card-head"><h3>Day by day</h3><ReportTableExportButton tableId="report-prod-day" filename="report-productivity-day-by-day.csv" /></div><div className="aph-table-scroll aph-report-table-scroll"><table id="report-prod-day"><thead><tr><th>Date</th><th>Entries</th><th>Area (sqft)</th><th>Labour days</th><th>Sqft/labour-day</th><th>Work value</th></tr></thead><tbody>{productivityByDay.map((group) => <tr key={group.key}><td>{reportLongDate(group.key)}</td><td>{group.entries}</td><td>{group.area > 0 ? formatNumber(group.area) : '—'}</td><td>{group.labourDays > 0 ? formatDecimal(group.labourDays, 1) : '—'}</td><td>{group.productivity > 0 ? formatDecimal(group.productivity, group.productivity >= 100 ? 0 : 1) : '—'}</td><td>{group.revenue > 0 ? formatCurrency(group.revenue) : '—'}</td></tr>)}</tbody></table></div></div>}
          {productivityByBlock.length > 1 && <ReportProductivityTable id="report-prod-block" title="By block" label="Block" groups={productivityByBlock} />}
          <ReportProductivityTable id="report-prod-app" title="By application" label="Application" groups={productivityByApplication} />
          <ReportProductivityTable id="report-prod-layer" title="By layer / activity" label="Work layer" groups={productivityByLayer} />
          {painterGroups.length > 0 ? <ReportProductivityTable id="report-prod-painter" title="By painter / team" label="Painter" groups={painterGroups} note={currentRows.filter((row) => reportPainters(row.painterNames).length > 1).length ? 'Multi-painter entries split area and labour equally.' : 'Every attributed entry names a single painter.'} /> : <div className="aph-report-card"><div className="aph-report-empty">No painter is named on any entry in this period, so work cannot be attributed to a person or team.</div></div>}

          <ReportSectionHeading title="Material" hint="Consumption booked on the work entries in this period. Quantities are totalled inside one material name only — litres and kilos are never added together." />
          {!materialRows.length ? <div className="aph-report-card"><div className="aph-report-empty">No entry in this period names a material, so consumption cannot be reported.</div></div> : <>
            <div className="aph-report-card"><div className="aph-report-card-head"><h3>By material</h3><span>Coverage is sqft per unit, so a higher number is less material per sqft.</span><ReportTableExportButton tableId="report-material" filename="report-material.csv" /></div><div className="aph-table-scroll aph-report-table-scroll"><table id="report-material"><thead><tr><th>Material</th><th>Entries</th><th>Area (sqft)</th><th>Quantity used</th><th>Unit rate</th><th>Cost</th><th>Target coverage</th><th>Actual coverage</th><th>Expected quantity</th><th>Over / under</th></tr></thead><tbody>{materialRows.map((material) => { const actualCoverage = material.quantity > 0 && material.area > 0 ? material.area / material.quantity : 0; const expected = material.targetCoverage > 0 && material.area > 0 ? material.area / material.targetCoverage : 0; const rate = material.quantity > 0 && material.cost > 0 ? material.cost / material.quantity : material.targetRate; const over = expected > 0 && material.quantity > 0 ? material.quantity - expected : null; return <tr key={material.key}><td title={material.name}>{material.name}</td><td>{material.entries}</td><td>{material.area > 0 ? formatNumber(material.area) : '—'}</td><td>{material.hasQuantity ? reportQuantity(material.quantity) : '—'}</td><td>{rate > 0 ? reportMoney3(rate) : '—'}</td><td>{material.cost > 0 ? formatCurrency(material.cost) : '—'}</td><td>{material.targetCoverage > 0 ? reportQuantity(material.targetCoverage) : '—'}</td><td>{actualCoverage > 0 ? reportQuantity(actualCoverage) : '—'}</td><td>{expected > 0 ? reportQuantity(expected) : '—'}</td><td className={over == null ? '' : over > 0 ? 'aph-report-negative' : 'aph-report-positive'}>{over == null ? '—' : `${over > 0 ? '+' : ''}${reportQuantity(over)}`}</td></tr>; })}</tbody></table></div></div>
            <div className="aph-report-note">{materialRows.filter((material) => !material.hasQuantity).length > 0 && `${materialRows.filter((material) => !material.hasQuantity).length} of ${materialRows.length} materials carry a cost but no quantity, so coverage and excess cannot be measured. `}This report records consumption booked against work. Purchase, goods-receipt, transfer, adjustment and return records are outside this section.</div>
            {applicationMaterialRows.length > 1 && <div className="aph-report-card"><div className="aph-report-card-head"><h3>By application and material</h3><ReportTableExportButton tableId="report-material-app" filename="report-material-by-application.csv" /></div><div className="aph-table-scroll aph-report-table-scroll"><table id="report-material-app"><thead><tr><th>Application</th><th>Material</th><th>Area (sqft)</th><th>Quantity</th><th>Cost</th><th>Actual coverage</th></tr></thead><tbody>{applicationMaterialRows.map((row) => <tr key={row.key}><td>{row.application}</td><td>{row.material}</td><td>{row.area > 0 ? formatNumber(row.area) : '—'}</td><td>{row.hasQuantity ? reportQuantity(row.quantity) : '—'}</td><td>{row.cost > 0 ? formatCurrency(row.cost) : '—'}</td><td>{row.quantity > 0 && row.area > 0 ? reportQuantity(row.area / row.quantity) : '—'}</td></tr>)}</tbody></table></div></div>}
          </>}

          <ReportSectionHeading title="Profitability" hint={<>An <b>operational estimate</b>, not accounting profit. Client value on these work entries less labour and material booked against the same entries.</>} />
          {totals.revenue > 0 ? <>
            <div className="aph-report-card"><div className="aph-report-card-head"><h3>Period result</h3><ReportTableExportButton tableId="report-profit-result" filename="report-profitability-period-result.csv" /></div><div className="aph-table-scroll aph-report-table-scroll"><table id="report-profit-result"><thead><tr><th>Line</th><th>Amount</th><th>Basis</th></tr></thead><tbody>
              <tr><td>Work value completed</td><td>{formatCurrency(totals.revenue)}</td><td>client value on entries in this period</td></tr>
              <tr><td>of which approved</td><td>{reviewTotals.approvedRevenue > 0 ? formatCurrency(reviewTotals.approvedRevenue) : '—'}</td><td>{reviewTotals.approved} entries approved on Entry review</td></tr>
              <tr><td>of which still open</td><td>{reviewTotals.openRevenue > 0 ? formatCurrency(reviewTotals.openRevenue) : '—'}</td><td>{reviewTotals.open} entries not yet approved or rejected</td></tr>
              <tr><td>of which rejected</td><td>{reviewTotals.rejectedRevenue > 0 ? formatCurrency(reviewTotals.rejectedRevenue) : '—'}</td><td>{reviewTotals.rejected} entries rejected on review</td></tr>
              <tr><td>Work value billed</td><td>—</td><td>this source carries no invoice record</td></tr><tr><td>Cash collected</td><td>—</td><td>this source carries no payment record</td></tr>
              <tr><td>Material cost</td><td>{totals.materialCost > 0 ? formatCurrency(totals.materialCost) : '—'}</td><td>booked on the same entries</td></tr><tr><td>Labour cost</td><td>{totals.labourCost > 0 ? formatCurrency(totals.labourCost) : '—'}</td><td>booked on the same entries</td></tr><tr><td>Other direct cost</td><td>—</td><td>not tracked in this report source</td></tr>
              <tr className="aph-report-strong-row"><td>Gross profit (estimate)</td><td className={totals.profit >= 0 ? 'aph-report-positive' : 'aph-report-negative'}>{formatCurrency(totals.profit)}</td><td>work value − labour − material</td></tr><tr className="aph-report-strong-row"><td>Gross margin (estimate)</td><td className={totals.profit >= 0 ? 'aph-report-positive' : 'aph-report-negative'}>{formatDecimal((totals.profit * 100) / totals.revenue, 1)}%</td><td>of work value completed</td></tr>
            </tbody></table></div></div>
            <ReportKpiGrid items={[
              { label: 'Work value per sqft', value: totals.area > 0 ? reportMoney3(totals.revenue / totals.area) : '—', sub: totals.area > 0 ? `over ${formatNumber(totals.area)} sqft` : 'no area recorded' },
              { label: 'Cost per sqft', value: totals.area > 0 ? reportMoney3(totals.cost / totals.area) : '—', sub: 'labour + material' },
              { label: <>Profit per sqft <i>est</i></>, value: totals.area > 0 ? reportMoney3(totals.profit / totals.area) : '—', tone: totals.profit >= 0 ? 'good' : 'bad' },
              { label: 'Billable area', value: totals.billableArea > 0 ? `${formatNumber(totals.billableArea)} sqft` : '—', sub: totals.operationalArea > 0 ? `${formatNumber(totals.operationalArea)} sqft operational, carrying no client value` : 'all area in this period is billable' },
            ]} />
            {profitabilityByApplication.length > 1 && <div className="aph-report-card"><div className="aph-report-card-head"><h3>By application <i>estimate</i></h3><ReportTableExportButton tableId="report-profit-app" filename="report-profitability-by-application.csv" /></div><div className="aph-table-scroll aph-report-table-scroll"><table id="report-profit-app"><thead><tr><th>Application</th><th>Area (sqft)</th><th>Work value</th><th>Cost</th><th>Gross profit</th><th>Margin</th></tr></thead><tbody>{profitabilityByApplication.map((group) => { const profit = group.revenue - group.cost; const margin = group.revenue > 0 ? (profit * 100) / group.revenue : null; return <tr key={group.key}><td>{group.label}</td><td>{group.area > 0 ? formatNumber(group.area) : '—'}</td><td>{group.revenue > 0 ? formatCurrency(group.revenue) : '—'}</td><td>{group.cost > 0 ? formatCurrency(group.cost) : '—'}</td><td className={profit >= 0 ? 'aph-report-positive' : 'aph-report-negative'}>{formatCurrency(profit)}</td><td className={margin == null ? '' : margin >= 0 ? 'aph-report-positive' : 'aph-report-negative'}>{margin == null ? '—' : `${formatDecimal(margin, 1)}%`}</td></tr>; })}</tbody></table></div></div>}
          </> : <div className="aph-report-card"><div className="aph-report-empty">No entry in this period carries a client value, so there is nothing to compute a margin against. Labour and material booked in the period come to {formatCurrency(totals.cost)}.</div></div>}

          <ReportSectionHeading title="Exceptions" hint="Built from the entries in this period only. Nothing here is a judgement about intent — each line names what the data shows and where to look." />
          <div className="aph-report-card">
            {!alerts.length ? <div className="aph-report-empty">Nothing in this period trips any of the Report checks.</div> : <div className="aph-report-alerts">{alerts.map((alert, index) => <div key={`${alert.title}-${index}`} className={alert.level === 'critical' ? 'aph-report-alert critical' : 'aph-report-alert watch'}><span /><div><b>{alert.title}</b><p>{alert.detail}</p></div><small>{alert.where}</small></div>)}</div>}
          </div>
        </>
      )}
    </div>
  );
}


const AnalyticsLoadedSection = memo(function AnalyticsLoadedSection({
  section,
  data,
  loadFlatDetails,
}: {
  section: AnalyticsTabId;
  data: ExecutiveSummaryResponse;
  loadFlatDetails: (row: FlatSummaryRow) => Promise<FlatSummaryRow['details']>;
}) {
  const k = data.kpis;

  const smallFlags = useMemo(() => {
    const flatRows = data.flatSummary || [];
    const profitAmount = flatRows.filter((row) => row.netProfit > 0.5).reduce((sum, row) => sum + row.netProfit, 0);
    const lossAmount = flatRows.filter((row) => row.netProfit < -0.5).reduce((sum, row) => sum + Math.abs(row.netProfit), 0);
    return [
      { title: 'Flats in profit', value: formatNumber(k.flatsInProfit), sub: `${formatCurrency(profitAmount)} positive net profit`, border: 'border-l-emerald-600' },
      { title: 'Flats in loss', value: formatNumber(k.flatsInLoss), sub: `${formatCurrency(lossAmount)} loss`, border: 'border-l-red-500' },
      { title: 'Non-billable operational work', value: formatCurrency(k.nonBillableOperationalWork), sub: `${k.clientValue > 0 ? formatDecimal(k.nonBillableOperationalWork * 100 / k.clientValue, 1) : '0.0'}% of revenue · ${formatNumber(k.nonBillableEntries)} entries`, border: 'border-l-orange-400' },
      { title: 'Flats with layers still to book', value: formatNumber(k.flatsWithLayersToBook), sub: `${formatNumber(k.flatsWorked)} flats worked · margins provisional`, border: 'border-l-orange-400' },
      { title: 'Flats below 60% productivity', value: formatNumber(k.flatsBelow60Productivity), sub: `below ${formatNumber(k.productivity * 0.6)} sqft/day`, border: 'border-l-blue-500' },
      { title: 'Labour days vs target', value: k.targetBookedDays > 0 ? `${k.bookedVsTarget > 0 ? '+' : ''}${formatDecimal(k.bookedVsTarget, 1)} d` : 'Not set', sub: k.targetBookedDays > 0 ? `${formatDecimal(k.actualBookedTargetedDays, 1)} booked vs ${formatDecimal(k.targetBookedDays, 1)} targeted · ${formatCurrency(k.labourValueGap)} labour gap` : 'no booked-layer target available', border: k.bookedVsTarget > 0.05 ? 'border-l-red-500' : 'border-l-emerald-600' },
    ];
  }, [data.flatSummary, k]);

  if (section === 'flats') {
    return (
      <FlatSummaryTable
        rows={data.flatSummary || []}
        heading="Flat-wise analysis"
        sub={`${formatNumber(data.flatSummary.length)} flats · ${formatNumber(data.recordCount)} entries · click any flat to load its layer calculations.`}
        loadDetails={loadFlatDetails}
      />
    );
  }

  if (section === 'trend') {
    return <TrendAnalysisTab data={data.trendAnalysis || emptySummary.trendAnalysis!} />;
  }

  if (section === 'targets') {
    return <LabourTargetsTab flatRows={data.flatSummary || []} kpis={data.kpis} />;
  }

  if (section === 'timeline') {
    return <DateTimelineTable rows={data.dateTimeline || []} />;
  }

  if (section === 'pl') {
    return <ProfitLossTab rows={data.flatSummary || []} kpis={data.kpis} />;
  }

  if (section === 'productivity') {
    return (
      <ProductivityTab
        flatRows={data.flatSummary || []}
        dateTimelineRows={data.dateTimeline || []}
        kpis={data.kpis}
      />
    );
  }

  if (section === 'cost') {
    return (
      <CostAnalysisTab
        applicationRows={data.applicationSummary || []}
        flatRows={data.flatSummary || []}
        kpis={data.kpis}
      />
    );
  }

  if (section === 'budget') {
    return (
      <BudgetCostControlTab
        data={data.budgetCostControl || emptySummary.budgetCostControl!}
      />
    );
  }

  return (
    <>
      <div className="aph-kpi-grid">
        <KpiCard label="Applications" value={formatNumber(k.applications)} sub="work streams" />
        <KpiCard label="Flats worked" value={formatNumber(k.flatsWorked)} sub={`${formatNumber(data.recordCount)} work entries`} />
        <KpiCard label="Total area" value={formatNumber(k.executedArea)} sub="sqft executed" />
        <KpiCard label="Client value" value={formatCurrency(k.clientValue)} sub="billable revenue" />
        <KpiCard label="Labour cost" value={formatCurrency(k.labourCost)} sub={`${k.clientValue > 0 ? formatDecimal(k.labourCost * 100 / k.clientValue, 1) : '0.0'}% of revenue`} />
        <KpiCard label="Material cost" value={formatCurrency(k.materialCost)} sub={`${k.clientValue > 0 ? formatDecimal(k.materialCost * 100 / k.clientValue, 1) : '0.0'}% of revenue`} />
        <KpiCard label="Net profit" value={formatCurrency(k.netProfit)} sub="revenue - labour - material" valueClassName={profitClass(k.netProfit)} />
        <KpiCard label="Profit margin" value={`${formatDecimal(k.profitMargin, 1)}%`} sub="on client value" valueClassName={profitClass(k.netProfit)} />
        <KpiCard label="Labour days" value={formatDecimal(k.labourDays, 1)} sub="total man-days" />
        <KpiCard label="Productivity" value={formatNumber(k.productivity)} sub="sqft per labour-day" />
      </div>

      <div className="aph-status-grid">
        {smallFlags.map((flag) => (
          <div key={flag.title} className={`aph-status-card ${flag.border}`}>
            <p>{flag.title}</p>
            <strong>{flag.value}</strong>
            <span>{flag.sub}</span>
          </div>
        ))}
      </div>

      <ExecutiveCharts
        applicationRows={data.applicationSummary || []}
        flatRows={data.flatSummary || []}
        dailyRows={data.dailyProfitTrend || []}
      />
      <ApplicationSummaryTable rows={data.applicationSummary || []} />
      <FlatSummaryTable
        rows={data.flatSummary || []}
        loadDetails={loadFlatDetails}
      />
    </>
  );
});

function AnalyticsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get('projectId') || '';

  const availableAnalyticsProjects = useMemo(
    () => projects.filter((project) => project.id !== 'analytics' && project.id !== 'aph_analytics'),
    [],
  );

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const selectedProject = useMemo(
    () => availableAnalyticsProjects.find((project) => project.id === selectedProjectId) || null,
    [availableAnalyticsProjects, selectedProjectId],
  );

  const [token, setToken] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [options, setOptions] = useState<AnalyticsOptions>(emptyOptions);
  const [summary, setSummary] = useState<ExecutiveSummaryResponse>(emptySummary);

  // activeTab controls the tab button/highlight immediately.
  // visibleTab controls the heavy panel swap one frame later, so the click can
  // paint immediately instead of waiting for a large table/chart layout.
  const [activeTab, setActiveTab] = useState<AnalyticsNavTabId>('executive');
  const [visibleTab, setVisibleTab] = useState<AnalyticsNavTabId>('executive');
  const [filters, setFilters] = useState<ExecutiveSummaryFilters>({
    profitability: 'all',
    billing: 'all',
  });
  const [appliedFilters, setAppliedFilters] = useState<ExecutiveSummaryFilters>({
    profitability: 'all',
    billing: 'all',
  });
  const requestSequenceRef = useRef(0);

  // Section responses are cached by project + applied filters + section.
  // Switching back to an already-loaded Analytics section therefore requires
  // no network request and can paint immediately from memory.
  const summaryCacheRef = useRef<Map<string, ExecutiveSummaryResponse>>(new Map());

  // If the same section/filter combination is requested twice before the first
  // call finishes, both callers share the same Promise instead of issuing a
  // duplicate HTTP request.
  const summaryInFlightRef = useRef<
    Map<string, Promise<ExecutiveSummaryResponse>>
  >(new Map());

  // Current-filter responses that have already been rendered. Keeping these
  // mounted means tab navigation only toggles visibility instead of rebuilding
  // large table/chart trees on every click.
  const [sectionSummaries, setSectionSummaries] = useState<
    Partial<Record<AnalyticsTabId, ExecutiveSummaryResponse>>
  >({});

  // Table enhancement is expensive on large sections. Run it once per
  // project/filter/section combination, never on every tab click.
  const enhancedSectionKeysRef = useRef<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [compactTables, setCompactTables] = useState(false);
  const [openFilterKey, setOpenFilterKey] = useState<string | null>(null);
  const [reportVisited, setReportVisited] = useState(false);
  const [reportRefreshVersion, setReportRefreshVersion] = useState(0);
  const [reviewVisited, setReviewVisited] = useState(false);
  const [reviewRefreshVersion, setReviewRefreshVersion] = useState(0);

  useEffect(() => {
    const storedAnalyticsProject = localStorage.getItem('zos_analytics_project') || '';
    const storedSelectedProject = localStorage.getItem('zos_selected_project') || '';
    const nextProjectId = queryProjectId || storedAnalyticsProject || storedSelectedProject;

    if (nextProjectId) {
      localStorage.setItem('zos_analytics_project', nextProjectId);
    }

    setSelectedProjectId((current) => (current === nextProjectId ? current : nextProjectId));
  }, [queryProjectId]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('zos_theme');
    const resolvedTheme =
      savedTheme === 'light' || savedTheme === 'dark'
        ? savedTheme
        : window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark';

    setTheme(resolvedTheme);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    localStorage.setItem('zos_theme', theme);
    window.dispatchEvent(new Event('zos-theme-change'));

    let metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme) {
      metaTheme = document.createElement('meta');
      metaTheme.setAttribute('name', 'theme-color');
      document.head.appendChild(metaTheme);
    }
    metaTheme.setAttribute('content', theme === 'dark' ? '#0f1115' : '#f7f9fc');
  }, [theme]);

  useEffect(() => {
    const savedToken = localStorage.getItem('zos_access_token');
    const savedUser = localStorage.getItem('zos_user');

    if (!savedToken) {
      router.push('/');
      return;
    }

    setToken(savedToken);

    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser) as User);
      } catch {
        localStorage.removeItem('zos_user');
      }
    }
  }, [router]);

  async function loadOptionsOnce(
    activeToken = token,
    activeProjectId = selectedProjectId,
  ) {
    if (!activeToken || !activeProjectId) return;

    try {
      const optionsData = await fetchAnalyticsOptions(activeToken, activeProjectId);
      setOptions(optionsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics options');
    }
  }

  async function loadSummary(
    activeToken = token,
    activeFilters = appliedFilters,
    activeProjectId = selectedProjectId,
    section: AnalyticsTabId = activeTab === 'review' || activeTab === 'report' ? 'executive' : activeTab,
    force = false,
  ) {
    if (!activeToken || !activeProjectId) return;

    const cacheKey = analyticsSectionCacheKey(
      activeProjectId,
      section,
      activeFilters,
    );

    if (!force) {
      const cached = summaryCacheRef.current.get(cacheKey);

      if (cached) {
        // Invalidate any older request that may still be returning from a tab
        // the user has already left.
        requestSequenceRef.current += 1;
        setError('');
        setLoading(false);
        setSummary(cached);
        setSectionSummaries((current) =>
          current[section as AnalyticsTabId] === cached
            ? current
            : { ...current, [section]: cached },
        );
        return cached;
      }
    }

    const requestId = ++requestSequenceRef.current;
    setLoading(true);
    setError('');

    let request = summaryInFlightRef.current.get(cacheKey);

    if (!request || force) {
      request = fetchExecutiveSummary(
        activeToken,
        activeProjectId,
        activeFilters,
        section,
      );
      summaryInFlightRef.current.set(cacheKey, request);
    }

    try {
      const summaryData = await request;
      const normalized = normalizeAnalyticsSummary(summaryData);

      // Store the response even if the user has already moved to another tab.
      // That way returning to this tab is still instant.
      summaryCacheRef.current.set(cacheKey, normalized);

      // But never let an old response replace the section currently on screen.
      if (requestId !== requestSequenceRef.current) return;

      setSummary(normalized);
      setSectionSummaries((current) => ({
        ...current,
        [section]: normalized,
      }));
      return normalized;
    } catch (err) {
      if (requestId !== requestSequenceRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      if (summaryInFlightRef.current.get(cacheKey) === request) {
        summaryInFlightRef.current.delete(cacheKey);
      }

      if (requestId === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  }

  const prefetchSummarySection = useCallback(
    async (
      section: AnalyticsTabId,
      activeToken = token,
      activeFilters = appliedFilters,
      activeProjectId = selectedProjectId,
    ) => {
      if (!activeToken || !activeProjectId) return;

      const cacheKey = analyticsSectionCacheKey(
        activeProjectId,
        section,
        activeFilters,
      );

      if (summaryCacheRef.current.has(cacheKey)) return;

      let request = summaryInFlightRef.current.get(cacheKey);

      if (!request) {
        request = fetchExecutiveSummary(
          activeToken,
          activeProjectId,
          activeFilters,
          section,
        );
        summaryInFlightRef.current.set(cacheKey, request);
      }

      try {
        const summaryData = await request;
        const normalized = normalizeAnalyticsSummary(summaryData);

        // Cache only. Do NOT mount/render the section here; that keeps this
        // background work off the React interaction path.
        summaryCacheRef.current.set(cacheKey, normalized);
      } catch {
        // Prefetch is opportunistic. A normal tab click will retry through
        // loadSummary and surface any real error to the user.
      } finally {
        if (summaryInFlightRef.current.get(cacheKey) === request) {
          summaryInFlightRef.current.delete(cacheKey);
        }
      }
    },
    [appliedFilters, selectedProjectId, token],
  );

  const warmMountSection = useCallback(
    (
      section: AnalyticsTabId,
      data: ExecutiveSummaryResponse,
      activeProjectId = selectedProjectId,
      activeFilters = appliedFilters,
    ) => {
      if (!activeProjectId) return;

      const expectedKey = analyticsSectionCacheKey(
        activeProjectId,
        section,
        activeFilters,
      );

      const mount = () => {
        // Do not mount stale data if the project/filter scope changed while
        // this low-priority task was waiting.
        const currentKey = analyticsSectionCacheKey(
          selectedProjectId,
          section,
          appliedFilters,
        );
        if (currentKey !== expectedKey) return;

        startTransition(() => {
          setSectionSummaries((current) =>
            current[section] === data
              ? current
              : { ...current, [section]: data },
          );
        });
      };

      const idleWindow = window as Window & {
        requestIdleCallback?: (
          callback: () => void,
          options?: { timeout: number },
        ) => number;
      };

      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleWindow.requestIdleCallback(mount, { timeout: 1200 });
      } else {
        window.setTimeout(mount, 120);
      }
    },
    [appliedFilters, selectedProjectId],
  );

  useEffect(() => {
    if (!token || !selectedProjectId) return;
    loadOptionsOnce(token, selectedProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedProjectId]);

  useEffect(() => {
    if (!token || !selectedProjectId) return;

    // Initial/project-change load only.
    // Filter changes are intentionally NOT watched here; Search/Apply sends
    // exactly one request containing the final selected filter snapshot.
    const initialFilters: ExecutiveSummaryFilters = {
      profitability: 'all',
      billing: 'all',
    };

    setAppliedFilters(initialFilters);
    loadSummary(token, initialFilters, selectedProjectId, 'executive');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedProjectId]);

  useEffect(() => {
    if (loading || !token || !selectedProjectId || activeTab === 'review' || activeTab === 'report') return;

    const activeCacheKey = analyticsSectionCacheKey(
      selectedProjectId,
      activeTab,
      appliedFilters,
    );

    if (!summaryCacheRef.current.has(activeCacheKey)) return;

    let cancelled = false;
    let pauseTimer = 0;

    // Give the visible section time to settle first. Then warm each remaining
    // section sequentially: fetch -> cache -> idle React mount.
    const startTimer = window.setTimeout(async () => {
      for (const section of ANALYTICS_PREFETCH_ORDER) {
        if (cancelled) return;
        if (section === activeTab) continue;

        const cacheKey = analyticsSectionCacheKey(
          selectedProjectId,
          section,
          appliedFilters,
        );

        if (!summaryCacheRef.current.has(cacheKey)) {
          await prefetchSummarySection(
            section,
            token,
            appliedFilters,
            selectedProjectId,
          );
        }

        if (cancelled) return;

        const prefetched = summaryCacheRef.current.get(cacheKey);
        if (prefetched) {
          warmMountSection(
            section,
            prefetched,
            selectedProjectId,
            appliedFilters,
          );
        }

        // Keep background work deliberately gentle.
        await new Promise<void>((resolve) => {
          pauseTimer = window.setTimeout(resolve, 650);
        });
      }
    }, 1400);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      window.clearTimeout(pauseTimer);
    };
  }, [
    activeTab,
    appliedFilters,
    loading,
    prefetchSummarySection,
    selectedProjectId,
    token,
    warmMountSection,
  ]);

  useEffect(() => {
    setOpenFilterKey(null);
  }, [activeTab, filtersOpen, selectedProjectId]);

  function setFilter(key: keyof ExecutiveSummaryFilters, value: string) {
    setFilters((current) => {
      const next: ExecutiveSummaryFilters = { ...current, [key]: value || undefined };

      if (key === 'block' && value !== (current.block || '')) {
        next.application = undefined;
        next.flat = undefined;
        next.workLayer = undefined;
      }

      if (key === 'application' && value !== (current.application || '')) {
        next.flat = undefined;
        next.workLayer = undefined;
      }

      if (key === 'flat' && value !== (current.flat || '')) {
        next.workLayer = undefined;
      }

      if (key === 'profitability' && !value) next.profitability = 'all';
      if (key === 'billing' && !value) next.billing = 'all';

      return next;
    });
  }

  function applyFilters() {
    // Snapshot the complete draft selection and send THAT exact object to the
    // API immediately. Do not rely on a later state-effect to perform the load.
    const nextFilters: ExecutiveSummaryFilters = { ...filters };

    setAppliedFilters(nextFilters);
    setOpenFilterKey(null);
    setSectionSummaries({});
    enhancedSectionKeysRef.current.clear();
    setVisibleTab(activeTab);

    if (token && selectedProjectId && activeTab !== 'review' && activeTab !== 'report') {
      void loadSummary(token, nextFilters, selectedProjectId, activeTab);
    }
  }

  function resetFilters() {
    const reset: ExecutiveSummaryFilters = {
      profitability: 'all',
      billing: 'all',
    };

    setFilters(reset);
    setAppliedFilters(reset);
    setOpenFilterKey(null);
    setSectionSummaries({});
    enhancedSectionKeysRef.current.clear();
    setVisibleTab(activeTab);

    if (token && selectedProjectId && activeTab !== 'review' && activeTab !== 'report') {
      void loadSummary(token, reset, selectedProjectId, activeTab);
    }
  }

  const loadFlatDetails = useCallback(
    async (row: FlatSummaryRow) => {
      if (!token || !selectedProjectId) return [];

      const detailFilters: ExecutiveSummaryFilters = {
        ...appliedFilters,
        application: row.application,
        flat: row.flatId,
      };

      const detailSummary = await fetchExecutiveSummary(
        token,
        selectedProjectId,
        detailFilters,
        'flat-detail',
      );

      return (
        detailSummary.flatSummary.find(
          (item) =>
            item.application === row.application &&
            item.flatId === row.flatId,
        )?.details || []
      );
    },
    [appliedFilters, selectedProjectId, token],
  );

  async function handleRefresh() {
    if (!token || !selectedProjectId) return;

    setRefreshing(true);
    setError('');

    try {
      await refreshAnalytics(token, selectedProjectId);

      // Source data changed: invalidate every previously loaded section so no
      // stale KPI/table response can be shown after a manual refresh.
      requestSequenceRef.current += 1;
      summaryCacheRef.current.clear();
      summaryInFlightRef.current.clear();
      setSectionSummaries({});
      enhancedSectionKeysRef.current.clear();
      setVisibleTab(activeTab);

      if (activeTab === 'review') {
        setReviewRefreshVersion((current) => current + 1);
        await loadOptionsOnce(token, selectedProjectId);
      } else if (activeTab === 'report') {
        setReportRefreshVersion((current) => current + 1);
        await loadOptionsOnce(token, selectedProjectId);
      } else {
        await Promise.all([
          loadOptionsOnce(token, selectedProjectId),
          loadSummary(
            token,
            appliedFilters,
            selectedProjectId,
            activeTab,
            true,
          ),
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh analytics');
    } finally {
      setRefreshing(false);
    }
  }

  function selectAnalyticsProject(projectId: string) {
    const project = availableAnalyticsProjects.find((item) => item.id === projectId);

    localStorage.setItem('zos_analytics_project', projectId);
    localStorage.setItem('zos_selected_project', projectId);

    if (project) {
      localStorage.setItem('zos_selected_project_name', project.name);
    }

    const reset: ExecutiveSummaryFilters = {
      profitability: 'all',
      billing: 'all',
    };

    requestSequenceRef.current += 1;
    setSectionSummaries({});
    enhancedSectionKeysRef.current.clear();
    setSelectedProjectId(projectId);
    setOptions(emptyOptions);
    setSummary(emptySummary);
    setFilters(reset);
    setAppliedFilters(reset);
    setActiveTab('executive');
    setVisibleTab('executive');
    setReportVisited(false);
    setReportRefreshVersion((current) => current + 1);
    setReviewVisited(false);
    setReviewRefreshVersion((current) => current + 1);
    setError('');
    setLoading(true);
    router.push(`/analytics?projectId=${encodeURIComponent(projectId)}`);
  }

  function logout() {
    localStorage.removeItem('zos_access_token');
    localStorage.removeItem('zos_user');
    localStorage.removeItem('zos_selected_project');
    localStorage.removeItem('zos_selected_project_name');
    localStorage.removeItem('zos_analytics_project');
    router.push('/');
  }

  const tabItems = useMemo<{ id: AnalyticsNavTabId; label: string; prefix: string }[]>(
    () => [
      { id: 'executive', label: 'Executive summary', prefix: '01' },
      { id: 'report', label: 'Report', prefix: '02' },
      { id: 'flats', label: 'Flat-wise analysis', prefix: '03' },
      { id: 'trend', label: 'Trend analysis', prefix: '04' },
      { id: 'timeline', label: 'Date timeline', prefix: '05' },
      { id: 'pl', label: 'Profit & loss', prefix: '06' },
      { id: 'productivity', label: 'Productivity', prefix: '07' },
      { id: 'cost', label: 'Cost analysis', prefix: '08' },
      { id: 'budget', label: 'Budget & cost control', prefix: '09' },
      ...(user?.role === 'admin'
        ? [{ id: 'review' as const, label: 'Entry review', prefix: '10' }]
        : []),
      { id: 'targets', label: 'Labour targets', prefix: '11' },
    ],
    [user?.role],
  );

  const cascadedFilterOptions = useMemo(() => {
    const selectedBlocks = parseMultiValue(filters.block);
    const selectedApplications = parseMultiValue(filters.application);
    const selectedFlats = parseMultiValue(filters.flat);
    const selectedWorkLayers = parseMultiValue(filters.workLayer);

    const blockApplicationRelations = options.blockApplicationRelations || [];
    const applicationFlatRelations = options.applicationFlatRelations || [];
    const applicationLayerRelations = options.applicationLayerRelations || [];

    // Fast compact graph returned by the optimized backend.
    if (
      blockApplicationRelations.length ||
      applicationFlatRelations.length ||
      applicationLayerRelations.length
    ) {
      const applicationRows = blockApplicationRelations.filter((row) =>
        matchesSelectedFilter(row.block, selectedBlocks),
      );

      const flatRows = applicationFlatRelations.filter(
        (row) =>
          matchesSelectedFilter(row.block, selectedBlocks) &&
          matchesSelectedFilter(row.application, selectedApplications),
      );

      const layerRows = applicationLayerRelations.filter(
        (row) =>
          matchesSelectedFilter(row.block, selectedBlocks) &&
          matchesSelectedFilter(row.application, selectedApplications),
      );

      return {
        blocks: uniqueSortedValues(
          blockApplicationRelations.map((row) => row.block),
          selectedBlocks,
        ),
        applications: uniqueSortedValues(
          applicationRows.map((row) => row.application),
          selectedApplications,
        ),
        flats: uniqueSortedValues(
          flatRows.map((row) => row.flat),
          selectedFlats,
        ),
        workLayers: uniqueSortedValues(
          layerRows.map((row) => row.workLayer),
          selectedWorkLayers,
        ),
      };
    }

    // Backward-compatible fallback for older backend responses.
    const relations = (options.filterRelations || []).filter(
      (row) => row.application && row.flat && row.workLayer,
    );

    if (!relations.length) {
      return {
        blocks: uniqueSortedValues(options.blocks || [], selectedBlocks),
        applications: uniqueSortedValues(
          options.applications || [],
          selectedApplications,
        ),
        flats: uniqueSortedValues(options.flats || [], selectedFlats),
        workLayers: uniqueSortedValues(
          options.workLayers || [],
          selectedWorkLayers,
        ),
      };
    }

    const rowsForApplication = relations.filter((row) =>
      matchesSelectedFilter(row.block, selectedBlocks),
    );

    const rowsForFlat = rowsForApplication.filter((row) =>
      matchesSelectedFilter(row.application, selectedApplications),
    );

    const rowsForWorkLayer = rowsForFlat.filter((row) =>
      matchesSelectedFilter(row.flat, selectedFlats),
    );

    return {
      blocks: uniqueSortedValues(
        relations.map((row) => row.block),
        selectedBlocks,
      ),
      applications: uniqueSortedValues(
        rowsForApplication.map((row) => row.application),
        selectedApplications,
      ),
      flats: uniqueSortedValues(
        rowsForFlat.map((row) => row.flat),
        selectedFlats,
      ),
      workLayers: uniqueSortedValues(
        rowsForWorkLayer.map((row) => row.workLayer),
        selectedWorkLayers,
      ),
    };
  }, [filters.application, filters.block, filters.flat, filters.workLayer, options]);

  useEffect(() => {
    setFilters((current) => {
      const nextApplication = keepValidMultiValue(current.application, cascadedFilterOptions.applications);
      const nextFlat = keepValidMultiValue(current.flat, cascadedFilterOptions.flats);
      const nextWorkLayer = keepValidMultiValue(current.workLayer, cascadedFilterOptions.workLayers);

      if (
        (current.application || '') === nextApplication &&
        (current.flat || '') === nextFlat &&
        (current.workLayer || '') === nextWorkLayer
      ) {
        return current;
      }

      return {
        ...current,
        application: nextApplication || undefined,
        flat: nextFlat || undefined,
        workLayer: nextWorkLayer || undefined,
      };
    });
  }, [
    cascadedFilterOptions.applications,
    cascadedFilterOptions.flats,
    cascadedFilterOptions.workLayers,
  ]);

  const activeFilterChips = useMemo(() => {
    const chips: { key: keyof ExecutiveSummaryFilters; label: string; value: string }[] = [];
    const f = appliedFilters;

    if (f.application) chips.push({ key: 'application', label: 'Application', value: multiValueLabel(f.application) });
    if (f.block) chips.push({ key: 'block', label: 'Block', value: multiValueLabel(f.block) });
    if (f.flat) chips.push({ key: 'flat', label: 'Flat', value: multiValueLabel(f.flat) });
    if (f.workLayer) chips.push({ key: 'workLayer', label: 'Layer', value: multiValueLabel(f.workLayer) });
    if (f.from) chips.push({ key: 'from', label: 'From', value: f.from });
    if (f.to) chips.push({ key: 'to', label: 'To', value: f.to });
    if (f.profitability && f.profitability !== 'all') {
      chips.push({ key: 'profitability', label: 'Profitability', value: multiValueLabel(f.profitability) });
    }
    if (f.billing && f.billing !== 'all') {
      chips.push({ key: 'billing', label: 'Billing', value: multiValueLabel(f.billing) });
    }
    if (f.search) chips.push({ key: 'search', label: 'Search', value: f.search });

    return chips;
  }, [appliedFilters]);

  const hasActiveFilters = activeFilterChips.length > 0;

  function clearFilter(key: keyof ExecutiveSummaryFilters) {
    if (key === 'profitability' || key === 'billing') {
      setFilter(key, 'all');
      return;
    }

    setFilter(key, '');
  }

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }

  function activateTab(tabId: AnalyticsNavTabId) {
    setOpenFilterKey(null);

    if (tabId === activeTab) return;

    // High-priority tiny update: highlight the clicked tab immediately.
    setActiveTab(tabId);

    if (tabId === 'report') {
      requestSequenceRef.current += 1;
      setLoading(false);
      setError('');
      setReportVisited(true);
      setReportRefreshVersion((current) => current + 1);
      window.requestAnimationFrame(() => setVisibleTab('report'));
      return;
    }

    if (tabId === 'review') {
      requestSequenceRef.current += 1;
      setLoading(false);
      setError('');
      setReviewVisited(true);
      window.requestAnimationFrame(() => setVisibleTab('review'));
      return;
    }

    const cacheKey = analyticsSectionCacheKey(
      selectedProjectId,
      tabId,
      appliedFilters,
    );
    const cached = summaryCacheRef.current.get(cacheKey);
    const mounted = sectionSummaries[tabId] || cached;

    if (mounted) {
      requestSequenceRef.current += 1;
      setLoading(false);
      setError('');
      setSummary(mounted);

      // If background prefetch cached the response but the idle warm mount has
      // not committed yet, mount it as a transition rather than blocking the
      // pointer event.
      if (!sectionSummaries[tabId]) {
        startTransition(() => {
          setSectionSummaries((current) => ({
            ...current,
            [tabId]: mounted,
          }));
        });
      }

      // Let the active-tab highlight paint first, then reveal the heavy panel.
      window.requestAnimationFrame(() => {
        startTransition(() => {
          setVisibleTab(tabId);
        });
      });
      return;
    }

    // First-ever uncached visit: show the tab selection immediately, then load
    // normally. Existing skeleton/loading behavior remains intact.
    setVisibleTab(tabId);

    if (token && selectedProjectId) {
      void loadSummary(
        token,
        appliedFilters,
        selectedProjectId,
        tabId,
      );
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;

    event.preventDefault();
    const nextIndex =
      event.key === 'ArrowRight'
        ? (index + 1) % tabItems.length
        : (index - 1 + tabItems.length) % tabItems.length;

    activateTab(tabItems[nextIndex].id);

    window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-aph-tab="${tabItems[nextIndex].id}"]`)
        ?.focus();
    }, 0);
  }

  function renderFilterControls(mobile = false) {
    const multiSelectState = {
      openFilterKey,
      setOpenFilterKey,
    };

    return (
      <>
        <div className={mobile ? 'aph-filter-controls aph-filter-controls-sheet' : 'aph-filter-controls'}>
          <SearchableMultiSelect
            filterKey={mobile ? 'mobile-block' : 'block'}
            label="Block"
            value={filters.block || ''}
            options={toMultiSelectOptions(cascadedFilterOptions.blocks)}
            allLabel="All blocks"
            onChange={(value) => setFilter('block', value)}
            onApply={applyFilters}
            {...multiSelectState}
          />

          <SearchableMultiSelect
            filterKey={mobile ? 'mobile-application' : 'application'}
            label="Application"
            value={filters.application || ''}
            options={toMultiSelectOptions(cascadedFilterOptions.applications)}
            allLabel="All applications"
            onChange={(value) => setFilter('application', value)}
            onApply={applyFilters}
            {...multiSelectState}
          />

          <SearchableMultiSelect
            filterKey={mobile ? 'mobile-flat' : 'flat'}
            label="Flat"
            value={filters.flat || ''}
            options={toMultiSelectOptions(cascadedFilterOptions.flats)}
            allLabel="All flats"
            onChange={(value) => setFilter('flat', value)}
            onApply={applyFilters}
            {...multiSelectState}
          />

          <SearchableMultiSelect
            filterKey={mobile ? 'mobile-work-layer' : 'work-layer'}
            label="Work Layer"
            value={filters.workLayer || ''}
            options={toMultiSelectOptions(cascadedFilterOptions.workLayers)}
            allLabel="All layers"
            onChange={(value) => setFilter('workLayer', value)}
            onApply={applyFilters}
            className="aph-field-layer"
            {...multiSelectState}
          />

          <label className="aph-field aph-field-date">
            <span>From</span>
            <input
              type="date"
              value={filters.from || ''}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setFilter('from', event.target.value)}
            />
          </label>

          <label className="aph-field aph-field-date">
            <span>To</span>
            <input
              type="date"
              value={filters.to || ''}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setFilter('to', event.target.value)}
            />
          </label>

          <SearchableMultiSelect
            filterKey={mobile ? 'mobile-profitability' : 'profitability'}
            label="Profitability"
            value={filters.profitability || 'all'}
            options={[
              { label: 'Profit only', value: 'profit' },
              { label: 'Loss only', value: 'loss' },
              { label: 'Break-even', value: 'break_even' },
            ]}
            allLabel="All entries"
            onChange={(value) => setFilter('profitability', value || 'all')}
            onApply={applyFilters}
            {...multiSelectState}
          />

          <SearchableMultiSelect
            filterKey={mobile ? 'mobile-billing' : 'billing'}
            label="Billing"
            value={filters.billing || 'all'}
            options={[
              { label: 'Billable only', value: 'billable' },
              { label: 'Non billable only', value: 'non_billable' },
            ]}
            allLabel="Billable + operational"
            onChange={(value) => setFilter('billing', value || 'all')}
            onApply={applyFilters}
            className="aph-field-billing"
            {...multiSelectState}
          />

          <label className="aph-field aph-field-search">
            <span>Search</span>
            <input
              type="search"
              placeholder="Flat, block, layer, application"
              value={filters.search || ''}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setFilter('search', event.target.value)}
            />
          </label>

          {!mobile && (
            <div className="aph-filter-inline-actions">
              <button type="button" onClick={applyFilters} className="aph-btn aph-btn-primary">
                Search
              </button>
              <button
                type="button"
                onClick={resetFilters}
                disabled={!hasActiveFilters}
                className="aph-btn aph-btn-ghost"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  useEffect(() => {
    if (visibleTab === 'review' || visibleTab === 'report') return;
    if (loading || !selectedProjectId || !sectionSummaries[visibleTab]) return;

    const enhancementKey = analyticsSectionCacheKey(
      selectedProjectId,
      visibleTab,
      appliedFilters,
    );

    if (enhancedSectionKeysRef.current.has(enhancementKey)) return;

    const panel = document.getElementById(`aph-panel-${visibleTab}`);
    if (!panel) return;

    const frame = window.requestAnimationFrame(() => {
      installCsvDownloads(panel, visibleTab);
      enhancedSectionKeysRef.current.add(enhancementKey);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    appliedFilters,
    loading,
    sectionSummaries,
    selectedProjectId,
    visibleTab,
  ]);

  if (token && (!selectedProjectId || !selectedProject)) {
    return (
      <main
        data-analytics-page-root
        data-density={compactTables ? 'compact' : 'comfortable'}
        className="aph-dashboard min-h-screen"
      >
        <section className="aph-content">
          <div className="mb-6 rounded-md border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              ZOS Analytics
            </p>
            <h1 className="mt-3 text-3xl font-bold text-slate-950 dark:text-white">
              Select project for Analytics
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
              Choose a project to open executive summary, flat-wise analysis, labour targets,
              date timeline, profit & loss, productivity and cost analysis.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {availableAnalyticsProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => selectAnalyticsProject(project.id)}
                className="rounded-md border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-orange-400 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <span className="rounded-full bg-orange-500 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                    {project.code}
                  </span>
                  <span className="aph-status-badge aph-status-healthy">
                    {project.status}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-slate-950 dark:text-white">{project.name}</h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{project.location}</p>
                <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {project.description}
                </p>
                <div className="mt-6 rounded bg-orange-500 px-4 py-3 text-center text-sm font-semibold text-white">
                  Open Analytics
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main
      data-analytics-page-root
      data-density={compactTables ? 'compact' : 'comfortable'}
      className="aph-dashboard min-h-screen"
    >
      <div className="aph-sticky-shell">
        <header className="aph-appbar">
          <div className="aph-appbar-inner">
            <button
              type="button"
              onClick={() => router.push('/projects')}
              className="aph-brand"
              aria-label="Go to projects"
            >
              <span className="aph-brand-mark">Z</span>
              <span>
                <span className="aph-brand-title">Analytics</span>
                <span className="aph-brand-sub">{selectedProject?.name || 'Select project'} · Zobocon</span>
              </span>
            </button>

            <div className={actionsOpen ? 'aph-app-actions aph-app-actions-open' : 'aph-app-actions'}>
              <select
                value={selectedProjectId}
                onChange={(event) => selectAnalyticsProject(event.target.value)}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none hover:border-orange-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                aria-label="Switch analytics project"
              >
                {availableAnalyticsProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                className="aph-btn aph-btn-ghost"
              >
                {refreshing ? 'Reloading...' : 'Reload source data'}
              </button>
              <button type="button" onClick={() => router.push('/projects')} className="aph-btn aph-btn-ghost">
                Projects
              </button>
              <div className="aph-user-chip" aria-label="Current user">
                <strong>{user?.username || 'User'}</strong>
                <span>{user?.role || 'viewer'}</span>
              </div>
              <button type="button" onClick={logout} className="aph-btn aph-btn-ghost aph-btn-danger">
                Logout
              </button>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className="aph-icon-btn"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? '☾' : '☀'}
            </button>

            <button
              type="button"
              onClick={() => setActionsOpen((current) => !current)}
              className="aph-icon-btn aph-menu-btn"
              aria-label="Open project actions"
              aria-expanded={actionsOpen}
            >
              ⋯
            </button>
          </div>
        </header>

        <nav className="aph-tabs" aria-label="Analytics sections">
          <div className="aph-tabs-scroll" role="tablist" aria-orientation="horizontal">
            {tabItems.map((tab, index) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`aph-panel-${tab.id}`}
                data-aph-tab={tab.id}
                onClick={() => activateTab(tab.id)}
                onPointerEnter={() => {
                  if (tab.id !== activeTab && tab.id !== 'review' && tab.id !== 'report') {
                    void prefetchSummarySection(tab.id);
                  }
                }}
                onFocus={() => {
                  if (tab.id !== activeTab && tab.id !== 'review' && tab.id !== 'report') {
                    void prefetchSummarySection(tab.id);
                  }
                }}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={activeTab === tab.id ? 'aph-tab aph-tab-active' : 'aph-tab'}
              >
                <span>{tab.prefix}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </nav>

        <section className="aph-filter-bar" aria-label="Analytics filters">
          <button
            type="button"
            onClick={() => {
              setOpenFilterKey(null);
              setFiltersOpen(true);
            }}
            className="aph-mobile-filter-btn"
            aria-expanded={filtersOpen}
            aria-controls="aph-filter-sheet"
          >
            Filters ({activeFilterChips.length})
          </button>

          {renderFilterControls()}

          <div className="aph-filter-meta">
            <button
              type="button"
              onClick={() => setCompactTables((current) => !current)}
              className="aph-btn aph-btn-ghost aph-density-toggle"
              aria-pressed={compactTables}
            >
              {compactTables ? 'Comfortable rows' : 'Compact rows'}
            </button>
            {activeTab !== 'review' && activeTab !== 'report' && (
              <span className="aph-record-chip">
                Analysing <b>{formatNumber(summary.recordCount)}</b> records
              </span>
            )}
          </div>

          {activeFilterChips.length > 0 && (
            <div className="aph-active-chips" aria-label="Active filters">
              {activeFilterChips.map((chip) => (
                <button
                  key={`${chip.key}-${chip.value}`}
                  type="button"
                  onClick={() => clearFilter(chip.key)}
                  className="aph-filter-chip"
                  aria-label={`Remove ${chip.label} filter`}
                >
                  {chip.label}: {chip.value} <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {filtersOpen && (
        <div className="aph-sheet-backdrop" role="presentation" onClick={() => setFiltersOpen(false)}>
          <section
            id="aph-filter-sheet"
            className="aph-filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Analytics filters"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="aph-sheet-handle" />
            <div className="aph-sheet-head">
              <h2>Filters</h2>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="aph-icon-btn"
                aria-label="Close filters"
              >
                ×
              </button>
            </div>
            {renderFilterControls(true)}
            <div className="aph-sheet-actions">
              <button
                type="button"
                onClick={resetFilters}
                disabled={!hasActiveFilters}
                className="aph-btn aph-btn-ghost"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => {
                  setFiltersOpen(false);
                  applyFilters();
                }}
                className="aph-btn aph-btn-primary"
              >
                Apply filters
              </button>
            </div>
          </section>
        </div>
      )}

      <section
        className="aph-content"
        aria-live={loading ? 'polite' : 'off'}
      >
        {error && (
          <div className="aph-alert aph-alert-error" role="alert">
            {error}
          </div>
        )}

        {activeTab !== 'review' && activeTab !== 'report' && loading && !sectionSummaries[activeTab] && (
          <div className="aph-skeleton-card" aria-label="Loading analytics">
            <span />
            <span />
            <span />
          </div>
        )}

        {tabItems.filter((tab): tab is { id: AnalyticsTabId; label: string; prefix: string } => tab.id !== 'review' && tab.id !== 'report').map((tab) => {
          const sectionData = sectionSummaries[tab.id];
          if (!sectionData) return null;

          return (
            <div
              key={tab.id}
              id={`aph-panel-${tab.id}`}
              role="tabpanel"
              aria-hidden={visibleTab !== tab.id}
              hidden={visibleTab !== tab.id}
            >
              <AnalyticsLoadedSection
                section={tab.id}
                data={sectionData}
                loadFlatDetails={loadFlatDetails}
              />
            </div>
          );
        })}

        {reportVisited && (
          <div
            id="aph-panel-report"
            role="tabpanel"
            aria-hidden={visibleTab !== 'report'}
            hidden={visibleTab !== 'report'}
          >
            <AnalyticsReportTab
              token={token}
              projectId={selectedProjectId}
              projectName={selectedProject?.name || selectedProjectId}
              filters={appliedFilters}
              refreshVersion={reportRefreshVersion}
            />
          </div>
        )}

        {user?.role === 'admin' && reviewVisited && (
          <div
            id="aph-panel-review"
            role="tabpanel"
            aria-hidden={visibleTab !== 'review'}
            hidden={visibleTab !== 'review'}
          >
            <EntryReviewTab
              token={token}
              projectId={selectedProjectId}
              filters={appliedFilters}
              refreshVersion={reviewRefreshVersion}
              reviewerName={user?.username || 'admin'}
            />
          </div>
        )}
      </section>
    </main>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 p-6 text-slate-600">
          Loading analytics...
        </main>
      }
    >
      <AnalyticsPageContent />
    </Suspense>
  );
}