'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClientOverviewRow, fetchClientOverview, User } from '../../lib/api';
import { getProjectById } from '../../lib/projects';
import WorkApprovalPanel from './work-approval-panel';

type ClientSection = 'overview' | 'work-approval' | 'work-certification';

type LayerProgressDetail = {
  layerId: string;
  layerName: string;
  order: number;
  billable: boolean;
  totalArea: number;
  doneArea: number;
  pct: number;
  status: 'Not Started' | 'In Progress' | 'Completed';
};

type FlatProgressDetail = {
  flatId: string;
  flatLabel: string;
  pct: number;
  billableLayerCount: number;
  completedBillableLayerCount: number;
  layers: LayerProgressDetail[];
};

type FloorProgressDetail = {
  floorLabel: string;
  floorSort: number;
  pct: number;
  billableLayerCount: number;
  flats: FlatProgressDetail[];
};

type ApplicationProgressDetail = {
  application: string;
  pct: number;
  billableLayerCount: number;
  completedBillableLayerCount: number;
  floors: FloorProgressDetail[];
};

function clampProgress(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 100);
}

function progressStatus(pct: number): LayerProgressDetail['status'] {
  if (pct >= 99.995) return 'Completed';
  if (pct > 0) return 'In Progress';
  return 'Not Started';
}

function getFloorInfo(flatCode?: string | null) {
  const rawCode = String(flatCode || '').trim();

  if (!rawCode) {
    return { floorLabel: 'Unknown Floor', floorSort: 999999 };
  }

  const lastSegment = rawCode.split('-').filter(Boolean).pop() || rawCode;
  const digits = lastSegment.replace(/\D/g, '') || rawCode.replace(/\D/g, '');

  if (!digits) {
    return { floorLabel: 'Unknown Floor', floorSort: 999999 };
  }

  const floorDigits =
    digits.length >= 4 ? digits.slice(0, 2) : digits.padStart(2, '0');
  const floorNumber = Number(floorDigits);

  return {
    floorLabel: `Floor ${floorDigits}`,
    floorSort: Number.isFinite(floorNumber) ? floorNumber : 999999,
  };
}

function formatNumber(value: unknown, maximumFractionDigits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0';

  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits,
  }).format(parsed);
}

function sortFlatIds(a: string, b: string) {
  const aDigits = Number(a.replace(/\D/g, ''));
  const bDigits = Number(b.replace(/\D/g, ''));

  if (Number.isFinite(aDigits) && Number.isFinite(bDigits)) {
    return aDigits - bDigits;
  }

  return a.localeCompare(b);
}

type MemoryCacheEntry<T> = {
  data: T;
  expiresAt: number;
};

// Keep client reads fast without changing any server-side business logic.
// The in-flight maps are especially useful in React Strict Mode, where an
// effect can be mounted twice in development. Both mounts will reuse one
// network request instead of hitting the backend twice.
const overviewMemoryCache = new Map<
  string,
  MemoryCacheEntry<ClientOverviewRow[]>
>();
const overviewInFlight = new Map<
  string,
  Promise<ClientOverviewRow[]>
>();
const OVERVIEW_MEMORY_CACHE_MS = 15_000;

async function loadClientOverviewFast(token: string) {
  const now = Date.now();
  const cached = overviewMemoryCache.get(token);

  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const pending = overviewInFlight.get(token);
  if (pending) {
    return pending;
  }

  const request = fetchClientOverview(token)
    .then((rows) => {
      overviewMemoryCache.set(token, {
        data: rows,
        expiresAt: Date.now() + OVERVIEW_MEMORY_CACHE_MS,
      });
      return rows;
    })
    .finally(() => {
      overviewInFlight.delete(token);
    });

  overviewInFlight.set(token, request);
  return request;
}

function clearClientReadCache(token: string) {
  overviewMemoryCache.delete(token);
  overviewInFlight.delete(token);
}

