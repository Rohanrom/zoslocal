import { useEffect, useState } from 'react';
import {
  DimensionFiltersResponse,
  DimensionRecord,
  DimensionListResponse,
  fetchProjectDimensionFilters,
  fetchProjectDimensions,
} from '../../lib/api';

const COLUMNS: { key: keyof DimensionRecord; label: string }[] = [
  { key: 'block', label: 'Block' },
  { key: 'application', label: 'Application' },
  { key: 'base', label: 'Base / Flat' },
  { key: 'wall', label: 'Wall / Surface' },
  { key: 'surface_type', label: 'Surface Type' },
  { key: 'total_area_sft', label: 'Total Area (sq ft)' },
  { key: 'length(+ve)', label: 'Length (+ve)' },
  { key: 'width(+ve)', label: 'Width (+ve)' },
  { key: 'height(+ve)', label: 'Height (+ve)' },
  { key: 'positive_area', label: 'Positive Area' },
  { key: 'length(-ve)', label: 'Length (-ve)' },
  { key: 'width(-ve)', label: 'Width (-ve)' },
  { key: 'height(-ve)', label: 'Height (-ve)' },
  { key: 'negative_area', label: 'Negative Area' },
  { key: 'length_2(-ve)', label: 'Length 2 (-ve)' },
  { key: 'width_2(-ve)', label: 'Width 2 (-ve)' },
  { key: 'height_2(-ve)', label: 'Height 2 (-ve)' },
  { key: 'row_id', label: 'Row ID' },
  { key: 'surface_id', label: 'Surface ID' },
  { key: 'project_id', label: 'Project ID' },
  { key: 'created_at', label: 'Created At' },
  { key: 'updated_at', label: 'Updated At' },
];

const EMPTY_FILTERS: DimensionFiltersResponse = {
  blocks: [],
  applications: [],
  surfaceTypes: [],
};

function displayValue(value: DimensionRecord[keyof DimensionRecord]) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export function DimensionsView({
  token,
  projectId,
}: {
  token: string;
  projectId: string;
}) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [block, setBlock] = useState('');
  const [application, setApplication] = useState('');
  const [surfaceType, setSurfaceType] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [reloadId, setReloadId] = useState(0);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [result, setResult] = useState<DimensionListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!token || !projectId) return;
    const controller = new AbortController();
    fetchProjectDimensionFilters(token, projectId, controller.signal)
      .then(setFilters)
      .catch((err: unknown) => {
        if (!(err instanceof Error && err.name === 'AbortError')) {
          // The table can still be searched without dropdown options.
          setFilters(EMPTY_FILTERS);
        }
      });
    return () => controller.abort();
  }, [token, projectId, reloadId]);

  useEffect(() => {
    if (!token || !projectId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');

    fetchProjectDimensions(token, projectId, {
      page,
      pageSize,
      search,
      block,
      application,
      surfaceType,
      signal: controller.signal,
    })
      .then(setResult)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Failed to load Dimensions');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [token, projectId, page, pageSize, search, block, application, surfaceType, reloadId]);

  function resetPageAndSet(setter: (value: string) => void, value: string) {
    setPage(1);
    setter(value);
  }

  const total = result?.total ?? 0;
  const currentPage = result?.page ?? page;
  const totalPages = result?.totalPages ?? 1;
  const firstRow = total > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(currentPage * pageSize, total);
  const inputStyle =
    'min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500';

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 p-4">
        <div>
          <h3 className="text-base font-semibold">Dimensions Data</h3>
          <p className="mt-1 text-xs text-slate-400">
            Read-only records from indr.surface_number for the selected project.
            All measurement columns are included.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReloadId((value) => value + 1)}
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>

      <div className="grid gap-3 border-b border-slate-800 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
          Search
          <input
            type="search"
            value={searchInput}
            onChange={(event) => resetPageAndSet(setSearchInput, event.target.value)}
            placeholder="Block, flat, wall, ID..."
            className={inputStyle}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
          Block
          <select
            value={block}
            onChange={(event) => resetPageAndSet(setBlock, event.target.value)}
            className={inputStyle}
          >
            <option value="">All blocks</option>
            {filters.blocks.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
          Application
          <select
            value={application}
            onChange={(event) => resetPageAndSet(setApplication, event.target.value)}
            className={inputStyle}
          >
            <option value="">All applications</option>
            {filters.applications.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
          Surface Type
          <select
            value={surfaceType}
            onChange={(event) => resetPageAndSet(setSurfaceType, event.target.value)}
            className={inputStyle}
          >
            <option value="">All surface types</option>
            {filters.surfaceTypes.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 text-xs text-slate-400">
        <span>
          {loading ? 'Loading Dimensions…' : `${total.toLocaleString('en-IN')} matching records`}
          {total > 0 && !loading ? ` · showing ${firstRow.toLocaleString('en-IN')}–${lastRow.toLocaleString('en-IN')}` : ''}
        </span>
        <label className="flex items-center gap-2">
          Rows per page
          <select
            className={inputStyle}
            value={pageSize}
            onChange={(event) => {
              setPage(1);
              setPageSize(Number(event.target.value));
            }}
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" className="m-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <thead className="bg-slate-950 text-slate-400">
            <tr>
              {COLUMNS.map((column) => (
                <th key={column.key} scope="col" className="whitespace-nowrap border-b border-slate-800 px-3 py-3 font-semibold">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(result?.rows ?? []).map((row) => (
              <tr key={row.surface_id} className="border-b border-slate-800/70 hover:bg-slate-800/50">
                {COLUMNS.map((column) => (
                  <td key={column.key} className="max-w-64 whitespace-nowrap px-3 py-2.5 text-slate-200">
                    <span className="block max-w-64 truncate" title={displayValue(row[column.key])}>
                      {displayValue(row[column.key])}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !error && result?.rows.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-400">
            No Dimensions records found for the selected project and filters.
          </p>
        )}
        {loading && !result && (
          <p className="p-8 text-center text-sm text-slate-400">Loading Dimensions…</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 p-4 text-xs text-slate-400">
        <span>Page {currentPage.toLocaleString('en-IN')} of {totalPages.toLocaleString('en-IN')}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading || page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            className="rounded-lg border border-slate-700 px-3 py-2 text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
            className="rounded-lg border border-slate-700 px-3 py-2 text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
