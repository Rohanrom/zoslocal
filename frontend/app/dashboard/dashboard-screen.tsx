'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import NightshiftTransition from '../components/nightshift-transition';
import {
  BoqCostingRow,
  fetchBoqCosting,
  fetchHomeLayerProgress,
  fetchProjectionFlats,
  fetchProjectionLayers,
  fetchProjectsDirectory,
  ProjectDirectoryProject,
  ProjectionFlat,
  ProjectionLayer,
  User,
} from '../../lib/api';
import { projectFromDirectory, Project } from '../../lib/projects';
import {
  AssignmentMaterialSuggestion,
  fetchAssignmentMaterialSuggestion,
} from '../../lib/assignmentApi';

import {
  type AssignmentViewId,
  type BillingViewId,
  getBillingViewTitle,
} from './view-titles';
import { projectViewHref, type ProjectViewId } from './view-routes';

// The four views below are large (assignment-view alone is ~12,000 lines) and
// most users open only one of them. Load each one when it is first shown
// instead of shipping all of them with the dashboard's first download.
function ViewLoading() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-slate-300">
      Loading view...
    </div>
  );
}

const AssignmentView = dynamic(
  () => import('./assignment-view').then((m) => m.AssignmentView),
  { ssr: false, loading: ViewLoading },
);
const BillingView = dynamic(
  () => import('./billing-view').then((m) => m.BillingView),
  { ssr: false, loading: ViewLoading },
);
const DimensionsView = dynamic(
  () => import('./dimensions-view').then((m) => m.DimensionsView),
  { ssr: false, loading: ViewLoading },
);
const WorkOrderWorksheet = dynamic(
  () => import('./work-order-worksheet').then((m) => m.WorkOrderWorksheet),
  { ssr: false, loading: ViewLoading },
);

type ActiveTable = ProjectViewId;

function isBillingViewId(value: ActiveTable): value is BillingViewId {
  return value.startsWith('billing-');
}

function isAssignmentViewId(value: ActiveTable): value is AssignmentViewId {
  return value.startsWith('assignment-');
}



type HomeLayerProgressRow = {
  project_id?: string | null;
  layer_id: string;
  flat_id?: string | null;
  block?: string | null;
  application?: string | null;
  flat?: string | number | null;
  layer_name: string;
  layer_order?: number | null;
  billable?: boolean | null;
  total_area?: number | null;
  done_area?: number | null;
  wkdpct?: number | null;
};

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
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) return 0;
  return Math.min(Math.max(numberValue, 0), 100);
}

function getLayerProgressStatus(
  pct: number,
): LayerProgressDetail['status'] {
  if (pct >= 99.995) return 'Completed';
  if (pct > 0) return 'In Progress';
  return 'Not Started';
}