export default function ClientWorkspacePage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [activeSection, setActiveSection] = useState<ClientSection>('overview');
  const [overviewRows, setOverviewRows] = useState<ClientOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedApplications, setExpandedApplications] = useState<
    Record<string, boolean>
  >({});
  const [expandedFloors, setExpandedFloors] = useState<Record<string, boolean>>(
    {},
  );
  const [selectedFlat, setSelectedFlat] = useState<{
    application: string;
    floorLabel: string;
    flat: FlatProgressDetail;
  } | null>(null);

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
        localStorage.clear();
        router.replace('/');
        return;
      }

      if (String(parsedUser.role || '').trim().toLowerCase() !== 'client') {
        router.replace('/projects');
        return;
      }

      if (!parsedUser.projectId || !getProjectById(parsedUser.projectId)) {
        setError('This client account is not assigned to a valid project.');
        setLoading(false);
        return;
      }

      setToken(savedToken);
      setUser(parsedUser);
      localStorage.setItem('zos_selected_project', parsedUser.projectId);
      const project = getProjectById(parsedUser.projectId);
      if (project) {
        localStorage.setItem('zos_selected_project_name', project.name);
      }

      try {
        const rows = await loadClientOverviewFast(savedToken);

        if (!cancelled) {
          setOverviewRows(rows);

        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load client overview',
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



  const overview = useMemo(() => {
    const billableRows = overviewRows.filter((row) => row.billable);
    const totalArea = billableRows.reduce((sum, row) => sum + row.totalArea, 0);
    const doneArea = billableRows.reduce((sum, row) => sum + row.doneArea, 0);
    const overallProgressPct = totalArea > 0 ? (doneArea / totalArea) * 100 : 0;

    const applicationMap = new Map<
      string,
      {
        billableTotalArea: number;
        billableDoneArea: number;
        billableLayerCount: number;
        completedBillableLayerCount: number;
        floors: Map<
          string,
          {
            floorSort: number;
            billableTotalArea: number;
            billableDoneArea: number;
            billableLayerCount: number;
            flats: Map<
              string,
              {
                flatLabel: string;
                billableTotalArea: number;
                billableDoneArea: number;
                billableLayerCount: number;
                completedBillableLayerCount: number;
                layers: LayerProgressDetail[];
              }
            >;
          }
        >;
      }
    >();

    overviewRows.forEach((row) => {
      const application = String(row.application || 'Unassigned').trim();
      const flatId = String(row.flatId || row.flat || 'Unassigned').trim();
      const flatLabel = String(row.flat || flatId || 'Unassigned').trim();
      const pct = clampProgress(row.wkdpct);
      const { floorLabel, floorSort } = getFloorInfo(flatId);

      let applicationEntry = applicationMap.get(application);
      if (!applicationEntry) {
        applicationEntry = {
          billableTotalArea: 0,
          billableDoneArea: 0,
          billableLayerCount: 0,
          completedBillableLayerCount: 0,
          floors: new Map(),
        };
        applicationMap.set(application, applicationEntry);
      }

      let floorEntry = applicationEntry.floors.get(floorLabel);
      if (!floorEntry) {
        floorEntry = {
          floorSort,
          billableTotalArea: 0,
          billableDoneArea: 0,
          billableLayerCount: 0,
          flats: new Map(),
        };
        applicationEntry.floors.set(floorLabel, floorEntry);
      }

      let flatEntry = floorEntry.flats.get(flatId);
      if (!flatEntry) {
        flatEntry = {
          flatLabel,
          billableTotalArea: 0,
          billableDoneArea: 0,
          billableLayerCount: 0,
          completedBillableLayerCount: 0,
          layers: [],
        };
        floorEntry.flats.set(flatId, flatEntry);
      }

      flatEntry.layers.push({
        layerId: row.layerId || `${flatId}-${row.layerName || 'layer'}`,
        layerName: row.layerName || row.layerId || 'Layer',
        order: row.layerOrder || 999999,
        billable: row.billable,
        totalArea: row.totalArea,
        doneArea: row.doneArea,
        pct,
        status: progressStatus(pct),
      });

      if (row.billable) {
        applicationEntry.billableTotalArea += row.totalArea;
        applicationEntry.billableDoneArea += row.doneArea;
        applicationEntry.billableLayerCount += 1;
        floorEntry.billableTotalArea += row.totalArea;
        floorEntry.billableDoneArea += row.doneArea;
        floorEntry.billableLayerCount += 1;
        flatEntry.billableTotalArea += row.totalArea;
        flatEntry.billableDoneArea += row.doneArea;
        flatEntry.billableLayerCount += 1;

        if (pct >= 99.995) {
          applicationEntry.completedBillableLayerCount += 1;
          flatEntry.completedBillableLayerCount += 1;
        }
      }
    });

    const applicationProgressDetails: ApplicationProgressDetail[] = Array.from(
      applicationMap.entries(),
    )
      .map(([application, entry]) => ({
        application,
        pct:
          entry.billableTotalArea > 0
            ? (entry.billableDoneArea / entry.billableTotalArea) * 100
            : 0,
        billableLayerCount: entry.billableLayerCount,
        completedBillableLayerCount: entry.completedBillableLayerCount,
        floors: Array.from(entry.floors.entries())
          .map(([floorLabel, floor]) => ({
            floorLabel,
            floorSort: floor.floorSort,
            pct:
              floor.billableTotalArea > 0
                ? (floor.billableDoneArea / floor.billableTotalArea) * 100
                : 0,
            billableLayerCount: floor.billableLayerCount,
            flats: Array.from(floor.flats.entries())
              .map(([flatId, flat]) => ({
                flatId,
                flatLabel: flat.flatLabel,
                pct:
                  flat.billableTotalArea > 0
                    ? (flat.billableDoneArea / flat.billableTotalArea) * 100
                    : 0,
                billableLayerCount: flat.billableLayerCount,
                completedBillableLayerCount: flat.completedBillableLayerCount,
                layers: [...flat.layers].sort(
                  (a, b) => a.order - b.order || a.layerName.localeCompare(b.layerName),
                ),
              }))
              .sort((a, b) => sortFlatIds(a.flatId, b.flatId)),
          }))
          .sort((a, b) => a.floorSort - b.floorSort),
      }))
      .sort((a, b) => a.application.localeCompare(b.application));

    return { totalArea, doneArea, overallProgressPct, applicationProgressDetails };
  }, [overviewRows]);



  const project = getProjectById(user?.projectId);

  function logout() {
    if (token) {
      clearClientReadCache(token);
    }

    localStorage.removeItem('zos_access_token');
    localStorage.removeItem('zos_user');
    localStorage.removeItem('zos_selected_project');
    localStorage.removeItem('zos_selected_project_name');
    router.replace('/');
  }

  function toggleApplication(application: string) {
    setExpandedApplications((current) => ({
      ...current,
      [application]: !current[application],
    }));
  }

  function toggleFloor(application: string, floorLabel: string) {
    const key = `${application}::${floorLabel}`;
    setExpandedFloors((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <main className="flex min-h-screen bg-slate-950 text-white">
      <aside className="hidden w-60 shrink-0 border-r border-slate-800 bg-slate-900 p-4 md:block">
        <div className="mb-8 flex items-center gap-3">
          <img src="/zobocon-mark.png" alt="Zobocon" className="h-9 w-9" />
          <div>
            <p className="font-display text-lg font-bold">ZOS</p>
            <p className="text-[11px] uppercase tracking-wide text-cyan-300">
              Client Portal
            </p>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-950 p-3">
          <p className="text-xs font-semibold text-slate-200">{project?.name}</p>
          <p className="mt-1 text-[11px] text-slate-500">{user?.username}</p>
        </div>

        <nav className="space-y-2">
          <button
            onClick={() => setActiveSection('overview')}
            className={`w-full rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
              activeSection === 'overview'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveSection('work-approval')}
            className={`w-full rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
              activeSection === 'work-approval'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            Work Approval
          </button>
          <button
            onClick={() => setActiveSection('work-certification')}
            className={`w-full rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
              activeSection === 'work-certification'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            Work Certification
          </button>
        </nav>

        <button
          onClick={logout}
          className="mt-8 w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/20"
        >
          Logout
        </button>
      </aside>

      <section className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/95 px-4 backdrop-blur md:px-6">
          <div>
            <p className="font-display text-sm font-bold text-white md:text-base">
              {project?.name || 'Client Workspace'}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-slate-500 md:hidden">
              {activeSection === 'work-approval'
                ? 'Work Approval'
                : activeSection === 'work-certification'
                  ? 'Work Certification'
                  : 'Overview'}
            </p>
          </div>

          <div className="flex max-w-[72vw] items-center gap-2 overflow-x-auto md:hidden">
            <button
              onClick={() => setActiveSection('overview')}
              className={`rounded-lg px-3 py-1.5 text-xs ${
                activeSection === 'overview'
                  ? 'bg-slate-700 text-white'
                  : 'border border-slate-700 text-slate-400'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveSection('work-approval')}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs ${
                activeSection === 'work-approval'
                  ? 'bg-slate-700 text-white'
                  : 'border border-slate-700 text-slate-400'
              }`}
            >
              Work Approval
            </button>
            <button
              onClick={() => setActiveSection('work-certification')}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs ${
                activeSection === 'work-certification'
                  ? 'bg-slate-700 text-white'
                  : 'border border-slate-700 text-slate-400'
              }`}
            >
              Work Certification
            </button>
            <button
              onClick={logout}
              className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300"
            >
              Logout
            </button>
          </div>
        </header>

        <div className="p-4 md:p-6">
          {error && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {activeSection === 'overview' ? (
            <>
              <div className="mb-5">
                <h1 className="font-display text-2xl font-bold">Overview</h1>
                <p className="mt-1 text-sm text-slate-500">
                  Project progress calculated from billable layer area.
                </p>
              </div>

              {loading ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
                  Loading project progress...
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                      Overall Progress
                    </p>
                    <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
                      <p className="font-mono text-4xl font-bold text-white">
                        {formatNumber(overview.overallProgressPct)}%
                      </p>
                      <p className="font-mono text-xs text-slate-500">
                        {formatNumber(overview.doneArea)} / {formatNumber(overview.totalArea)} sqft
                      </p>
                    </div>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-cyan-500"
                        style={{ width: `${Math.min(overview.overallProgressPct, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h2 className="font-display text-base font-semibold">
                          Progress by Application
                        </h2>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Expand Application → Floor → Flat and select a flat to see its layers.
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-700 px-3 py-1 text-[11px] text-slate-400">
                        {overview.applicationProgressDetails.length} applications
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                      <div className="max-h-[620px] overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <div className="space-y-2">
                          {overview.applicationProgressDetails.map((application) => {
                            const appOpen = Boolean(expandedApplications[application.application]);

                            return (
                              <div key={application.application}>
                                <button
                                  type="button"
                                  onClick={() => toggleApplication(application.application)}
                                  className="w-full rounded-xl px-3 py-2 text-left text-slate-300 transition hover:bg-slate-900"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className={`text-[10px] text-slate-500 ${appOpen ? 'rotate-90' : ''}`}>
                                      ▸
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                                      {application.application}
                                    </span>
                                    <span className="font-mono text-[11px] text-cyan-300">
                                      {formatNumber(application.pct)}%
                                    </span>
                                  </div>
                                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                                    <div
                                      className="h-full rounded-full bg-cyan-500"
                                      style={{ width: `${Math.min(application.pct, 100)}%` }}
                                    />
                                  </div>
                                  <p className="mt-1 text-[10px] text-slate-500">
                                    {application.completedBillableLayerCount}/{application.billableLayerCount} billable layers complete
                                  </p>
                                </button>

                                {appOpen && (
                                  <div className="ml-4 mt-1 space-y-1 border-l border-dashed border-slate-700 pl-3">
                                    {application.floors.map((floor) => {
                                      const floorKey = `${application.application}::${floor.floorLabel}`;
                                      const floorOpen = Boolean(expandedFloors[floorKey]);

                                      return (
                                        <div key={floor.floorLabel}>
                                          <button
                                            type="button"
                                            onClick={() => toggleFloor(application.application, floor.floorLabel)}
                                            className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-900"
                                          >
                                            <div className="flex items-center gap-2">
                                              <span className={`text-[10px] text-slate-500 ${floorOpen ? 'rotate-90' : ''}`}>▸</span>
                                              <span className="flex-1">{floor.floorLabel}</span>
                                              <span className="font-mono text-[10px] text-cyan-300">
                                                {formatNumber(floor.pct)}%
                                              </span>
                                            </div>
                                          </button>

                                          {floorOpen && (
                                            <div className="ml-4 space-y-1 border-l border-slate-800 pl-2">
                                              {floor.flats.map((flat) => (
                                                <button
                                                  key={flat.flatId}
                                                  type="button"
                                                  onClick={() =>
                                                    setSelectedFlat({
                                                      application: application.application,
                                                      floorLabel: floor.floorLabel,
                                                      flat,
                                                    })
                                                  }
                                                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[11px] ${
                                                    selectedFlat?.flat.flatId === flat.flatId &&
                                                    selectedFlat.application === application.application
                                                      ? 'bg-cyan-500/10 text-cyan-200'
                                                      : 'text-slate-400 hover:bg-slate-900'
                                                  }`}
                                                >
                                                  <span>{flat.flatLabel}</span>
                                                  <span className="font-mono">{formatNumber(flat.pct)}%</span>
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="min-h-[300px] rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                        {selectedFlat ? (
                          <>
                            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
                              <div>
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">
                                  {selectedFlat.application} · {selectedFlat.floorLabel}
                                </p>
                                <h3 className="mt-1 font-display text-xl font-bold text-cyan-300">
                                  {selectedFlat.flat.flatLabel}
                                </h3>
                              </div>
                              <div className="text-right">
                                <p className="font-mono text-2xl font-bold">
                                  {formatNumber(selectedFlat.flat.pct)}%
                                </p>
                                <p className="text-[10px] text-slate-500">
                                  {selectedFlat.flat.completedBillableLayerCount}/{selectedFlat.flat.billableLayerCount} billable layers complete
                                </p>
                              </div>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="min-w-full text-left text-xs">
                                <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                                  <tr>
                                    <th className="px-3 py-2">Layer</th>
                                    <th className="px-3 py-2">Billable</th>
                                    <th className="px-3 py-2">Progress</th>
                                    <th className="px-3 py-2">Done Area</th>
                                    <th className="px-3 py-2">Total Area</th>
                                    <th className="px-3 py-2">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedFlat.flat.layers.map((layer) => (
                                    <tr key={layer.layerId} className="border-t border-slate-800">
                                      <td className="px-3 py-3 font-semibold text-slate-200">{layer.layerName}</td>
                                      <td className="px-3 py-3 text-slate-400">{layer.billable ? 'Yes' : 'No'}</td>
                                      <td className="px-3 py-3 font-mono text-cyan-300">{formatNumber(layer.pct)}%</td>
                                      <td className="px-3 py-3 font-mono text-slate-300">{formatNumber(layer.doneArea)}</td>
                                      <td className="px-3 py-3 font-mono text-slate-300">{formatNumber(layer.totalArea)}</td>
                                      <td className="px-3 py-3">
                                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                                          layer.status === 'Completed'
                                            ? 'bg-emerald-500/10 text-emerald-300'
                                            : layer.status === 'In Progress'
                                              ? 'bg-amber-500/10 text-amber-300'
                                              : 'bg-slate-800 text-slate-400'
                                        }`}>
                                          {layer.status}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        ) : (
                          <div className="flex min-h-[260px] items-center justify-center text-center text-sm text-slate-500">
                            Select a flat from the progress tree to view its complete layer breakdown.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : activeSection === 'work-approval' ? (
            <WorkApprovalPanel token={token} />
          ) : activeSection === 'work-certification' ? (
            <div className="flex min-h-[420px] items-center justify-center">
              <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-cyan-500/20 bg-cyan-500/10 text-xl text-cyan-300">
                  ◷
                </div>
                <h1 className="font-display text-xl font-bold text-white">
                  Work Certification
                </h1>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
                  The Work Certification module is currently under development as part of our ongoing platform enhancement. Once released, this section will provide a structured workflow for reviewing, validating, and certifying completed work.
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  This feature will be made available in a future system update.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}