function getFloorInfoFromFlatCode(flatCode?: string | null) {
  const rawCode = String(flatCode || '').trim();

  if (!rawCode) {
    return { floorLabel: 'Unknown Floor', floorSort: 999999 };
  }

  const lastSegment = rawCode.split('-').filter(Boolean).pop() || rawCode;
  const digitsFromSegment = lastSegment.replace(/\D/g, '');
  const allDigits = rawCode.replace(/\D/g, '');
  const digits = digitsFromSegment || allDigits;

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

// Both flats and layers fetches are capped by this. It has to be high enough
// to cover the whole project, not just a page of it — every aggregate on the
// Home overview (sums, group-bys, %) is computed client-side from whatever's
// in these arrays, so a low limit would silently make the totals wrong the
// moment the project has more rows than the cap.
const AGGREGATE_FETCH_LIMIT = 5000;

// The same top-level sidebar modules are visible for every Admin/Viewer project.
// Keep Dimension and Work Order as independent top-level groups on every project.
// Data readiness is checked inside each module, never by hiding its navigation.
const NAV_GROUPS: {
  id: string;
  label: string;
  dot: string;
  items?: { id: ActiveTable; label: string }[];
  placeholder?: boolean;
}[] = [
  {
    id: 'home',
    label: 'Home',
    dot: 'bg-amber-500',
    items: [{ id: 'home', label: 'Overview' }],
  },
  {
    id: 'dimension',
    label: 'Dimension',
    dot: 'bg-sky-500',
    items: [{ id: 'dimensions', label: 'Dimensions Data' }],
  },
  {
    id: 'work-order',
    label: 'Work Order',
    dot: 'bg-emerald-500',
    items: [{ id: 'work-order-worksheet', label: 'Work Order & Costing' }],
  },
  { id: 'paintline', label: 'PaintLine', dot: 'bg-amber-500', placeholder: true },
  { id: 'brushline', label: 'BrushLine', dot: 'bg-pink-500', placeholder: true },
  { id: 'pods', label: 'Pods', dot: 'bg-purple-500', placeholder: true },
  { id: 'zqs', label: 'ZQS', dot: 'bg-teal-500', placeholder: true },
  {
    id: 'projection',
    label: 'Projection Engine',
    dot: 'bg-cyan-500',
    items: [
      { id: 'flats', label: 'Flat Progress' },
      { id: 'layers', label: 'Projection Summary' },
    ],
  },
  { id: 'material', label: 'Material Engine', dot: 'bg-slate-400', placeholder: true },
  {
  id: 'billing',
  label: 'Billing Engine',
  dot: 'bg-emerald-500',
  items: [
    {
      id: 'billing-overall',
      label: 'Overall Billing',
    },
    {
      id: 'billing-pending',
      label: 'Pending Billing',
    },
    {
      id: 'billing-sent',
      label: 'Sent For Approval',
    },
    {
      id: 'billing-billed',
      label: 'Already Billed',
    },
    {
      id: 'billing-latest',
      label: 'Latest Billing',
    },
    {
      id: 'billing-invoice',
      label: 'Invoice Details',
    },
    {
      id: 'billing-floor-layer',
      label: 'Floor Wise Billing',
    },
  ],
},
  {
    id: 'assignment',
    label: 'Assignment Engine',
    dot: 'bg-violet-400',
    items: [
      { id: 'assignment-demand', label: 'Tomorrow Work Demand' },
      { id: 'assignment-recommended', label: 'Recommended Assignments' },
      { id: 'assignment-capacity', label: 'Painter Capacity' },
      { id: 'assignment-final', label: 'Final Assignment' },
      { id: 'assignment-reporting', label: 'Reporting' },
      { id: 'assignment-layer-progress', label: 'Layer Progress' },
    ],
  },
  { id: 'deployment', label: 'Deployment Engine', dot: 'bg-blue-400', placeholder: true },
  { id: 'governance', label: 'Governance', dot: 'bg-red-500', placeholder: true },
];

type NavigationGroup = (typeof NAV_GROUPS)[number];

const ASSIGNMENT_ENABLED_PROJECT_IDS = ['indradhanush', 'park_heights'];
const BILLING_ENABLED_PROJECT_IDS = ['indradhanush'];
const BOQ_ENABLED_PROJECT_IDS = ['park_heights'];
const LEGACY_PROJECTION_PROJECT_IDS = ['park_heights', 'indradhanush'];

const PROJECT_MANAGER_ROLE = 'manager';
const PROJECT_MANAGER_PROJECT_ID = 'indradhanush';
const PROJECT_MANAGER_DEFAULT_VIEW: AssignmentViewId = 'assignment-final';

const PROJECT_MANAGER_ALLOWED_VIEWS = new Set<ActiveTable>([
  'assignment-final',
  'assignment-reporting',
  'assignment-layer-progress',
]);

const PROJECT_MANAGER_NAVIGATION_GROUP: NavigationGroup = {
  id: 'assignment',
  label: 'Assignment Engine',
  dot: 'bg-violet-400',
  items: [
    { id: 'assignment-final', label: 'Final Assignment' },
    { id: 'assignment-reporting', label: 'Reporting' },
    { id: 'assignment-layer-progress', label: 'Layer Progress' },
  ],
};

function isProjectManagerRole(role?: string | null) {
  return String(role || '').trim().toLowerCase() === PROJECT_MANAGER_ROLE;
}

function SidebarNavigation({
  groups,
  openGroup,
  activeTable,
  onToggleGroup,
  onSelect,
  mobile = false,
}: {
  groups: NavigationGroup[];
  openGroup: string;
  activeTable: ActiveTable;
  onToggleGroup: (groupId: string) => void;
  onSelect: (table: ActiveTable) => void;
  mobile?: boolean;
}) {
  return (
    <nav className={`nightshift-nav ${mobile ? 'space-y-1' : 'space-y-0.5'}`}>
      {groups.map((group) => {
        const groupIsActive = Boolean(
          group.items?.some((item) => item.id === activeTable),
        );
        const groupIsOpen = openGroup === group.id;

        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => onToggleGroup(group.id)}
              aria-expanded={groupIsOpen}
              className={`nightshift-nav-group flex w-full items-center gap-2 rounded-lg text-left font-semibold transition ${
                mobile ? 'px-3 py-2.5 text-sm' : 'px-3 py-2 text-[13px]'
              } ${
                groupIsActive
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-sm ${group.dot}`} />
              <span className="min-w-0 flex-1 truncate">{group.label}</span>
              <span
                className={`text-[10px] text-slate-500 transition-transform ${
                  groupIsOpen ? 'rotate-90' : ''
                }`}
                aria-hidden="true"
              >
                &gt;
              </span>
            </button>

            {groupIsOpen && (
              <div className="ml-3 space-y-0.5 border-l border-slate-800 pl-3">
                {group.placeholder && (
                  <div className="px-3 py-1.5 text-[12px] italic text-slate-600">
                    Not built yet
                  </div>
                )}

                {group.items?.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={`nightshift-nav-item block w-full rounded-lg text-left transition ${
                      mobile ? 'px-3 py-2 text-[13px]' : 'px-3 py-1.5 text-[12.5px]'
                    } ${
                      activeTable === item.id
                        ? 'bg-slate-700 font-semibold text-white'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

// Which sidebar group holds a view, so the right group is open on load.
function groupIdForView(view: ActiveTable): string {
  if (view === 'home') return 'home';
  if (view === 'dimensions') return 'dimension';
  if (view === 'work-order-worksheet') return 'work-order';
  if (view === 'layers' || view === 'flats') return 'projection';
  if (view.startsWith('billing-')) return 'billing';
  if (view.startsWith('assignment-')) return 'assignment';
  return 'home';
}

/**
 * The project workspace: sidebar, header and the selected view.
 *
 * The project and the view come from the address (/projects/<id>/<view>),
 * not from browser storage, so refresh, Back and shared links all work and
 * two tabs can show two projects. Rendered by app/projects/[projectId]/layout.tsx.
 */
export function DashboardScreen({
  routeProjectId,
  routeView,
  embedded = false,
  subNav,
}: {
  routeProjectId: string;
  routeView: ActiveTable;
  /** Inside the app shell: the shell draws the top bar and menus, so this screen hides its own. */
  embedded?: boolean;
  /** Drawn at the top of the content area, e.g. the module's view tabs. */
  subNav?: ReactNode;
}) {
  const router = useRouter();

  const [token, setToken] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
  const [projectDirectoryRow, setProjectDirectoryRow] =
    useState<ProjectDirectoryProject | null>(null);

  const [activeTable, setActiveTable] = useState<ActiveTable>(routeView);
  const [openGroup, setOpenGroup] = useState(groupIdForView(routeView));
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [layers, setLayers] = useState<ProjectionLayer[]>([]);
  const [flats, setFlats] = useState<ProjectionFlat[]>([]);
  const [homeLayerProgressRows, setHomeLayerProgressRows] = useState<
    HomeLayerProgressRow[]
  >([]);
  const [homeLayerProgressLoading, setHomeLayerProgressLoading] = useState(false);
  const [homeLayerProgressError, setHomeLayerProgressError] = useState('');
  const [boqCosting, setBoqCosting] = useState<BoqCostingRow[]>([]);
  const [boqLoading, setBoqLoading] = useState(false);
  const [boqError, setBoqError] = useState('');
  const [applicationOptions, setApplicationOptions] = useState<string[]>([]);

  const [applicationFilter, setApplicationFilter] = useState('All');

  const [dailyPainters, setDailyPainters] = useState(5);
  const [workMode, setWorkMode] = useState('Machine');

  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState('');

  const [openDropdown, setOpenDropdown] = useState<
    'project' | 'alerts' | 'user' | null
  >(null);
  const [searchQuery, setSearchQuery] = useState('');
  // The dashboard already loads the initial Projection layer set during startup.
  // Skip the first input-driven refresh triggered when token/project state is set,
  // otherwise Home issues the same expensive layer request twice.
  const skipInitialLayerReloadRef = useRef(true);

  useEffect(() => {
    if (!mobileSidebarOpen) return;

    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMobileSidebarOpen(false);
      }
    }

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileSidebarOpen]);

  useEffect(() => {
    async function initializeDashboard() {
      const savedToken = localStorage.getItem('zos_access_token');
      const savedUser = localStorage.getItem('zos_user');

      if (!savedToken) {
        router.push('/');
        return;
      }

      let parsedUser: User | null = null;

      if (savedUser) {
        try {
          parsedUser = JSON.parse(savedUser) as User;
        } catch {
          localStorage.removeItem('zos_user');
        }
      }

      const projectManager = isProjectManagerRole(parsedUser?.role);
      // Project managers are limited to one project and a few views; send
      // them there if the address asks for anything else.
      if (projectManager) {
        const allowedView = PROJECT_MANAGER_ALLOWED_VIEWS.has(routeView)
          ? routeView
          : PROJECT_MANAGER_DEFAULT_VIEW;
        if (routeProjectId !== PROJECT_MANAGER_PROJECT_ID || allowedView !== routeView) {
          router.replace(projectViewHref(PROJECT_MANAGER_PROJECT_ID, allowedView));
          return;
        }
      }

      const effectiveProjectId = projectManager
        ? PROJECT_MANAGER_PROJECT_ID
        : routeProjectId;

      if (!effectiveProjectId) {
        router.push('/projects');
        return;
      }

      // Start the project's data requests now, in parallel with the project
      // directory, instead of waiting for the directory first. They only need
      // the token and the project id. If the directory later shows the project
      // is invalid, the user is redirected and these results are ignored.
      const startDataEarly = !projectManager;
      const earlyUseGenericProjectData =
        !LEGACY_PROJECTION_PROJECT_IDS.includes(effectiveProjectId);
      const earlyHomeLayerProgress = startDataEarly
        ? fetchHomeLayerProgress(savedToken, effectiveProjectId)
        : null;
      const earlyProjectionData = startDataEarly
        ? Promise.all([
            fetchProjectionLayers(savedToken, {
              projectId: earlyUseGenericProjectData ? effectiveProjectId : undefined,
              dailyPainters,
              workMode,
              limit: AGGREGATE_FETCH_LIMIT,
            }),
            fetchProjectionFlats(savedToken, {
              projectId: earlyUseGenericProjectData ? effectiveProjectId : undefined,
              limit: AGGREGATE_FETCH_LIMIT,
            }),
          ])
        : null;
      // Errors are handled where these are awaited below; this only stops the
      // browser reporting them as unhandled if we redirect before awaiting.
      earlyHomeLayerProgress?.catch(() => undefined);
      earlyProjectionData?.catch(() => undefined);

      let directoryRows: ProjectDirectoryProject[] = [];

      try {
        directoryRows = await fetchProjectsDirectory(savedToken);
      } catch (directoryError) {
        setError(
          directoryError instanceof Error
            ? directoryError.message
            : 'Failed to load project registry',
        );
        setLoading(false);
        return;
      }

      const directoryProjects = directoryRows.map(projectFromDirectory);
      const activeDirectoryRow =
        directoryRows.find((row) => row.projectId === effectiveProjectId) || null;
      const activeProject = activeDirectoryRow
        ? projectFromDirectory(activeDirectoryRow)
        : null;

      if (!activeProject) {
        localStorage.removeItem('zos_selected_project');
        localStorage.removeItem('zos_selected_project_name');
        router.push('/projects');
        return;
      }

      setAvailableProjects(directoryProjects);
      setProjectDirectoryRow(activeDirectoryRow);

      if (projectManager) {
        localStorage.setItem('zos_selected_project', activeProject.id);
        localStorage.setItem('zos_selected_project_name', activeProject.name);
      }

      setToken(savedToken);
      setProject(activeProject);
      setUser(parsedUser);

      // Other pages (analytics, client) still read the last project from
      // storage, so keep it in step with the address.
      localStorage.setItem('zos_selected_project', activeProject.id);
      localStorage.setItem('zos_selected_project_name', activeProject.name);

      if (projectManager) {
        setOpenGroup('assignment');
        setLoading(false);
        return;
      }

      try {
        // Home progress used to call Assignment Engine's assignment_v_layer_status
        // for APH/Indradhanush. That view is a live multi-view calculation and can
        // take minutes on a large project. The common Home endpoint reads the same
        // project-scoped layer progress directly from indr.layer + flat_area_summary,
        // so use it for every project and load it independently from the page shell.
        setHomeLayerProgressLoading(true);
        setHomeLayerProgressError('');
        void (earlyHomeLayerProgress ?? fetchHomeLayerProgress(savedToken, activeProject.id))
          .then((homeLayerRows) => {
            setHomeLayerProgressRows(
              homeLayerRows as unknown as HomeLayerProgressRow[],
            );
          })
          .catch((progressErr) => {
            setHomeLayerProgressRows([]);
            setHomeLayerProgressError(
              progressErr instanceof Error
                ? progressErr.message
                : 'Failed to load layer progress',
            );
          })
          .finally(() => {
            setHomeLayerProgressLoading(false);
          });

        // Applications are already present on the flat rows. The old code called
        // fetchFlatApplications(), which internally fetched the full flat dataset
        // a second time. Derive the list locally and remove that duplicate request.
        // Started above, in parallel with the directory request.
        const [layerData, flatData] = await earlyProjectionData!;

        const applicationData = Array.from(
          new Set(
            flatData
              .map((flat) => flat.Application)
              .filter((application): application is string => Boolean(application)),
          ),
        ).sort();

        setLayers(layerData);
        setFlats(flatData);
        setApplicationOptions(['All', ...applicationData]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load dashboard data';

        setError(message);

        if (
          message.toLowerCase().includes('unauthorized') ||
          message.toLowerCase().includes('token') ||
          message.toLowerCase().includes('expired')
        ) {
          localStorage.removeItem('zos_access_token');
          localStorage.removeItem('zos_user');
          localStorage.removeItem('zos_selected_project');
          localStorage.removeItem('zos_selected_project_name');
          router.push('/');
        }
      } finally {
        setLoading(false);
      }
    }

    initializeDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!token || (activeTable !== 'layers' && activeTable !== 'home')) {
      return;
    }

    if (skipInitialLayerReloadRef.current) {
      skipInitialLayerReloadRef.current = false;
      return;
    }

    async function reloadLayersOnInputChange() {
      setTableLoading(true);
      setError('');

      try {
        const layerData = await fetchProjectionLayers(token, {
          projectId:
            project?.id && !LEGACY_PROJECTION_PROJECT_IDS.includes(project.id)
              ? project.id
              : undefined,
          dailyPainters,
          workMode,
          limit: AGGREGATE_FETCH_LIMIT,
        });

        setLayers(layerData);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to refresh layers';

        setError(message);
      } finally {
        setTableLoading(false);
      }
    }

    reloadLayersOnInputChange();
  }, [dailyPainters, workMode, token, activeTable, project?.id]);

  useEffect(() => {
    const projectId = project?.id;

    const boqEnabled =
      BOQ_ENABLED_PROJECT_IDS.includes(projectId || '') ||
      Boolean(projectDirectoryRow?.capabilities.boq);

    if (
      !token ||
      activeTable !== 'home' ||
      !projectId ||
      !boqEnabled
    ) {
      setBoqCosting([]);
      setBoqError('');
      setBoqLoading(false);
      return;
    }

    let cancelled = false;

    async function loadBoqCosting(currentProjectId: string) {
      setBoqLoading(true);
      setBoqError('');

      try {
        const rows = await fetchBoqCosting(
          token,
          currentProjectId,
        );

        if (!cancelled) {
          setBoqCosting(rows);
        }
      } catch (err) {
        if (!cancelled) {
          setBoqCosting([]);

          setBoqError(
            err instanceof Error
              ? err.message
                  .replace(/Cost \/ BOQ/g, 'Cost / Work Order')
                  .replace(/\bBOQ\b/g, 'Work Order')
              : 'Failed to load Work Order costing',
          );
        }
      } finally {
        if (!cancelled) {
          setBoqLoading(false);
        }
      }
    }

    loadBoqCosting(projectId);

    return () => {
      cancelled = true;
    };
  }, [activeTable, project?.id, projectDirectoryRow?.capabilities.boq, token]);

  async function reloadFlats() {
    if (!token) {
      return;
    }

    setTableLoading(true);
    setError('');

    try {
      const flatData = await fetchProjectionFlats(token, {
        projectId:
          project?.id && !LEGACY_PROJECTION_PROJECT_IDS.includes(project.id)
            ? project.id
            : undefined,
        limit: AGGREGATE_FETCH_LIMIT,
      });
      setFlats(flatData);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to refresh flats';

      setError(message);
    } finally {
      setTableLoading(false);
    }
  }

  async function reloadLayers() {
    if (!token) {
      return;
    }

    setTableLoading(true);
    setError('');

    try {
      const layerData = await fetchProjectionLayers(token, {
        projectId:
          project?.id && !LEGACY_PROJECTION_PROJECT_IDS.includes(project.id)
            ? project.id
            : undefined,
        dailyPainters,
        workMode,
        limit: AGGREGATE_FETCH_LIMIT,
      });
      setLayers(layerData);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to refresh layers';

      setError(message);
    } finally {
      setTableLoading(false);
    }
  }

  async function reloadHomeLayerProgress() {
    const projectId = project?.id;

    if (!token || !projectId) {
      return;
    }

    setHomeLayerProgressLoading(true);
    setHomeLayerProgressError('');

    try {
      const rows = (await fetchHomeLayerProgress(
        token,
        projectId,
      )) as unknown as HomeLayerProgressRow[];
      setHomeLayerProgressRows(rows);
    } catch (err) {
      setHomeLayerProgressError(
        err instanceof Error
          ? err.message
          : 'Failed to refresh application progress',
      );
    } finally {
      setHomeLayerProgressLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem('zos_access_token');
    localStorage.removeItem('zos_user');
    localStorage.removeItem('zos_selected_project');
    localStorage.removeItem('zos_selected_project_name');

    router.push('/');
  }

  function changeProject() {
    localStorage.removeItem('zos_selected_project');
    localStorage.removeItem('zos_selected_project_name');

    router.push('/projects');
  }

  function allowedView(table: ActiveTable): ActiveTable {
    return isProjectManager && !PROJECT_MANAGER_ALLOWED_VIEWS.has(table)
      ? PROJECT_MANAGER_DEFAULT_VIEW
      : table;
  }

  // Sidebar clicks change the address; the effect below then shows the view.
  // This is what makes Back/Forward and refresh land on the same view.
  function selectTab(table: ActiveTable) {
    const nextTable = allowedView(table);
    setMobileSidebarOpen(false);
    setOpenDropdown(null);

    if (nextTable === activeTable) {
      applyTab(nextTable);
      return;
    }

    router.push(projectViewHref(project?.id || routeProjectId, nextTable));
  }

  function applyTab(table: ActiveTable) {
    const nextTable = allowedView(table);

    setActiveTable(nextTable);
    setOpenGroup(groupIdForView(nextTable));
    setApplicationFilter('All');
    setMobileSidebarOpen(false);
    setOpenDropdown(null);

    if (nextTable === 'flats') reloadFlats();
    if (nextTable === 'layers') reloadLayers();
    if (nextTable === 'home') {
      reloadFlats();
      reloadLayers();
      reloadHomeLayerProgress();
    }
  }

  function toggleGroup(groupId: string) {
    setOpenGroup((current) => (current === groupId ? '' : groupId));
  }

  function toggleDropdown(name: 'project' | 'alerts' | 'user') {
    setOpenDropdown((current) => (current === name ? null : name));
  }

  function switchProject(projectId: string) {
    const selectedProject = availableProjects.find(
      (item) => item.id === projectId,
    );

    localStorage.setItem('zos_selected_project', projectId);

    if (selectedProject) {
      localStorage.setItem('zos_selected_project_name', selectedProject.name);
    }

    // A different project is a different address; the workspace layout
    // remounts for it, which re-runs the init flow against the new project.
    router.push(projectViewHref(projectId, activeTable));
  }

  const isProjectManager = isProjectManagerRole(user?.role);

  // The address changed (sidebar click, Back/Forward, or a typed link):
  // show that view. The first render already shows routeView.
  const previousRouteViewRef = useRef(routeView);
  useEffect(() => {
    if (previousRouteViewRef.current === routeView) return;
    previousRouteViewRef.current = routeView;

    if (isProjectManager && !PROJECT_MANAGER_ALLOWED_VIEWS.has(routeView)) {
      router.replace(projectViewHref(routeProjectId, PROJECT_MANAGER_DEFAULT_VIEW));
      return;
    }

    applyTab(routeView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeView]);

  const roleLabel = isProjectManager
    ? 'Project Manager'
    : user?.role || 'viewer';

  const initials = (user?.username || '?')
    .split(/[.\s_-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  useEffect(() => {
    if (!isProjectManager) return;

    if (!PROJECT_MANAGER_ALLOWED_VIEWS.has(activeTable)) {
      setActiveTable(PROJECT_MANAGER_DEFAULT_VIEW);
    }

    if (openGroup !== 'assignment') {
      setOpenGroup('assignment');
    }
  }, [activeTable, isProjectManager, openGroup]);

  const visibleFlats = useMemo(() => {
    if (applicationFilter === 'All') return flats;
    return flats.filter((f) => f.Application === applicationFilter);
  }, [flats, applicationFilter]);

  // Overview mixes existing Projection data for planning widgets with
  // project-scoped indr layer-status rows for all progress KPIs/drill-downs. Each figure notes what it actually is, since a few of
  // these are easy to oversell as more than they are.
  const overview = useMemo(() => {
    // Progress KPIs come from the project-scoped indr layer-status view,
    // not from the public Projection Engine tables. Only billable layers
    // contribute to the progress percentage.
    const billableProgressRows = homeLayerProgressRows.filter(
      (row) => row.billable === true,
    );
    const totalArea = billableProgressRows.reduce(
      (sum, row) => sum + (Number(row.total_area) || 0),
      0,
    );
    const doneArea = billableProgressRows.reduce(
      (sum, row) => sum + (Number(row.done_area) || 0),
      0,
    );
    const overallProgressPct = totalArea > 0 ? (doneArea / totalArea) * 100 : 0;

    // Progress by Application uses the existing project-scoped Assignment
    // layer-status endpoint (indr schema). It returns the current layer rows
    // with project_id, billable, total_area, done_area and wkdpct. Summary
    // percentages are area-weighted for billable layers; every layer remains
    // visible in the flat drill-down.
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

    homeLayerProgressRows.forEach((row) => {
      const application = String(row.application || 'Unassigned').trim();
      const flatId = String(row.flat_id || row.flat || 'Unassigned').trim();
      const flatLabel = flatId || 'Unassigned';
      const pct = clampProgress(row.wkdpct);
      const billable = row.billable === true;
      const rowTotalArea = Number(row.total_area) || 0;
      const rowDoneArea = Number(row.done_area) || 0;
      const { floorLabel, floorSort } = getFloorInfoFromFlatCode(flatId);

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
        layerId: row.layer_id,
        layerName: row.layer_name || row.layer_id,
        order: Number(row.layer_order) || 999999,
        billable,
        totalArea: rowTotalArea,
        doneArea: rowDoneArea,
        pct,
        status: getLayerProgressStatus(pct),
      });

      if (billable) {
        applicationEntry.billableTotalArea += rowTotalArea;
        applicationEntry.billableDoneArea += rowDoneArea;
        applicationEntry.billableLayerCount += 1;
        floorEntry.billableTotalArea += rowTotalArea;
        floorEntry.billableDoneArea += rowDoneArea;
        floorEntry.billableLayerCount += 1;
        flatEntry.billableTotalArea += rowTotalArea;
        flatEntry.billableDoneArea += rowDoneArea;
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
      .map(([application, applicationEntry]) => ({
        application,
        pct:
          applicationEntry.billableTotalArea > 0
            ? (applicationEntry.billableDoneArea /
                applicationEntry.billableTotalArea) *
              100
            : 0,
        billableLayerCount: applicationEntry.billableLayerCount,
        completedBillableLayerCount:
          applicationEntry.completedBillableLayerCount,
        floors: Array.from(applicationEntry.floors.entries())
          .map(([floorLabel, floorEntry]) => ({
            floorLabel,
            floorSort: floorEntry.floorSort,
            pct:
              floorEntry.billableTotalArea > 0
                ? (floorEntry.billableDoneArea / floorEntry.billableTotalArea) * 100
                : 0,
            billableLayerCount: floorEntry.billableLayerCount,
            flats: Array.from(floorEntry.flats.entries())
              .map(([flatId, flatEntry]) => ({
                flatId,
                flatLabel: flatEntry.flatLabel,
                pct:
                  flatEntry.billableTotalArea > 0
                    ? (flatEntry.billableDoneArea / flatEntry.billableTotalArea) * 100
                    : 0,
                billableLayerCount: flatEntry.billableLayerCount,
                completedBillableLayerCount:
                  flatEntry.completedBillableLayerCount,
                layers: [...flatEntry.layers].sort(
                  (a, b) => a.order - b.order || a.layerName.localeCompare(b.layerName),
                ),
              }))
              .sort((a, b) => {
                const aDigits = Number(a.flatId.replace(/\D/g, ''));
                const bDigits = Number(b.flatId.replace(/\D/g, ''));

                if (Number.isFinite(aDigits) && Number.isFinite(bDigits)) {
                  return aDigits - bDigits;
                }

                return a.flatId.localeCompare(b.flatId);
              }),
          }))
          .sort((a, b) => a.floorSort - b.floorSort),
      }))
      .sort((a, b) => a.application.localeCompare(b.application));

    const applicationProgress = applicationProgressDetails.map((detail) => ({
      application: detail.application,
      pct: detail.pct,
      billableLayerCount: detail.billableLayerCount,
      completedBillableLayerCount: detail.completedBillableLayerCount,
    }));

    // Labour gap: what the plan calls for vs. what the simulator input says
    // is available. "Available" is a manual input here, not a real roster —
    // there's no BrushLine attendance data behind this yet.
    const paintersNeeded = layers.reduce(
      (sum, l) => sum + (Number(l.Painter_Count_Required) || 0),
      0,
    );
    const labourGap = paintersNeeded - dailyPainters;

    // Material summary: grouped totals of what's already on each layer.
    // This is the plan (Material_Required), not current stock — there's no
    // field anywhere for on-hand inventory, so there's no "days left" figure
    // to compute honestly.
    const materialMap = new Map<
      string,
      { required: number; cost: number }
    >();
    layers.forEach((l) => {
      if (!l.Material_Name) return;
      const entry = materialMap.get(l.Material_Name) || {
        required: 0,
        cost: 0,
      };
      entry.required += Number(l.Material_Required) || 0;
      entry.cost += Number(l.Material_Cost) || 0;
      materialMap.set(l.Material_Name, entry);
    });
    const materialSummary = Array.from(materialMap.entries())
      .map(([name, { required, cost }]) => ({ name, required, cost }))
      .sort((a, b) => b.cost - a.cost);

    // Needs-attention lists — sorting/filtering on real fields, not a
    // recommendation engine. Labeled as such in the UI.
    const notStarted = flats
      .filter(
        (f) =>
          (Number(f.Flat_Completion_Pct) || 0) === 0 &&
          (Number(f.Billable_Total_Area) || 0) > 0,
      )
      .sort(
        (a, b) =>
          (Number(b.Billable_Total_Area) || 0) -
          (Number(a.Billable_Total_Area) || 0),
      )
      .slice(0, 5);

    const almostDone = flats
      .filter((f) => {
        const pct = Number(f.Flat_Completion_Pct) || 0;
        return pct >= 90 && pct < 100;
      })
      .sort(
        (a, b) =>
          (Number(b.Flat_Completion_Pct) || 0) -
          (Number(a.Flat_Completion_Pct) || 0),
      )
      .slice(0, 5);

    const longestRemaining = layers
      .filter((l) => (Number(l.Remaining_Area) || 0) > 0)
      .sort(
        (a, b) => (Number(b.Days_Required) || 0) - (Number(a.Days_Required) || 0),
      )
      .slice(0, 5);

    // Scenario simulator: total remaining labour-hours across incomplete
    // layers, divided by (painters x 8hr day). This is a static what-if on
    // current totals, not a time-series forecast — it assumes work can be
    // freely parallelized across painters and ignores sequencing/travel
    // between flats, so treat it as a ballpark, not a finish date.
    const remainingLabourHours = layers
      .filter((l) => (Number(l.Remaining_Area) || 0) > 0)
      .reduce((sum, l) => sum + (Number(l.Labour_Hours_Required) || 0), 0);
    const estimatedDaysToClear =
      dailyPainters > 0 ? remainingLabourHours / (dailyPainters * 8) : 0;

    return {
      totalArea,
      doneArea,
      overallProgressPct,
      applicationProgress,
      applicationProgressDetails,
      paintersNeeded,
      labourGap,
      materialSummary,
      notStarted,
      almostDone,
      longestRemaining,
      remainingLabourHours,
      estimatedDaysToClear,
    };
    }, [flats, layers, homeLayerProgressRows, dailyPainters]);

  const billingViewActive = isBillingViewId(activeTable);
  const assignmentViewActive = isAssignmentViewId(activeTable);
  const currentProjectId = project?.id || '';
  const isBillingEnabledProject =
    BILLING_ENABLED_PROJECT_IDS.includes(currentProjectId) ||
    Boolean(projectDirectoryRow?.capabilities.billing);
  const isAssignmentEnabledProject =
    ASSIGNMENT_ENABLED_PROJECT_IDS.includes(currentProjectId) ||
    Boolean(projectDirectoryRow?.capabilities.assignment);
  const isBoqEnabledProject =
    BOQ_ENABLED_PROJECT_IDS.includes(currentProjectId) ||
    Boolean(projectDirectoryRow?.capabilities.boq);

  const visibleNavigationGroups = useMemo(
    () => isProjectManager ? [PROJECT_MANAGER_NAVIGATION_GROUP] : NAV_GROUPS,
    [isProjectManager],
  );

  return (
    <main className={`nightshift-dashboard flex flex-col overflow-hidden bg-slate-950 font-body text-white ${embedded ? 'h-full' : 'h-screen'}`}>
      {/* ---------------- Topbar (the app shell draws its own when embedded) ---------------- */}
      {!embedded && (<>
      <header className="nightshift-topbar flex h-14 shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 md:gap-3 md:px-4">
        <button
          type="button"
          onClick={() => {
            const currentGroup = visibleNavigationGroups.find((group) =>
              group.items?.some((item) => item.id === activeTable),
            );

            if (currentGroup) {
              setOpenGroup(currentGroup.id);
            }

            setOpenDropdown(null);
            setMobileSidebarOpen(true);
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800 md:hidden"
          aria-label="Open navigation menu"
          aria-controls="mobile-dashboard-navigation"
          aria-expanded={mobileSidebarOpen}
        >
          <span className="flex flex-col gap-1" aria-hidden="true">
            <span className="h-0.5 w-4 rounded bg-current" />
            <span className="h-0.5 w-4 rounded bg-current" />
            <span className="h-0.5 w-4 rounded bg-current" />
          </span>
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <img
            src="/zobocon-mark.png"
            alt="Zobocon"
            className="h-8 w-8 object-contain"
          />
          <span className="font-display text-base font-bold">ZOS</span>
          <span className="hidden rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:inline-flex">
            {roleLabel}
          </span>
        </div>

        <div className="hidden h-6 w-px bg-slate-800 sm:block" />

        {/* Admin/viewer users keep the project switcher. Project managers are
            locked to the Indradhanush site assignment workspace. */}
        {!isProjectManager ? (
          <div className="relative hidden sm:block">
          <button
            onClick={() => toggleDropdown('project')}
            className="flex max-w-[150px] items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs sm:max-w-none sm:px-3"
          >
            <span className="hidden text-slate-500 sm:inline">PROJECT</span>
            <span className="truncate font-semibold">{project?.name || 'Select'}</span>
            <span className="text-slate-500">&#9662;</span>
          </button>

          {openDropdown === 'project' && (
            <div className="absolute left-0 top-11 z-30 w-56 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl">
              {availableProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => switchProject(p.id)}
                  className={`block w-full rounded-md px-3 py-2 text-left text-xs ${
                    p.id === project?.id
                      ? 'bg-slate-800 font-semibold text-white'
                      : 'text-slate-400 hover:bg-slate-800/60'
                  }`}
                >
                  {p.name}
                </button>
              ))}
              <div className="my-1 h-px bg-slate-800" />
              <button
                onClick={changeProject}
                className="block w-full rounded-md px-3 py-2 text-left text-xs text-cyan-300 hover:bg-slate-800/60"
              >
                Browse all projects
              </button>
            </div>
          )}
          </div>
        ) : (
          <div className="hidden items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs sm:flex">
            <span className="text-slate-500">PROJECT</span>
            <span className="font-semibold">{project?.name || 'Indradhanush'}</span>
          </div>
        )}

        <div className="nightshift-topbar-crumb hidden xl:flex" aria-label="Workspace location">
          <span>{project?.name || 'Project'}</span>
          <span aria-hidden="true">/</span>
          <strong>{visibleNavigationGroups.find((group) => group.items?.some((item) => item.id === activeTable))?.label || 'Workspace'}</strong>
        </div>

        {!isProjectManager && (
          <div className="relative hidden max-w-md flex-1 md:block">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
            &#8981;
          </span>
          {/* Visual only right now — not wired to a search endpoint yet */}
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search flats, painters, invoices, users..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-9 pr-3 text-xs outline-none focus:border-cyan-400"
          />
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => toggleDropdown('alerts')}
              className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
            >
              &#128276;
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" />
            </button>

            {openDropdown === 'alerts' && (
              <div className="absolute right-0 top-11 z-30 w-64 rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs text-slate-400 shadow-xl">
                Governance engine isn&apos;t built yet, so there&apos;s nothing
                real to alert on. This is a placeholder.
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => toggleDropdown('user')}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-200"
            >
              {initials || 'U'}
            </button>

            {openDropdown === 'user' && (
              <div className="absolute right-0 top-11 z-30 w-48 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl">
                <div className="border-b border-slate-800 px-3 py-2">
                  <p className="text-sm font-semibold">{user?.username}</p>
                  <p className="text-xs text-slate-500">{roleLabel}</p>
                </div>
                {String(user?.role || '').trim().toLowerCase() === 'admin' && (
                  <>
                    <button
                      onClick={() => {
                        setOpenDropdown(null);
                        router.push('/admin/project-setup');
                      }}
                      className="mt-1 block w-full rounded-md px-3 py-2 text-left text-xs text-cyan-300 hover:bg-cyan-500/10"
                    >
                      Project Setup
                    </button>
                    <button
                      onClick={() => {
                        setOpenDropdown(null);
                        router.push('/admin/users');
                      }}
                      className="mt-1 block w-full rounded-md px-3 py-2 text-left text-xs text-cyan-300 hover:bg-cyan-500/10"
                    >
                      User Management
                    </button>
                  </>
                )}
                <button
                  onClick={logout}
                  className="mt-1 block w-full rounded-md px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ---------------- Mobile navigation drawer ---------------- */}
      <div
        className={`fixed inset-0 z-[60] md:hidden ${
          mobileSidebarOpen ? '' : 'pointer-events-none'
        }`}
        aria-hidden={!mobileSidebarOpen}
      >
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileSidebarOpen(false)}
          className={`absolute inset-0 bg-slate-950/75 backdrop-blur-sm transition-opacity ${
            mobileSidebarOpen ? 'opacity-100' : 'opacity-0'
          }`}
        />

        <aside
          id="mobile-dashboard-navigation"
          className={`absolute inset-y-0 left-0 z-10 flex w-[min(20rem,88vw)] flex-col border-r border-slate-700 bg-slate-900 shadow-2xl transition-transform duration-200 ease-out ${
            mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Dashboard navigation"
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-800 px-4">
            <img
              src="/zobocon-mark.png"
              alt="Zobocon"
              className="h-8 w-8 object-contain"
            />
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-bold text-white">ZOS</p>
              <p className="truncate text-[11px] text-slate-500">
                {project?.name || 'Select project'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-xl leading-none text-slate-300 hover:bg-slate-800"
              aria-label="Close navigation menu"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <SidebarNavigation
              groups={visibleNavigationGroups}
              openGroup={openGroup}
              activeTable={activeTable}
              onToggleGroup={toggleGroup}
              onSelect={selectTab}
              mobile
            />
          </div>

          <div className="shrink-0 border-t border-slate-800 p-3">
            <div className="mb-2 rounded-lg bg-slate-950 px-3 py-2">
              <p className="truncate text-xs font-semibold text-slate-200">
                {user?.username || 'User'}
              </p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                {roleLabel}
              </p>
            </div>
            {isProjectManager ? (
              <button
                type="button"
                onClick={logout}
                className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20"
              >
                Logout
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={changeProject}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-cyan-300 hover:bg-slate-800"
                >
                  Projects
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      </>)}

      {/* click-away layer for the topbar dropdowns */}
      {openDropdown && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setOpenDropdown(null)}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* ---------------- Desktop sidebar (hidden when embedded in the app shell) ---------------- */}
        {!embedded && <aside className="nightshift-sidebar hidden w-64 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-900 p-3 md:block">
          <div className="nightshift-sidebar-brand" aria-label="Zobocon Operating System">
            <span className="nightshift-sidebar-mark">Z</span>
            <span><strong>ZOS</strong><small>Zobocon · Operations</small></span>
          </div>
          {isProjectManager ? (
            <div className="nightshift-project-switch" aria-label="Current project">
              <span className="nightshift-mini-label">PROJECT</span>
              <strong>{project?.name || 'Indradhanush'}</strong>
              <small>Project workspace</small>
            </div>
          ) : (
            <button type="button" className="nightshift-project-switch" onClick={changeProject} title="Browse projects">
              <span className="nightshift-mini-label">CURRENT PROJECT</span>
              <strong>{project?.name || 'Select project'} <span aria-hidden="true">⌄</span></strong>
              <small>Browse all projects</small>
            </button>
          )}
          <SidebarNavigation
            groups={visibleNavigationGroups}
            openGroup={openGroup}
            activeTable={activeTable}
            onToggleGroup={toggleGroup}
            onSelect={selectTab}
          />
        </aside>}

        {/* ---------------- Main ---------------- */}
      <section className="nightshift-dashboard-content flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
        <NightshiftTransition viewKey={activeTable} label={activeTable.replace(/-/g, ' ')} />
        {subNav}
        {!assignmentViewActive && (
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-bold">
                {billingViewActive
                  ? getBillingViewTitle(activeTable)
                  : activeTable === 'home'
                    ? 'Overview'
                    : activeTable === 'dimensions'
                      ? 'Dimension'
                      : activeTable === 'work-order-worksheet'
                        ? 'Work Order & Costing'
                      : activeTable === 'flats'
                        ? 'Flat Progress'
                        : 'Projection Summary'}
              </h2>
            </div>
          </div>
        )}

        {error && !billingViewActive && !assignmentViewActive && activeTable !== 'dimensions' && activeTable !== 'work-order-worksheet' && (
  <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
    {error}
  </div>
)}

        {billingViewActive ? (
  <BillingView
  view={activeTable}
  searchQuery={searchQuery}
  token={token}
  projectId={project?.id || ''}
  enabled={isBillingEnabledProject}
/>
) : assignmentViewActive ? (
  <AssignmentView
    view={activeTable}
    searchQuery={searchQuery}
    token={token}
    projectId={project?.id || ''}
    username={user?.username}
    onNavigate={selectTab}
  />
) : activeTable === 'dimensions' ? (
  <DimensionsView token={token} projectId={project?.id || ''} />
) : activeTable === 'work-order-worksheet' ? (
  <WorkOrderWorksheet token={token} projectId={project?.id || ''} />
) : loading ? (
  <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-slate-300">
    Loading project data...
  </div>
) : activeTable === 'home' ? (
          <HomeOverview
            overview={overview}
            dailyPainters={dailyPainters}
            setDailyPainters={setDailyPainters}
            workMode={workMode}
            setWorkMode={setWorkMode}
            boqEnabled={isBoqEnabledProject}
            boqRows={boqCosting}
            boqLoading={boqLoading}
            boqError={boqError}
            progressLoading={homeLayerProgressLoading}
            progressError={homeLayerProgressError}
            token={token}
            projectId={project?.id || ''}
            projectionLayers={layers}
            assignmentMaterialEnabled={isAssignmentEnabledProject}
          />
        ) : activeTable === 'flats' ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900">
            <div className="flex flex-wrap gap-2 border-b border-slate-800 p-3">
              {applicationOptions.map((app) => (
                <button
                  key={app}
                  onClick={() => setApplicationFilter(app)}
                  className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium ${
                    applicationFilter === app
                      ? 'bg-slate-700 text-white'
                      : 'border border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {app === 'All' ? 'All applications' : app}
                </button>
              ))}
            </div>

            <FlatsTable flats={visibleFlats} loading={tableLoading} />
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-900">
            <div className="flex flex-wrap items-end gap-3 border-b border-slate-800 p-3">
              <div>
                <label className="mb-1 block text-[11px] text-slate-500">
                  Daily Painters
                </label>
                <input
                  type="number"
                  min={1}
                  value={dailyPainters}
                  onChange={(event) =>
                    setDailyPainters(Number(event.target.value) || 1)
                  }
                  className="w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-500">
                  Work Mode
                </label>
                <select
                  value={workMode}
                  onChange={(event) => setWorkMode(event.target.value)}
                  className="w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none focus:border-cyan-400"
                >
                  <option value="Machine">Machine</option>
                  <option value="Manual">Manual</option>
                  <option value="Both">Both</option>
                </select>
              </div>
            </div>

            <LayersTable layers={layers} loading={tableLoading} />
          </div>
        )}
      </section>
      </div>
    </main>
  );
}

// No row-click, no selection state, no right-side detail panel — the
// previous version's split layout is gone on purpose.
// Everything here reads from the `overview` object computed in the parent —
// sums, group-bys, and sorts on data already in memory. Nothing here is a
// forecast, a health score, or AI-generated; see inline labels for what each
// number actually is.
function HomeOverview({
  overview,
  dailyPainters,
  setDailyPainters,
  workMode,
  setWorkMode,
  boqEnabled,
  boqRows,
  boqLoading,
  boqError,
  progressLoading,
  progressError,
  token,
  projectId,
  projectionLayers,
  assignmentMaterialEnabled,
}: {
  overview: {
    totalArea: number;
    doneArea: number;
    overallProgressPct: number;
    applicationProgress: {
      application: string;
      pct: number;
      billableLayerCount: number;
      completedBillableLayerCount: number;
    }[];
    applicationProgressDetails: ApplicationProgressDetail[];
    paintersNeeded: number;
    labourGap: number;
    materialSummary: { name: string; required: number; cost: number }[];
    notStarted: ProjectionFlat[];
    almostDone: ProjectionFlat[];
    longestRemaining: ProjectionLayer[];
    remainingLabourHours: number;
    estimatedDaysToClear: number;
  };
  dailyPainters: number;
  setDailyPainters: (value: number) => void;
  workMode: string;
  setWorkMode: (value: string) => void;
  boqEnabled: boolean;
  boqRows: BoqCostingRow[];
  boqLoading: boolean;
  boqError: string;
  progressLoading: boolean;
  progressError: string;
  token: string;
  projectId: string;
  projectionLayers: ProjectionLayer[];
  assignmentMaterialEnabled: boolean;
}) {
  const [expandedProgressApplications, setExpandedProgressApplications] =
    useState<Record<string, boolean>>({});
  const [expandedProgressFlats, setExpandedProgressFlats] =
    useState<Record<string, boolean>>({});
    const [selectedMaterialApplication, setSelectedMaterialApplication] =
    useState('');
  const [selectedMaterialLayer, setSelectedMaterialLayer] = useState('');
  const [selectedMaterialFlats, setSelectedMaterialFlats] = useState<string[]>([]);

  const [selectedMaterialSuggestion, setSelectedMaterialSuggestion] =
    useState<AssignmentMaterialSuggestion | null>(null);
  const [materialSuggestionLoading, setMaterialSuggestionLoading] =
    useState(false);
  const [materialSuggestionError, setMaterialSuggestionError] = useState('');

  const materialRequirementRows = useMemo(() => {
    const rows: {
      application: string;
      flatId: string;
      flatLabel: string;
      layerId: string;
      layerName: string;
      order: number;
      totalArea: number;
      doneArea: number;
      remainingArea: number;
      wkdpct: number;
    }[] = [];

    overview.applicationProgressDetails.forEach((applicationDetail) => {
      applicationDetail.floors.forEach((floor) => {
        floor.flats.forEach((flat) => {
          flat.layers.forEach((layer) => {
            const totalArea = Number(layer.totalArea) || 0;
            const doneArea = Number(layer.doneArea) || 0;

            rows.push({
              application: applicationDetail.application,
              flatId: flat.flatId,
              flatLabel: flat.flatLabel,
              layerId: layer.layerId,
              layerName: layer.layerName,
              order: layer.order,
              totalArea,
              doneArea,
              remainingArea: Math.max(totalArea - doneArea, 0),
              wkdpct: layer.pct,
            });
          });
        });
      });
    });

    return rows;
  }, [overview.applicationProgressDetails]);

  const materialApplicationOptions = useMemo(() => {
    return Array.from(
      new Set(materialRequirementRows.map((row) => row.application)),
    ).sort();
  }, [materialRequirementRows]);

  const materialLayerOptions = useMemo(() => {
    if (!selectedMaterialApplication) return [];

    return Array.from(
      new Map(
        materialRequirementRows
          .filter(
            (row) =>
              row.application.trim().toUpperCase() ===
              selectedMaterialApplication.trim().toUpperCase(),
          )
          .map((row) => [
            row.layerName,
            {
              layerId: row.layerId,
              layerName: row.layerName,
              order: row.order,
            },
          ]),
      ).values(),
    ).sort(
      (a, b) => a.order - b.order || a.layerName.localeCompare(b.layerName),
    );
  }, [materialRequirementRows, selectedMaterialApplication]);

  const materialFlatOptions = useMemo(() => {
    if (!selectedMaterialApplication || !selectedMaterialLayer) return [];

    return Array.from(
      new Map(
        materialRequirementRows
          .filter(
            (row) =>
              row.application.trim().toUpperCase() ===
                selectedMaterialApplication.trim().toUpperCase() &&
              row.layerName.trim().toUpperCase() ===
                selectedMaterialLayer.trim().toUpperCase(),
          )
          .map((row) => [
            row.flatId,
            {
              flatId: row.flatId,
              flatLabel: row.flatLabel || row.flatId,
            },
          ]),
      ).values(),
    ).sort((a, b) => {
      const aNum = Number(a.flatId.replace(/\D/g, ''));
      const bNum = Number(b.flatId.replace(/\D/g, ''));

      if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
        return aNum - bNum;
      }

      return a.flatId.localeCompare(b.flatId);
    });
  }, [
    materialRequirementRows,
    selectedMaterialApplication,
    selectedMaterialLayer,
  ]);

  const selectedMaterialRequirement = useMemo(() => {
    if (
      !selectedMaterialApplication ||
      !selectedMaterialLayer ||
      selectedMaterialFlats.length === 0
    ) {
      return null;
    }

    const selectedRows = materialRequirementRows.filter(
      (row) =>
        row.application.trim().toUpperCase() ===
          selectedMaterialApplication.trim().toUpperCase() &&
        row.layerName.trim().toUpperCase() ===
          selectedMaterialLayer.trim().toUpperCase() &&
        selectedMaterialFlats.includes(row.flatId),
    );

    if (selectedRows.length === 0) {
      return null;
    }

    return {
      application: selectedMaterialApplication,
      layerName: selectedMaterialLayer,
      flatCount: selectedRows.length,
      selectedFlatLabels: selectedRows.map((row) => row.flatLabel || row.flatId),
      totalArea: selectedRows.reduce((sum, row) => sum + row.totalArea, 0),
      doneArea: selectedRows.reduce((sum, row) => sum + row.doneArea, 0),
      remainingArea: selectedRows.reduce(
        (sum, row) => sum + row.remainingArea,
        0,
      ),
    };
  }, [
    materialRequirementRows,
    selectedMaterialApplication,
    selectedMaterialLayer,
    selectedMaterialFlats,
  ]);

  function toggleSelectedMaterialFlat(flatId: string) {
    setSelectedMaterialFlats((current) => {
      if (current.includes(flatId)) {
        return current.filter((id) => id !== flatId);
      }

      return [...current, flatId];
    });
  }

  function selectAllMaterialFlats() {
    setSelectedMaterialFlats(materialFlatOptions.map((flat) => flat.flatId));
  }

  function clearSelectedMaterialFlats() {
    setSelectedMaterialFlats([]);
  }

useEffect(() => {
  if (
    !assignmentMaterialEnabled ||
    !token ||
    !projectId ||
    !selectedMaterialApplication ||
    !selectedMaterialLayer
  ) {
    setSelectedMaterialSuggestion(null);
    setMaterialSuggestionError('');
    setMaterialSuggestionLoading(false);
    return;
  }

  let cancelled = false;

  async function loadMaterialSuggestion() {
    setMaterialSuggestionLoading(true);
    setMaterialSuggestionError('');

    try {
      const material = await fetchAssignmentMaterialSuggestion(token, projectId, {
        application: selectedMaterialApplication,
        layerName: selectedMaterialLayer,
      });

      if (!cancelled) {
        setSelectedMaterialSuggestion(material);
      }
    } catch (err) {
      if (!cancelled) {
        setSelectedMaterialSuggestion(null);
        setMaterialSuggestionError(
          err instanceof Error
            ? err.message
            : 'Failed to load material details',
        );
      }
    } finally {
      if (!cancelled) {
        setMaterialSuggestionLoading(false);
      }
    }
  }

  loadMaterialSuggestion();

  return () => {
    cancelled = true;
  };
}, [
  assignmentMaterialEnabled,
  token,
  projectId,
  selectedMaterialApplication,
  selectedMaterialLayer,
]);

  const selectedProjectionMaterial = useMemo(() => {
    if (!selectedMaterialApplication || !selectedMaterialLayer) {
      return null;
    }

    const matchingLayer = projectionLayers.find((layer) => {
      return (
        String(layer.Application || '').trim().toUpperCase() ===
          selectedMaterialApplication.trim().toUpperCase() &&
        String(layer.LAYERName || '').trim().toUpperCase() ===
          selectedMaterialLayer.trim().toUpperCase() &&
        Boolean(layer.Material_Name)
      );
    });

    if (!matchingLayer) {
      return null;
    }

    const remainingArea = Number(matchingLayer.Remaining_Area) || 0;
    const materialRequired = Number(matchingLayer.Material_Required) || 0;

    return {
      materialName: matchingLayer.Material_Name || null,
      coverage:
        remainingArea > 0 && materialRequired > 0
          ? remainingArea / materialRequired
          : 0,
    };
  }, [projectionLayers, selectedMaterialApplication, selectedMaterialLayer]);

  const selectedMaterialSuggestionAny = selectedMaterialSuggestion as
    | (AssignmentMaterialSuggestion & {
        materialName?: string | null;
        material_coverage?: number | null;
      })
    | null;

  const selectedMaterialName =
    selectedMaterialSuggestionAny?.material_name ||
    selectedMaterialSuggestionAny?.materialName ||
    selectedProjectionMaterial?.materialName ||
    '';

  const selectedCoverage =
    Number(
      selectedMaterialSuggestionAny?.coverage ??
        selectedMaterialSuggestionAny?.material_coverage,
    ) || Number(selectedProjectionMaterial?.coverage) || 0;

  const selectedQuantityRequired =
    selectedMaterialRequirement && selectedCoverage > 0
      ? selectedMaterialRequirement.remainingArea / selectedCoverage
      : 0;

  const progressDetailByApplication = useMemo(
    () =>
      new Map(
        overview.applicationProgressDetails.map((detail) => [
          detail.application,
          detail,
        ]),
      ),
    [overview.applicationProgressDetails],
  );

  function toggleProgressApplication(application: string) {
    setExpandedProgressApplications((current) => ({
      ...current,
      [application]: !current[application],
    }));
  }

  function toggleProgressFlat(application: string, flatId: string) {
    const key = `${application}::${flatId}`;
    setExpandedProgressFlats((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  const applicationLayerMaterialSummary = useMemo(() => {
    const grouped = new Map<
      string,
      {
        application: string;
        layerName: string;
        order: number;
        flatIds: Set<string>;
        totalArea: number;
        doneArea: number;
        remainingArea: number;
      }
    >();

    materialRequirementRows.forEach((row) => {
      const key = `${row.application}__${row.layerName}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          application: row.application,
          layerName: row.layerName,
          order: row.order,
          flatIds: new Set<string>(),
          totalArea: 0,
          doneArea: 0,
          remainingArea: 0,
        });
      }

      const existing = grouped.get(key)!;

      existing.flatIds.add(row.flatId);
      existing.totalArea += row.totalArea;
      existing.doneArea += row.doneArea;
      existing.remainingArea += row.remainingArea;
    });

    return Array.from(grouped.values()).sort(
      (a, b) =>
        a.application.localeCompare(b.application) ||
        a.order - b.order ||
        a.layerName.localeCompare(b.layerName),
    );
  }, [materialRequirementRows]);

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Overall Progress
          </p>
          <p className="mt-2 font-display text-3xl font-bold">
            {formatNumber(overview.overallProgressPct)}%
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {formatNumber(overview.doneArea)} / {formatNumber(overview.totalArea)} sqft
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Painters Needed vs Planned
          </p>
          <p className="mt-2 font-display text-3xl font-bold">
            {formatNumber(overview.paintersNeeded)}{' '}
            <span className="text-base font-normal text-slate-500">
              / {formatNumber(dailyPainters)}
            </span>
          </p>

          <p
            className={`mt-1 text-xs ${
              overview.labourGap > 0 ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {overview.labourGap > 0
              ? `Short by ${formatNumber(overview.labourGap)} painters`
              : 'Fully staffed at this input'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Remaining Labour Hours
          </p>
          <p className="mt-2 font-display text-3xl font-bold">
            {formatNumber(overview.remainingLabourHours)}
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500">
            across all incomplete layers
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
  <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
    <div>
      <h3 className="font-display text-sm font-semibold">
        Layer Material Requirement
      </h3>
      <p className="text-[11px] text-slate-500">
        Select one Application, one Layer and multiple Flats to calculate
        combined remaining area and material quantity required.
      </p>
    </div>

    <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-400">
      {materialRequirementRows.length} layers
    </span>
  </div>

  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
    <label className="block">
      <span className="mb-1 block text-[11px] text-slate-500">
        Application
      </span>
      <select
        value={selectedMaterialApplication}
        onChange={(event) => {
          setSelectedMaterialApplication(event.target.value);
          setSelectedMaterialLayer('');
          setSelectedMaterialFlats([]);
          setSelectedMaterialSuggestion(null);
        }}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
      >
        <option value="">Select Application</option>
        {materialApplicationOptions.map((application) => (
          <option key={application} value={application}>
            {application}
          </option>
        ))}
      </select>
    </label>

    <label className="block">
      <span className="mb-1 block text-[11px] text-slate-500">
        Layer
      </span>
      <select
        value={selectedMaterialLayer}
        onChange={(event) => {
          setSelectedMaterialLayer(event.target.value);
          setSelectedMaterialFlats([]);
          setSelectedMaterialSuggestion(null);
        }}
        disabled={!selectedMaterialApplication}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">Select Layer</option>
        {materialLayerOptions.map((layer) => (
          <option key={`${layer.layerId}-${layer.layerName}`} value={layer.layerName}>
            {layer.layerName}
          </option>
        ))}
      </select>
    </label>
  </div>

  <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-xs font-semibold text-slate-300">
          Select Flats
        </p>
        <p className="text-[11px] text-slate-500">
          {selectedMaterialFlats.length} selected
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={selectAllMaterialFlats}
          disabled={!selectedMaterialLayer || materialFlatOptions.length === 0}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-300 hover:border-cyan-400 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Select All
        </button>

        <button
          type="button"
          onClick={clearSelectedMaterialFlats}
          disabled={selectedMaterialFlats.length === 0}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-300 hover:border-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear
        </button>
      </div>
    </div>

    {selectedMaterialApplication && selectedMaterialLayer ? (
      materialFlatOptions.length > 0 ? (
        <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {materialFlatOptions.map((flat) => (
            <label
              key={flat.flatId}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:border-cyan-500/60"
            >
              <input
                type="checkbox"
                checked={selectedMaterialFlats.includes(flat.flatId)}
                onChange={() => toggleSelectedMaterialFlat(flat.flatId)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950"
              />
              <span>{flat.flatLabel || flat.flatId}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="rounded-lg bg-slate-900 p-3 text-xs text-slate-500">
          No flats found for this Application and Layer combination.
        </p>
      )
    ) : (
      <p className="rounded-lg bg-slate-900 p-3 text-xs text-slate-500">
        Select Application and Layer first.
      </p>
    )}
  </div>

  {materialSuggestionLoading && (
    <p className="mt-3 text-xs text-slate-500">
      Loading material details...
    </p>
  )}

  {materialSuggestionError && (
    <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
      {materialSuggestionError}
    </p>
  )}

  {selectedMaterialRequirement ? (
    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-6">
      <div className="rounded-xl bg-slate-950 p-3">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">
          Selected Flats
        </p>
        <p className="mt-1 font-mono text-lg text-slate-100">
          {selectedMaterialRequirement.flatCount}
        </p>
        <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">
          {selectedMaterialRequirement.selectedFlatLabels.join(', ')}
        </p>
      </div>

      <div className="rounded-xl bg-slate-950 p-3">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">
          Total Area
        </p>
        <p className="mt-1 font-mono text-lg text-slate-100">
          {formatNumber(selectedMaterialRequirement.totalArea)} sqft
        </p>
      </div>

      <div className="rounded-xl bg-slate-950 p-3">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">
          Done Area
        </p>
        <p className="mt-1 font-mono text-lg text-emerald-300">
          {formatNumber(selectedMaterialRequirement.doneArea)} sqft
        </p>
      </div>

      <div className="rounded-xl bg-slate-950 p-3">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">
          Remaining Area
        </p>
        <p className="mt-1 font-mono text-lg text-amber-300">
          {formatNumber(selectedMaterialRequirement.remainingArea)} sqft
        </p>
      </div>

      <div className="rounded-xl bg-slate-950 p-3">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">
          Material
        </p>
        <p className="mt-1 text-sm font-semibold text-cyan-300">
          {selectedMaterialName || '-'}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Coverage: {selectedCoverage > 0 ? formatNumber(selectedCoverage) : '-'}
        </p>
      </div>

      <div className="rounded-xl bg-slate-950 p-3">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">
          Qty Required
        </p>
        <p className="mt-1 font-mono text-lg text-cyan-300">
          {selectedCoverage > 0 ? formatNumber(selectedQuantityRequired) : '-'}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Total Remaining Area / Coverage
        </p>
      </div>
    </div>
  ) : (
    <p className="mt-4 rounded-xl bg-slate-950 p-3 text-xs text-slate-500">
      Select Application, Layer and one or more Flats to view material
      requirement.
    </p>
  )}
</div>

<div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
  <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
    <div>
      <h3 className="font-display text-sm font-semibold">
        Application Wise Material Requirement
      </h3>
      <p className="text-[11px] text-slate-500">
        All flats grouped application-wise and layer-wise.
      </p>
    </div>

    <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-400">
      {applicationLayerMaterialSummary.length} rows
    </span>
  </div>

  <div className="overflow-x-auto rounded-xl border border-slate-800">
    <table className="min-w-[1100px] w-full border-collapse text-sm">
      <thead className="bg-slate-950 text-left text-[11px] uppercase tracking-wide text-slate-500">
        <tr>
          <th className="p-3">Application</th>
          <th className="p-3">Layer</th>
          <th className="p-3 text-right">Flats</th>
          <th className="p-3 text-right">Total Area</th>
          <th className="p-3 text-right">Done Area</th>
          <th className="p-3 text-right">Remaining Area</th>
          <th className="p-3">Material Name</th>
          <th className="p-3 text-right">Coverage</th>
          <th className="p-3 text-right">Material Required</th>
        </tr>
      </thead>

      <tbody>
        {applicationLayerMaterialSummary.map((row) => {
          const isSelectedMaterial =
            Boolean(selectedMaterialName || selectedCoverage > 0) &&
            row.application.trim().toUpperCase() ===
              selectedMaterialApplication.trim().toUpperCase() &&
            row.layerName.trim().toUpperCase() ===
              selectedMaterialLayer.trim().toUpperCase();

          const coverage = isSelectedMaterial ? selectedCoverage : 0;

          const materialRequired =
            coverage > 0 ? row.remainingArea / coverage : 0;

          return (
            <tr
              key={`${row.application}-${row.layerName}`}
              className="border-t border-slate-800 hover:bg-slate-800/40"
            >
              <td className="p-3 font-medium text-slate-200">
                {row.application}
              </td>

              <td className="p-3 text-slate-300">{row.layerName}</td>

              <td className="p-3 text-right font-mono text-slate-300">
                {row.flatIds.size}
              </td>

              <td className="p-3 text-right font-mono text-slate-300">
                {formatNumber(row.totalArea)}
              </td>

              <td className="p-3 text-right font-mono text-emerald-300">
                {formatNumber(row.doneArea)}
              </td>

              <td className="p-3 text-right font-mono text-amber-300">
                {formatNumber(row.remainingArea)}
              </td>

              <td className="p-3 text-cyan-300">
                {isSelectedMaterial
                  ? selectedMaterialName || '-'
                  : 'Select this app/layer above'}
              </td>

              <td className="p-3 text-right font-mono text-slate-300">
                {coverage > 0 ? formatNumber(coverage) : '-'}
              </td>

              <td className="p-3 text-right font-mono text-cyan-300">
                {coverage > 0 ? formatNumber(materialRequired) : '-'}
              </td>
            </tr>
          );
        })}

        {applicationLayerMaterialSummary.length === 0 && (
          <tr>
            <td colSpan={9} className="p-4 text-center text-xs text-slate-500">
              No material requirement data available.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
</div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Progress by application - sourced only from indr.layer */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-1 font-display text-sm font-semibold">
            Progress by Application
          </h3>
          <p className="mb-3 text-[11px] text-slate-500">
            Project-specific progress from indr.layer. Application, floor and
            flat percentages use billable layer wkdpct; expand a flat to see
            every layer and its current status.
          </p>

          {progressLoading && (
            <p className="mb-3 text-xs text-slate-500">Loading layer progress…</p>
          )}

          {progressError && (
            <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
              {progressError}
            </p>
          )}

          <div className="space-y-3">
            {overview.applicationProgress.map((row) => {
              const detail = progressDetailByApplication.get(row.application);
              const isExpanded = Boolean(
                expandedProgressApplications[row.application],
              );

              return (
                <div
                  key={row.application}
                  className="rounded-xl border border-slate-800/80 bg-slate-950/30 p-2"
                >
                  <button
                    type="button"
                    onClick={() => toggleProgressApplication(row.application)}
                    className="w-full rounded-lg p-1 text-left transition hover:bg-slate-800/60"
                    aria-expanded={isExpanded}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-2 text-slate-300">
                        <span
                          className={`shrink-0 text-[10px] text-slate-500 transition-transform ${
                            isExpanded ? 'rotate-90' : ''
                          }`}
                          aria-hidden="true"
                        >
                          &gt;
                        </span>
                        <span className="truncate font-semibold">
                          {row.application}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-500">
                          {row.completedBillableLayerCount}/{row.billableLayerCount} billable layers complete
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-slate-400">
                        {formatNumber(row.pct)}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-cyan-500"
                        style={{ width: `${Math.min(row.pct, 100)}%` }}
                      />
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
                      {!detail || detail.floors.length === 0 ? (
                        <p className="px-2 text-xs text-slate-500">
                          No indr.layer rows found for this application.
                        </p>
                      ) : (
                        detail.floors.map((floor) => (
                          <div
                            key={floor.floorLabel}
                            className="rounded-lg border border-slate-800 bg-slate-950/50 p-2"
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div>
                                <p className="text-xs font-semibold text-slate-200">
                                  {floor.floorLabel}
                                </p>
                                <p className="text-[10px] text-slate-500">
                                  {floor.flats.length} location{floor.flats.length === 1 ? '' : 's'} · {floor.billableLayerCount} billable layers
                                </p>
                              </div>
                              <span className="rounded-full border border-slate-700 px-2 py-0.5 font-mono text-[11px] text-cyan-300">
                                {formatNumber(floor.pct)}%
                              </span>
                            </div>

                            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full rounded-full bg-cyan-500"
                                style={{ width: `${Math.min(floor.pct, 100)}%` }}
                              />
                            </div>

                            <div className="space-y-1.5">
                              {floor.flats.map((flat) => {
                                const flatKey = `${row.application}::${flat.flatId}`;
                                const flatExpanded = Boolean(
                                  expandedProgressFlats[flatKey],
                                );

                                return (
                                  <div
                                    key={flat.flatId}
                                    className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70"
                                  >
                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggleProgressFlat(
                                          row.application,
                                          flat.flatId,
                                        )
                                      }
                                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-800/60"
                                      aria-expanded={flatExpanded}
                                    >
                                      <span
                                        className={`text-[10px] text-slate-500 transition-transform ${
                                          flatExpanded ? 'rotate-90' : ''
                                        }`}
                                      >
                                        &gt;
                                      </span>
                                      <span className="min-w-0 flex-1 font-mono text-xs text-cyan-400">
                                        {flat.flatLabel}
                                      </span>
                                      <span className="hidden text-[10px] text-slate-500 sm:inline">
                                        {flat.completedBillableLayerCount}/{flat.billableLayerCount} complete
                                      </span>
                                      <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-slate-800 sm:block">
                                        <div
                                          className="h-full rounded-full bg-cyan-500"
                                          style={{
                                            width: `${Math.min(flat.pct, 100)}%`,
                                          }}
                                        />
                                      </div>
                                      <span className="w-14 text-right font-mono text-xs text-slate-300">
                                        {formatNumber(flat.pct)}%
                                      </span>
                                    </button>

                                    {flatExpanded && (
                                      <div className="border-t border-slate-800">
                                        <div className="max-h-64 overflow-auto">
                                          <table className="w-full min-w-[560px] border-collapse text-xs">
                                            <thead className="sticky top-0 bg-slate-950 text-left text-[10px] uppercase tracking-wide text-slate-500">
                                              <tr>
                                                <th className="p-2">Layer</th>
                                                <th className="p-2">Order</th>
                                                <th className="p-2">Type</th>
                                                <th className="p-2">Progress</th>
                                                <th className="p-2">Status</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {flat.layers.map((layer) => (
                                                <tr
                                                  key={layer.layerId}
                                                  className="border-t border-slate-800"
                                                >
                                                  <td className="p-2 text-slate-200">
                                                    {layer.layerName}
                                                  </td>
                                                  <td className="p-2 font-mono text-slate-500">
                                                    {layer.order >= 999999
                                                      ? '—'
                                                      : layer.order}
                                                  </td>
                                                  <td className="p-2">
                                                    <span
                                                      className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                                        layer.billable
                                                          ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                                                          : 'border-slate-700 bg-slate-800 text-slate-400'
                                                      }`}
                                                    >
                                                      {layer.billable
                                                        ? 'Billable'
                                                        : 'Non-billable'}
                                                    </span>
                                                  </td>
                                                  <td className="p-2">
                                                    <div className="flex items-center gap-2">
                                                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-800">
                                                        <div
                                                          className="h-full rounded-full bg-cyan-500"
                                                          style={{
                                                            width: `${Math.min(
                                                              layer.pct,
                                                              100,
                                                            )}%`,
                                                          }}
                                                        />
                                                      </div>
                                                      <span className="font-mono text-slate-300">
                                                        {formatNumber(layer.pct)}%
                                                      </span>
                                                    </div>
                                                  </td>
                                                  <td className="p-2">
                                                    <span
                                                      className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                                        layer.status === 'Completed'
                                                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                                          : layer.status === 'In Progress'
                                                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                                                            : 'border-red-500/30 bg-red-500/10 text-red-300'
                                                      }`}
                                                    >
                                                      {layer.status}
                                                    </span>
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {!progressLoading && overview.applicationProgress.length === 0 && (
              <p className="text-xs text-slate-500">
                No indr.layer progress rows found for this project.
              </p>
            )}
          </div>
        </div>

        {/* Scenario simulator */}
        <div className="rounded-2xl border border-amber-500/30 bg-slate-900 p-4">
          <h3 className="mb-1 font-display text-sm font-semibold">
            Scenario Simulator
          </h3>
          <p className="mb-4 text-[11px] text-slate-500">
            What-if on current totals — assumes work parallelizes freely
            across painters. Not a scheduled forecast.
          </p>

          <label className="mb-1 block text-[11px] text-slate-500">
            Painters: <span className="text-slate-300">{dailyPainters}</span>
          </label>
          <input
            type="range"
            min={1}
            max={60}
            value={dailyPainters}
            onChange={(event) => setDailyPainters(Number(event.target.value))}
            className="w-full accent-amber-500"
          />

          <label className="mb-1 mt-4 block text-[11px] text-slate-500">
            Work Mode
          </label>
          <select
            value={workMode}
            onChange={(event) => setWorkMode(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none focus:border-amber-400"
          >
            <option value="Machine">Machine</option>
            <option value="Manual">Manual</option>
            <option value="Both">Both</option>
          </select>

          <div className="mt-4 rounded-xl bg-slate-950 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Estimated days to clear remaining work
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-amber-400">
              {formatNumber(overview.estimatedDaysToClear)} days
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Not started */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-1 font-display text-sm font-semibold">
            Not Started — Largest First
          </h3>
          <p className="mb-3 text-[11px] text-slate-500">
            Sorted by area, not a recommendation engine.
          </p>
          <div className="space-y-2">
            {overview.notStarted.map((f) => (
              <div key={f.FlatID} className="flex justify-between text-xs">
                <span className="font-mono text-cyan-400">{f.FlatID}</span>
                <span className="text-slate-400">
                  {formatNumber(f.Billable_Total_Area)} sqft
                </span>
              </div>
            ))}
            {overview.notStarted.length === 0 && (
              <p className="text-xs text-slate-500">Nothing at 0%.</p>
            )}
          </div>
        </div>

        {/* Almost done */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-1 font-display text-sm font-semibold">
            Almost Done — 90%+
          </h3>
          <p className="mb-3 text-[11px] text-slate-500">
            Quick wins to close out.
          </p>
          <div className="space-y-2">
            {overview.almostDone.map((f) => (
              <div key={f.FlatID} className="flex justify-between text-xs">
                <span className="font-mono text-cyan-400">{f.FlatID}</span>
                <span className="text-emerald-400">
                  {formatNumber(f.Flat_Completion_Pct)}%
                </span>
              </div>
            ))}
            {overview.almostDone.length === 0 && (
              <p className="text-xs text-slate-500">Nothing in this range.</p>
            )}
          </div>
        </div>

        {/* Longest remaining */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-1 font-display text-sm font-semibold">
            Longest Remaining Layers
          </h3>
          <p className="mb-3 text-[11px] text-slate-500">
            By Days_Required, at current painter input.
          </p>
          <div className="space-y-2">
            {overview.longestRemaining.map((l) => (
              <div key={l.LayerID} className="flex justify-between text-xs">
                <span className="font-mono text-cyan-400">{l.Flat}</span>
                <span className="text-slate-400">
                  {formatNumber(l.Days_Required)}d
                </span>
              </div>
            ))}
            {overview.longestRemaining.length === 0 && (
              <p className="text-xs text-slate-500">Nothing remaining.</p>
            )}
          </div>
        </div>
      </div>

      {/* Material summary */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 p-4">
          <h3 className="font-display text-sm font-semibold">
            Material Summary
          </h3>
          <p className="text-[11px] text-slate-500">
            Planned requirement and cost, grouped by material. This is the
            plan, not current stock on hand — there&apos;s no inventory field
            to compute a &quot;days left&quot; figure from yet.
          </p>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="p-3">Material</th>
              <th className="p-3">Required</th>
              <th className="p-3">Cost</th>
            </tr>
          </thead>
          <tbody>
            {overview.materialSummary.map((m) => (
              <tr key={m.name} className="border-t border-slate-800">
                <td className="p-3">{m.name}</td>
                <td className="p-3 font-mono">{formatNumber(m.required)}</td>
                <td className="p-3 font-mono">&#8377;{formatNumber(m.cost)}</td>
              </tr>
            ))}
            {overview.materialSummary.length === 0 && (
              <tr>
                <td className="p-3 text-xs text-slate-500" colSpan={3}>
                  No material data on the loaded layers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {boqEnabled && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-semibold">
                  Work Order Costing
                </h3>
                <p className="text-[11px] text-slate-500">
                  Project Work Order values with material cost, expected consumption,
                  labour hours, average daily wage, and projected profit.
                </p>
              </div>
              {!boqLoading && !boqError && (
                <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-400">
                  {boqRows.length} {boqRows.length === 1 ? 'item' : 'items'}
                </span>
              )}
            </div>
          </div>

          {boqLoading ? (
            <div className="p-5 text-sm text-slate-400">Loading Work Order costing...</div>
          ) : boqError ? (
            <div className="m-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              {boqError}
            </div>
          ) : (
            <div className="max-h-[520px] overflow-auto">
              <table className="min-w-[1950px] w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-slate-950 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="p-3">Application</th>
                    <th className="p-3">Layer</th>
                    <th className="p-3">Area</th>
                    <th className="p-3">Material Name</th>
                    <th className="p-3">Client Rate</th>
                    <th className="p-3">Material Cost</th>
                    <th className="p-3">Total Amount</th>
                    <th className="p-3">Expected Material Consumption</th>
                    <th className="p-3">Current Stock</th>
                    <th className="p-3">Expected Labour Hours</th>
                    <th className="p-3">Average Daily Wage</th>
                    <th className="p-3">Projected Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {boqRows.map((row, index) => (
                    <tr
                      key={`${row.application ?? ''}-${row.layer ?? ''}-${row.materialName ?? ''}-${index}`}
                      className="border-t border-slate-800"
                    >
                      <td className="p-3">{row.application || '-'}</td>
                      <td className="p-3">{row.layer || '-'}</td>
                      <td className="p-3 font-mono">
                        {formatNullableNumber(row.area)}
                      </td>
                      <td className="p-3">{row.materialName || '-'}</td>
                      <td className="p-3 font-mono">
                        {formatCurrency(row.clientRate)}
                      </td>
                      <td className="p-3 font-mono">
                        {formatCurrency(row.materialCost)}
                      </td>
                      <td className="p-3 font-mono font-semibold text-emerald-400">
                        {formatCurrency(row.totalAmount)}
                      </td>
                      <td className="p-3 font-mono">
                        {formatNullableNumber(row.expectedMaterialConsumption)}
                      </td>
                      <td className="p-3 font-mono">
                        {formatNullableNumber(row.currentStock)}
                      </td>
                      <td className="p-3 font-mono">
                        {formatNullableNumber(row.expectedLabourHours)}
                      </td>
                      <td className="p-3 font-mono">
                        {formatCurrency(row.averageDailyWage)}
                      </td>
                      <td className="p-3 font-mono font-semibold text-cyan-400">
                        {formatCurrency(row.projectedProfit)}
                      </td>
                    </tr>
                  ))}
                  {boqRows.length === 0 && (
                    <tr>
                      <td className="p-5 text-sm text-slate-500" colSpan={12}>
                        No Work Order costing rows found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LayersTable({
  layers,
  loading,
}: {
  layers: ProjectionLayer[];
  loading: boolean;
}) {
  if (loading) {
    return <div className="p-5 text-sm text-slate-400">Refreshing layers...</div>;
  }

  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="min-w-[1700px] w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-slate-950 text-left text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="p-3">Application</th>
            <th className="p-3">Flat ID</th>
            <th className="p-3">Layer</th>
            <th className="p-3">Total Area</th>
            <th className="p-3">Done Area</th>
            <th className="p-3">Remaining</th>
            <th className="p-3">Completion</th>
            <th className="p-3">Days Required</th>
            <th className="p-3">Material Name</th>
            <th className="p-3">Material Required</th>
            <th className="p-3">Material Cost</th>
          </tr>
        </thead>
        <tbody>
          {layers.map((layer) => (
            <tr key={layer.LayerID} className="border-t border-slate-800">
              <td className="p-3">{layer.Application}</td>
              <td className="p-3 font-mono text-cyan-400">{layer.Flat}</td>
              <td className="p-3">{layer.LAYERName}</td>
              <td className="p-3 font-mono">
                {formatNumber(layer.Projection_Total_Area)}
              </td>
              <td className="p-3 font-mono">
                {formatNumber(layer.Projection_Done_Area)}
              </td>
              <td className="p-3 font-mono">
                {formatNumber(layer.Remaining_Area)}
              </td>
              <td className="p-3 font-mono">
                {formatNumber(layer.Work_Done_Pct)}%
              </td>
              <td className="p-3 font-mono">
                {formatNumber(layer.Days_Required)}
              </td>
              <td className="p-3">{layer.Material_Name || '-'}</td>
              <td className="p-3 font-mono">
                {formatNumber(layer.Material_Required)}
              </td>
              <td className="p-3 font-mono">
                &#8377;{formatNumber(layer.Material_Cost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlatsTable({
  flats,
  loading,
}: {
  flats: ProjectionFlat[];
  loading: boolean;
}) {
  if (loading) {
    return <div className="p-5 text-sm text-slate-400">Refreshing flats...</div>;
  }

  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="min-w-[900px] w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-slate-950 text-left text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="p-3">Application</th>
            <th className="p-3">Flat ID</th>
            <th className="p-3">Total Area</th>
            <th className="p-3">Done Area</th>
            <th className="p-3">Remaining</th>
            <th className="p-3">Completion</th>
          </tr>
        </thead>
        <tbody>
          {flats.map((flat) => (
            <tr key={flat.FlatID} className="border-t border-slate-800">
              <td className="p-3">{flat.Application || '-'}</td>
              <td className="p-3 font-mono text-cyan-400">{flat.FlatID}</td>
              <td className="p-3 font-mono">
                {formatNumber(flat.Billable_Total_Area)}
              </td>
              <td className="p-3 font-mono">
                {formatNumber(flat.Billable_Done_Area)}
              </td>
              <td className="p-3 font-mono">
                {formatNumber(flat.Billable_Remaining_Area)}
              </td>
              <td className="p-3 font-mono">
                {formatNumber(flat.Flat_Completion_Pct)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return formatNumber(value);
}

function formatCurrency(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return '-';
  }

  return numberValue.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  });
}

function formatNumber(value: unknown) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return '0';
  }

  return numberValue.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  });
}