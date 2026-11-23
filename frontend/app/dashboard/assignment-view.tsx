'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import {
  addFullDemandToRecommendation,
  addPartialDemandToRecommendation,
  bulkSubmitAssignedReporting,
  createAssignmentRun,
  fetchAssignmentHealth,
  type AssignmentHealth,
  fetchAssignmentApplications,
  fetchAssignmentBlocks,
  fetchAssignmentCapacity,
  fetchAssignmentFlats,
  fetchAssignmentFloorRestrictions,
  fetchAssignmentLayers,
  fetchAssignmentPainters,
  fetchAssignmentProductivityOptions,
  fetchAssignmentMaterialSuggestion,
  fetchAssignmentRuns,
  fetchAssignmentView,
  fetchAssignmentWalls,
  fetchDemandItems,
  fetchDefaultReportingAssignmentDate,
  fetchFinalAssignments,
  fetchFinalAssignmentWalls,
  fetchRecommendations,
  fetchRecommendationWalls,
  fetchTodayAssignedReporting,
  fetchTodayPainterAttendance,
  finalizeAssignmentRun,
  generateAssignmentRecommendations,
  removeRecommendationRow,
  restoreRecommendationRow,
  submitAssignmentReporting,
  updateRecommendationWorkMode,
  type AssignmentCapacity,
  type AssignmentDemandRow,
  type AssignmentFloorRestrictionBlock,
  type AssignmentPainter,
  type AssignmentProductivityOption,
  type AssignmentMaterialSuggestion,
  type AssignmentRun,
  type AssignmentWallOption,
  type RecommendedAssignment,
  type RecommendedAssignmentWall,
  type TodayAssignedReportingRow,
  type TodayPainterAttendance,
  type WorkDemandItem,
  type WorkMode,
} from '../../lib/assignmentApi';

import { type AssignmentViewId } from './view-titles';

export { getAssignmentViewTitle } from './view-titles';
export type { AssignmentViewId };

const SECTION_ORDER = ['Rollover', 'Ongoing', 'Next Layer Ready', 'QC Rework'];

const SECTION_COLORS: Record<string, string> = {
  Rollover: 'bg-red-400',
  Ongoing: 'bg-amber-400',
  'QC Rework': 'bg-teal-400',
  'Next Layer Ready': 'bg-blue-400',
  'Hour Based': 'bg-violet-400',
};

const WORK_MODES: WorkMode[] = ['Machine', 'Manual', 'Both'];

function defaultWorkModeForLayer(layerName?: string | null): WorkMode {
  return norm(layerName).includes('PRIMER') ? 'Machine' : 'Both';
}

function demandModeOverrideKey(application?: string | null, layerName?: string | null) {
  return `${norm(application)}|${norm(layerName)}`;
}

function productivityForDemandMode(
  options: AssignmentProductivityOption[],
  application: string,
  layerName: string,
  mode: WorkMode,
) {
  const matching = options.filter(
    (option) =>
      norm(option.application) === norm(application) &&
      norm(option.layer_name) === norm(layerName),
  );

  const exact = matching.find(
    (option) => norm(option.machine_or_manual) === norm(mode),
  );
  const bothFallback = matching.find(
    (option) => norm(option.machine_or_manual) === 'BOTH',
  );

  return Number(
    exact?.productivity_per_hour ??
      bothFallback?.productivity_per_hour ??
      0,
  );
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

type ReportedBackendRow = {
  project_id?: string | null;
  id: string;
  assignment_id: string | null;
  layer_id: string | null;
  block: string | null;
  application: string;
  flat: string;
  work_layer: string;
  work_date: string;
  wall_names: string | null;
  area: number;
  painter_names: string | null;
  machine_or_manual: string | null;
  working_hours: number;
  work_status: string;
  material_name: string | null;
  material_used_l_kg: number | null;
  remark: string | null;
  created_at: string;
  updated_at?: string | null;
};

type UpdateReportedBackendRowPayload = {
  wallNames?: string[];
  painterNames?: string[];
  machineOrManual: string;
  workingHours?: number;
  materialName?: string | null;
  materialUsedLKg?: number;
  remark?: string | null;
  changedBy?: string;
};

type AssignedHistoryRow = {
  project_id?: string | null;
  assignment_id: string;
  run_id: string | null;
  assignment_date: string;
  block: string | null;
  application: string;
  flat: string;
  layer_id: string | null;
  layer_name: string;
  surface_type: string | null;
  machine_or_manual: string | null;
  assignment_status: string | null;
  wall_names: string | null;
  wall_count: number;
  assigned_area: number;
  productivity_per_hour: number;
  expected_hours: number;
};

type AssignedVsReportedStatus =
  | 'Not Reported'
  | 'Partially Reported'
  | 'Fully Reported'
  | 'Over Reported';

type AssignedVsReportedRow = {
  key: string;
  assignmentId: string;
  assignmentDate: string;
  block: string | null;
  application: string;
  flat: string;
  layerName: string;
  surfaceType: string | null;
  machineOrManual: string | null;
  hourBased: boolean;
  assignedArea: number;
  reportedArea: number;
  remainingArea: number;
  assignedHours: number;
  reportedHours: number;
  remainingHours: number;
  assignedWalls: string[];
  reportedWalls: string[];
  remainingWalls: string[];
  painters: string[];
  reportCount: number;
  progressPct: number;
  status: AssignedVsReportedStatus;
};

type AssignmentLayerProgressRow = {
  project_id?: string | null;
  layer_id: string;
  block: string | null;
  application: string;
  flat: string;
  layer_name: string;
  layer_order: number;
  wkdpct: number;
  flat_sort: number;
  no_order_flag: number;
  is_hour_based?: boolean;
  total_hours?: number | null;
  reported_hours?: number | null;
  remaining_hours?: number | null;
  remainingArea?: number;
  remainingHours?: number;
};

type LayerProgressDetailRow = {
  project_id?: string | null;
  id: string;
  source_type: 'Reported' | 'Rollover';
  date: string | null;
  application: string;
  flat: string;
  layer: string;
  walls: string | null;
  area: number;
  painters: string | null;
  hours: number | null;
  work_status: string;
  assignment?: string;
};

type CapacitySnapshot = {
  availablePainters: number;
  availableHours: number;
  helperCount: number;
  helperAvailableHours: number;
  totalWorkers: number;
  totalAvailableHours: number;
  source: string;
};

type AssignmentRecommendationScopeLayer = {
  application: string;
  layer_name: string;
  layer_order?: number | null;
  is_allowed: boolean;
};

type AssignmentRecommendationScopeApplication = {
  project_id: string;
  run_id: string;
  application: string;
  is_allowed: boolean;
  layers: AssignmentRecommendationScopeLayer[];
};

type AssignmentRecommendationScope = {
  project_id: string;
  run_id: string;
  applications: AssignmentRecommendationScopeApplication[];
};

type UpdateAssignmentRecommendationScopePayload = {
  applications?: Array<{
    application: string;
    is_allowed: boolean;
  }>;
  layers?: Array<{
    application: string;
    layer_name: string;
    is_allowed: boolean;
  }>;
};

function demandSectionName(row: any) {
  if (isHourBasedRow(row)) {
    return 'Next Layer Ready';
  }

  return String(row?.section || '');
}


function buildRecommendationScopeFromDemandRows(
  projectId: string,
  assignmentDate: string,
  rows: Array<AssignmentDemandRow | WorkDemandItem>,
): AssignmentRecommendationScope | null {
  const scopeMap = new Map<
    string,
    {
      application: string;
      layers: Map<string, AssignmentRecommendationScopeLayer>;
    }
  >();

  rows.forEach((row: any) => {
    const section = norm(row.section);

    // Scope is intentionally only for Ongoing and Next Layer/New Layer.
    // Rollover is never restricted by this selection.
    if (
      section !== 'ONGOING' &&
      section !== 'NEXT LAYER READY' &&
      section !== 'NEW LAYER' &&
      section !== 'FRESH FLATS'
    ) {
      return;
    }

    if (row.billable === false || row.billable === 'false') {
      return;
    }

    const application = String(row.application || '').trim();
    const layerName = String(row.layer_name || '').trim();

    if (!application || !layerName || isHourBasedLayerName(layerName)) {
      return;
    }

    const applicationKey = norm(application);
    const layerKey = norm(layerName);

    if (!scopeMap.has(applicationKey)) {
      scopeMap.set(applicationKey, {
        application,
        layers: new Map<string, AssignmentRecommendationScopeLayer>(),
      });
    }

    const appScope = scopeMap.get(applicationKey)!;

    if (!appScope.layers.has(layerKey)) {
      appScope.layers.set(layerKey, {
        application,
        layer_name: layerName,
        layer_order: Number(row.layer_order ?? 999),
        is_allowed: true,
      });
    }
  });

  const applications = Array.from(scopeMap.values())
    .map((app) => ({
      project_id: projectId,
      run_id: `draft-${assignmentDate}`,
      application: app.application,
      is_allowed: true,
      layers: Array.from(app.layers.values()).sort(
        (a, b) =>
          Number(a.layer_order ?? 999) - Number(b.layer_order ?? 999) ||
          String(a.layer_name || '').localeCompare(String(b.layer_name || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
          }),
      ),
    }))
    .sort((a, b) =>
      String(a.application || '').localeCompare(String(b.application || ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    );

  if (applications.length === 0) {
    return null;
  }

  return {
    project_id: projectId,
    run_id: `draft-${assignmentDate}`,
    applications,
  };
}

type DemandWallDetail = {
  wall_name: string;
  area: number;
  hours: number;
};

type WorkDemandWallSnapshot = {
  project_id?: string | null;
  demand_wall_id?: string | null;
  demand_id: string;
  source_wall_id?: string | null;
  wall_name: string;
  wall_area?: number | string | null;
  remaining_area?: number | string | null;
  assigned_area?: number | string | null;
};

type GroupedDemandRow = {
  project_id?: string | null;
  key: string;
  demand_id?: string;
  source_id?: string;
  section: string;
  priority_rank: number;
  block: string | null;
  application: string;
  flat: string;
  layer_id: string;
  layer_name: string;
  surface_type: string | null;
  wall_names: string[];
  wall_details: DemandWallDetail[];
  remaining_area: number;
  machine_or_manual?: WorkMode | string | null;
  productivity_per_hour: number;
  required_hours: number;
  oldest_date?: string | null;
  is_hour_based?: boolean;
  total_hours?: number | null;
  reported_hours?: number | null;
  remaining_hours?: number | null;
  remainingArea?: number;
  remainingHours?: number;
};

export function AssignmentView({
  view,
  token,
  projectId,
  username,
  onNavigate,
}: {
  view: AssignmentViewId;
  searchQuery?: string;
  token: string;
  projectId: string;
  username?: string | null;
  onNavigate?: (view: AssignmentViewId) => void;
}) {
  const [assignmentDate, setAssignmentDate] = useState(tomorrowDateInput());
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [activeRunId, setActiveRunId] = useState('');
  const [runs, setRuns] = useState<AssignmentRun[]>([]);
  const [capacity, setCapacity] = useState<AssignmentCapacity | null>(null);
  const [painters, setPainters] = useState<AssignmentPainter[]>([]);

  const [rolloverRows, setRolloverRows] = useState<AssignmentDemandRow[]>([]);
  const [ongoingRows, setOngoingRows] = useState<AssignmentDemandRow[]>([]);
  const [qcRows, setQcRows] = useState<AssignmentDemandRow[]>([]);
  const [newLayerRows, setNewLayerRows] = useState<AssignmentDemandRow[]>([]);
  const [liveDemandRows, setLiveDemandRows] = useState<AssignmentDemandRow[]>([]);

  const [demandItems, setDemandItems] = useState<WorkDemandItem[]>([]);
  const [demandWalls, setDemandWalls] = useState<WorkDemandWallSnapshot[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendedAssignment[]>([]);
  const [recommendationWalls, setRecommendationWalls] = useState<RecommendedAssignmentWall[]>([]);
  const [finalAssignments, setFinalAssignments] = useState<any[]>([]);
  const [finalAssignmentWalls, setFinalAssignmentWalls] = useState<any[]>([]);
  const [todayAssigned, setTodayAssigned] = useState<TodayAssignedReportingRow[]>([]);
  const [partialRow, setPartialRow] = useState<GroupedDemandRow | null>(null);
  const [hourRow, setHourRow] = useState<GroupedDemandRow | null>(null);
  const [layerProgressRows, setLayerProgressRows] = useState<AssignmentLayerProgressRow[]>([]);

  const [recommendationScope, setRecommendationScope] =
    useState<AssignmentRecommendationScope | null>(null);
  const [scopeDraft, setScopeDraft] =
    useState<AssignmentRecommendationScope | null>(null);
  const [scopeDirty, setScopeDirty] = useState(false);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [includeRollover, setIncludeRollover] = useState(true);
  const [floorRestrictionBlocks, setFloorRestrictionBlocks] = useState<
    AssignmentFloorRestrictionBlock[]
  >([]);
  const [floorRestrictionsLoading, setFloorRestrictionsLoading] = useState(false);
  const [demandModeOverrides, setDemandModeOverrides] = useState<Record<string, WorkMode>>({});
  const [demandProductivityOptions, setDemandProductivityOptions] = useState<
    AssignmentProductivityOption[]
  >([]);

  // Request/race guards for the Assignment workspace.
  // A stale GET must never overwrite a newer generate/manual-edit response.
  const activeRunIdRef = useRef('');
  const shellRequestIdRef = useRef(0);
  const runDataRequestIdRef = useRef(0);
  const generationInFlightRef = useRef(false);
  const mutationInFlightRef = useRef(false);

  // Existing projects retain their established workflow and capacity logic.
  // New projects are checked against their actual setup data first, so a
  // missing master produces an actionable message instead of failed queries.
  const legacyAssignmentProject =
    projectId === 'park_heights' || projectId === 'indradhanush';
  const [projectHealth, setProjectHealth] = useState<AssignmentHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState('');
  const [healthRefreshKey, setHealthRefreshKey] = useState(0);

  useEffect(() => {
    if (legacyAssignmentProject || !token || !projectId) {
      setProjectHealth(null);
      setHealthLoading(false);
      setHealthError('');
      return;
    }
    let cancelled = false;
    setProjectHealth(null);
    setHealthLoading(true);
    setHealthError('');
    void fetchAssignmentHealth(token, projectId)
      .then((health) => {
        if (!cancelled) setProjectHealth(health);
      })
      .catch((err) => {
        if (!cancelled) setHealthError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setHealthLoading(false);
      });
    return () => { cancelled = true; };
  }, [token, projectId, legacyAssignmentProject, healthRefreshKey]);

  const missingProjectSources = !legacyAssignmentProject && projectHealth
    ? [
        Number(projectHealth.layer_rows) === 0
          ? 'indr.layer — Layer Data has no records for this project.' : null,
        Number(projectHealth.surface_rows) === 0
          ? 'indr.surface_number — Dimensions have no records for this project.' : null,
        Number(projectHealth.productivity_rows) === 0
          ? 'indr.productivity_master — no project productivity values.' : null,
        Number(projectHealth.painter_rows) === 0
          ? 'indr.all_site_painter_master / assignment_v_reporting_painters — no project-linked painters.' : null,
      ].filter((value): value is string => value !== null)
    : [];

  // Do not block existing projects. For a newly configured site, only begin
  // generating Assignment data once its structural/workforce masters exist.
  // Painter availability is deliberately NOT a prerequisite here.
  const isAssignmentEnabled = Boolean(
    token && projectId &&
      (legacyAssignmentProject ||
        (projectHealth !== null && missingProjectSources.length === 0)),
  );

  const activeRun = runs.find((run) => run.run_id === activeRunId) || runs[0] || null;
  const activeRunDate = toDateInput(activeRun?.assignment_date || assignmentDate);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  // Exact wall rows are loaded lazily for Park Heights only when the user
  // opens Add Partial. Clear any previously loaded wall details when the run changes.
  useEffect(() => {
    setDemandWalls([]);
  }, [activeRunId]);

  const demandRowsForDemandPage = useMemo(() => {
    const shouldUseActiveRunSnapshot =
      Boolean(activeRunId) &&
      activeRunDate === assignmentDate &&
      demandItems.length > 0;

    if (!shouldUseActiveRunSnapshot) {
      const liveHourBasedRows = (liveDemandRows.length
        ? liveDemandRows
        : [...ongoingRows, ...newLayerRows]
      ).filter((row) => isHourBasedRow(row));

      return {
        Rollover: rolloverRows.filter((row) => !isHourBasedRow(row)),
        Ongoing: ongoingRows.filter((row) => !isHourBasedRow(row)),
        'QC Rework': qcRows.filter((row) => !isHourBasedRow(row)),
        'Next Layer Ready': [
          ...newLayerRows.filter((row) => !isHourBasedRow(row)),
          ...normalizeSectionRows(
            liveHourBasedRows as AssignmentDemandRow[],
            'Next Layer Ready',
          ),
        ],
      };
    }

    return {
      Rollover: normalizeSectionRows(
        demandItems.filter(
          (row) =>
            norm(row.section) === 'ROLLOVER' && !isHourBasedRow(row),
        ) as AssignmentDemandRow[],
        'Rollover',
      ),
      Ongoing: normalizeSectionRows(
        demandItems.filter(
          (row) =>
            norm(row.section) === 'ONGOING' && !isHourBasedRow(row),
        ) as AssignmentDemandRow[],
        'Ongoing',
      ),
      'QC Rework': normalizeSectionRows(
        demandItems.filter(
          (row) =>
            norm(row.section) === 'QC REWORK' && !isHourBasedRow(row),
        ) as AssignmentDemandRow[],
        'QC Rework',
      ),
      'Next Layer Ready': normalizeSectionRows(
        demandItems.filter(
          (row) =>
            isHourBasedRow(row) ||
            ['NEXT LAYER READY', 'NEW LAYER', 'FRESH FLATS'].includes(
              norm(row.section),
            ),
        ) as AssignmentDemandRow[],
        'Next Layer Ready',
      ),
    };
  }, [
    activeRunDate,
    activeRunId,
    assignmentDate,
    demandItems,
    liveDemandRows,
    newLayerRows,
    ongoingRows,
    qcRows,
    rolloverRows,
  ]);

  const activePaintersFromMaster = useMemo(
    () =>
      painters.filter((painter) => {
        const painterProjectId = String(
          (painter as any).project_id ||
            (painter as any).current_project_id ||
            projectId,
        ).trim();

        const status = norm(painter.status);

        return (
          painterProjectId === projectId &&
          (status === 'ACTIVE' || status === 'AVAILABLE' || status === '')
        );
      }),
    [painters, projectId],
  );

  const capacitySnapshot = useMemo<CapacitySnapshot>(() => {
    const fallbackPainters = activePaintersFromMaster.filter((painter) =>
      isPainterCategory((painter as any).category),
    ).length;
    const fallbackHelpers = activePaintersFromMaster.filter((painter) =>
      isHelperCategory((painter as any).category),
    ).length;

    const painterCountFromDb = Number(
      (capacity as any)?.painter_count ?? capacity?.available_painter_count ?? 0,
    );
    const painterHoursFromDb = Number(
      (capacity as any)?.painter_available_hours ?? capacity?.available_hours ?? 0,
    );
    const helperCountFromDb = Number((capacity as any)?.helper_count ?? 0);
    const helperHoursFromDb = Number((capacity as any)?.helper_available_hours ?? 0);

    const availablePainters = painterCountFromDb > 0 ? painterCountFromDb : fallbackPainters;
    const availableHours = painterHoursFromDb > 0 ? painterHoursFromDb : fallbackPainters * 8;
    const helperCount = helperCountFromDb > 0 ? helperCountFromDb : fallbackHelpers;
    const helperAvailableHours = helperHoursFromDb > 0 ? helperHoursFromDb : fallbackHelpers * 8;

    return {
      availablePainters,
      availableHours,
      helperCount,
      helperAvailableHours,
      totalWorkers: availablePainters + helperCount,
      totalAvailableHours: availableHours + helperAvailableHours,
      source:
        capacity?.capacity_source ||
        (activePaintersFromMaster.length > 0
          ? 'all_site_painter_master_category_fallback'
          : 'not_available'),
    };
  }, [activePaintersFromMaster, capacity]);

  const activeRecommendations = useMemo(
    () =>
      dedupeRecommendedAssignments(
        recommendations.filter(
          (row) => !isRemovedStatus(row.recommendation_status),
        ),
      ),
    [recommendations],
  );

  const removedRecommendations = useMemo(
    () => recommendations.filter((row) => isRemovedStatus(row.recommendation_status)),
    [recommendations],
  );

  const assignedHourSplit = useMemo(() => {
    let regularPainterHours = 0;
    let helperOnlyHours = 0;
    let touchupHours = 0;

    activeRecommendations.forEach((row) => {
      const hours = Number(row.required_hours || 0);

      if (isHelperOnlyWorkLayerName(row.layer_name)) {
        helperOnlyHours += hours;
        return;
      }

      if (isTouchupPainterFirstLayerName(row.layer_name)) {
        touchupHours += hours;
        return;
      }

      regularPainterHours += hours;
    });

    // Touchup Putty / Touchup Sanding use whatever Painter capacity is still
    // free after normal painter work. Only the overflow moves to Helper hours.
    const painterRoomForTouchup = Math.max(
      capacitySnapshot.availableHours - regularPainterHours,
      0,
    );
    const touchupPainterHours = Math.min(touchupHours, painterRoomForTouchup);
    const touchupHelperOverflowHours = Math.max(
      touchupHours - touchupPainterHours,
      0,
    );

    return {
      painterHours: regularPainterHours + touchupPainterHours,
      helperHours: helperOnlyHours + touchupHelperOverflowHours,
    };
  }, [activeRecommendations, capacitySnapshot.availableHours]);

  const assignedHours = assignedHourSplit.painterHours;
  const helperAssignedHours = assignedHourSplit.helperHours;
  const balanceHours = capacitySnapshot.availableHours - assignedHours;
  const helperBalanceHours = capacitySnapshot.helperAvailableHours - helperAssignedHours;
  const touchupAssignableBalanceHours =
    Math.max(balanceHours, 0) + Math.max(helperBalanceHours, 0);

  const demandScopeFromVisibleDemand = useMemo(
    () =>
      buildRecommendationScopeFromDemandRows(projectId, assignmentDate, [
        ...ongoingRows,
        ...newLayerRows,
        ...liveDemandRows,
      ]),
    [assignmentDate, liveDemandRows, newLayerRows, ongoingRows, projectId],
  );

  const demandPageRecommendationScope = scopeDraft ?? demandScopeFromVisibleDemand;

  const loadShellData = useCallback(async () => {
    if (!token || !isAssignmentEnabled) return;

    const requestId = ++shellRequestIdRef.current;

    const [runResult, painterResult] = await Promise.allSettled([
      fetchAssignmentRuns(token, projectId),
      fetchAssignmentPainters(token, projectId),
    ]);

    // Ignore an older shell request that completed after a newer one.
    if (requestId !== shellRequestIdRef.current) return;

    if (runResult.status === 'fulfilled') {
      const runData = runResult.value;
      setRuns(runData);

      if (!activeRunIdRef.current && runData[0]?.run_id) {
        activeRunIdRef.current = runData[0].run_id;
        setActiveRunId(runData[0].run_id);
      }
    }

    // A temporary API failure must not erase already-visible painters.
    if (painterResult.status === 'fulfilled') {
      setPainters(painterResult.value);
    }
  }, [isAssignmentEnabled, projectId, token]);

  const loadCapacity = useCallback(
    async (date: string) => {
      if (!token || !isAssignmentEnabled) return;

      const data = await fetchAssignmentCapacity(token, projectId, date).catch(() => null);
      setCapacity(data);
    },
    [isAssignmentEnabled, projectId, token],
  );

  const loadDemandProductivityOptions = useCallback(async () => {
    if (!token || !isAssignmentEnabled) return;

    const options = await fetchAssignmentProductivityOptions(
      token,
      projectId,
    ).catch(() => []);

    setDemandProductivityOptions(options);
  }, [isAssignmentEnabled, projectId, token]);

  const loadFloorRestrictionDefaults = useCallback(async () => {
    if (!token || !isAssignmentEnabled) return;

    setFloorRestrictionsLoading(true);

    try {
      const response = await fetchAssignmentFloorRestrictions(token, projectId);
      setFloorRestrictionBlocks(response.blocks || []);
    } catch {
      setFloorRestrictionBlocks([]);
    } finally {
      setFloorRestrictionsLoading(false);
    }
  }, [isAssignmentEnabled, projectId, token]);

  const loadRecommendationScope = useCallback(
    async (runId: string) => {
      if (!token || !isAssignmentEnabled || !runId) return null;

      const scope = await fetchAssignmentRecommendationScopeLocal(
        token,
        projectId,
        runId,
      ).catch(() => null);

      setRecommendationScope(scope);
      setScopeDraft(scope);
      setScopeDirty(false);

      return scope;
    },
    [isAssignmentEnabled, projectId, token],
  );

  const loadLiveDemand = useCallback(async () => {
    if (!token || !isAssignmentEnabled) return;

    const [rollover, ongoing, qcRework, newLayer] = await Promise.all([
      fetchAssignmentViewForDateLocal(
        token,
        projectId,
        'rollover',
        assignmentDate,
      ).catch(() => []),
      fetchAssignmentViewForDateLocal(
        token,
        projectId,
        'ongoing',
        assignmentDate,
      ).catch(() => []),
      fetchAssignmentViewForDateLocal(
        token,
        projectId,
        'qc-rework',
        assignmentDate,
      ).catch(() => []),
      fetchAssignmentViewForDateLocal(
        token,
        projectId,
        'new-layer',
        assignmentDate,
      ).catch(() => []),
    ]);

    const normalizedRollover = normalizeSectionRows(rollover, 'Rollover');
    const normalizedOngoing = normalizeSectionRows(ongoing, 'Ongoing');
    const normalizedQc = normalizeSectionRows(qcRework, 'QC Rework');
    const normalizedNewLayer = normalizeSectionRows(newLayer, 'Next Layer Ready');

    setRolloverRows(normalizedRollover);
    setOngoingRows(normalizedOngoing);
    setQcRows(normalizedQc);
    setNewLayerRows(normalizedNewLayer);

    // Avoid the expensive APH live-demand endpoint on page load. The four
    // section endpoints already contain the rows needed for totals and scope.
    setLiveDemandRows([
      ...normalizedRollover,
      ...normalizedOngoing,
      ...normalizedQc,
      ...normalizedNewLayer,
    ]);
  }, [assignmentDate, isAssignmentEnabled, projectId, token]);

  const loadRunData = useCallback(
    async (runId: string) => {
      if (!token || !isAssignmentEnabled || !runId) return;

      const requestId = ++runDataRequestIdRef.current;

      // Park Heights has thousands of wall rows. Do not download every demand wall
      // simply to render Recommended Assignment. Exact walls are loaded on demand
      // only when Add Partial is opened.
      const shouldLoadRunWideDemandWalls = projectId === 'indradhanush';

      const [itemsResult, recsResult, recWallsResult, scopeResult, wallsResult] =
        await Promise.allSettled([
          fetchDemandItems(token, projectId, runId),
          fetchRecommendations(token, projectId, runId),
          fetchRecommendationWalls(token, projectId, runId),
          fetchAssignmentRecommendationScopeLocal(token, projectId, runId),
          shouldLoadRunWideDemandWalls
            ? fetchDemandWallsLocal(token, projectId, runId)
            : Promise.resolve(null),
        ]);

      // Never allow an older request, or a response for another run, to overwrite
      // the state produced by a newer Generate/Add/Remove operation.
      if (
        requestId !== runDataRequestIdRef.current ||
        (activeRunIdRef.current && activeRunIdRef.current !== runId)
      ) {
        return;
      }

      // Keep the last good state when one background request fails. Previously
      // `.catch(() => [])` converted transient API errors into empty UI lists,
      // which made recommendations appear/disappear.
      if (itemsResult.status === 'fulfilled') {
        setDemandItems(itemsResult.value);
      }

      if (recsResult.status === 'fulfilled') {
        setRecommendations(recsResult.value);
      }

      if (recWallsResult.status === 'fulfilled') {
        setRecommendationWalls(recWallsResult.value);
      }

      if (
        wallsResult.status === 'fulfilled' &&
        Array.isArray(wallsResult.value)
      ) {
        setDemandWalls(wallsResult.value);
      }

      if (scopeResult.status === 'fulfilled') {
        const scope = scopeResult.value;
        setRecommendationScope(scope);
        setScopeDraft(scope);
        setScopeDirty(false);
      }

      // Final-assignment rows are needed only on the Final Assignment page.
      if (view === 'assignment-final') {
        const [finalsResult, finalWallsResult] = await Promise.allSettled([
          fetchFinalAssignments(token, projectId, runId),
          fetchFinalAssignmentWalls(token, projectId, runId),
        ]);

        if (
          requestId !== runDataRequestIdRef.current ||
          (activeRunIdRef.current && activeRunIdRef.current !== runId)
        ) {
          return;
        }

        if (finalsResult.status === 'fulfilled') {
          setFinalAssignments(finalsResult.value);
        }

        if (finalWallsResult.status === 'fulfilled') {
          setFinalAssignmentWalls(finalWallsResult.value);
        }
      }
    },
    [isAssignmentEnabled, projectId, token, view],
  );

  const loadReportingAndOutcome = useCallback(async () => {
    if (!token || !isAssignmentEnabled) return;

    const assignedRows = await fetchTodayAssignedReporting(token, projectId).catch(() => []);

    setTodayAssigned(assignedRows);
  }, [isAssignmentEnabled, projectId, token]);

  const loadLayerProgress = useCallback(async () => {
    if (!token || !isAssignmentEnabled) return;

    const rows = await fetchLayerProgressRowsLocal(token, projectId).catch(() => []);
    setLayerProgressRows(rows);
  }, [isAssignmentEnabled, projectId, token]);

  const reloadAll = useCallback(async () => {
    if (!isAssignmentEnabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (view === 'assignment-reporting') {
        // Reporting owns its own lightweight fetches by tab/date.
        // Do not load demand, recommendations, capacity, final assignment,
        // or layer progress just because the user is reporting work.
        return;
      }

      if (view === 'assignment-layer-progress') {
        await loadLayerProgress();
        return;
      }

      if (view === 'assignment-capacity') {
        await Promise.all([loadShellData(), loadCapacity(assignmentDate)]);
        return;
      }

      if (view === 'assignment-final') {
        await loadShellData();
        return;
      }

      if (view === 'assignment-recommended') {
        await Promise.all([loadShellData(), loadCapacity(activeRunDate)]);
        return;
      }

      await Promise.all([
        loadShellData(),
        loadLiveDemand(),
        loadCapacity(assignmentDate),
        loadDemandProductivityOptions(),
      ]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [
    activeRunDate,
    assignmentDate,
    isAssignmentEnabled,
    loadCapacity,
    loadDemandProductivityOptions,
    loadLiveDemand,
    loadLayerProgress,
    loadShellData,
    view,
  ]);

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  useEffect(() => {
    const shouldLoadRunData =
      view === 'assignment-demand' ||
      view === 'assignment-recommended' ||
      view === 'assignment-final';

    if (activeRunId && shouldLoadRunData) {
      loadRunData(activeRunId);
    }
  }, [activeRunId, loadRunData, view]);

  useEffect(() => {
    const shouldLoadCapacity =
      view === 'assignment-demand' ||
      view === 'assignment-recommended' ||
      view === 'assignment-capacity';

    if (shouldLoadCapacity) {
      loadCapacity(activeRunDate);
    }
  }, [activeRunDate, loadCapacity, view]);

  async function refreshAfterMutation(runId = activeRunId) {
    // Keep post-mutation refresh scoped to assignment/recommendation screens.
    // Reporting and Layer Progress are intentionally lazy-loaded by their own pages.
    await Promise.all([
      loadShellData(),
      loadCapacity(activeRunDate),
    ]);

    if (runId) {
      await loadRunData(runId);
    } else if (view === 'assignment-demand') {
      await loadLiveDemand();
    }
  }

  async function applyCapacityCapToRecommendations(
    runId: string,
    recommendationRows: RecommendedAssignment[],
  ) {
    void runId;

    let usedHours = 0;
    const availableHours = Number(capacitySnapshot.availableHours || 0);

    const sortedRows = [...recommendationRows].filter(
      (row) => !isRemovedStatus(row.recommendation_status),
    );

    for (const row of sortedRows) {
      const productivity = Number(row.selected_productivity_per_hour || 0);
      const hours = Number(row.required_hours || 0);

      const shouldRemove =
        productivity <= 0 ||
        hours <= 0 ||
        usedHours + hours > availableHours;

      if (shouldRemove) {
        await removeRecommendationRow(token, projectId, row.recommendation_id, {
          changedBy: username || 'system',
          reason:
            productivity <= 0
              ? 'Auto removed because productivity is missing'
              : 'Auto removed because recommendation exceeds available painter hours',
        });

        continue;
      }

      usedHours += hours;
    }
  }

  useEffect(() => {
    if (view !== 'assignment-demand') return;

    // A new planning date inherits the latest successfully generated floor
    // restriction defaults. Editing them remains local until Generate is
    // clicked; generation then promotes the new values for future dates.
    void loadFloorRestrictionDefaults();
  }, [assignmentDate, loadFloorRestrictionDefaults, view]);

  useEffect(() => {
    // A new planning date starts from the requested defaults. User changes are
    // kept while working/regenerating the same date.
    setIncludeRollover(true);
    setDemandModeOverrides({});
  }, [assignmentDate, projectId]);

  async function saveRecommendationScopeForRun(
    runId: string,
    scope: AssignmentRecommendationScope,
  ) {
    setScopeSaving(true);

    try {
      const applications = scope.applications.map((app) => ({
        application: app.application,
        is_allowed: app.is_allowed,
      }));

      const layers = scope.applications.flatMap((app) =>
        app.layers.map((layer) => ({
          application: app.application,
          layer_name: layer.layer_name,
          is_allowed: layer.is_allowed,
        })),
      );

      const updatedScope = await updateAssignmentRecommendationScopeLocal(
        token,
        projectId,
        runId,
        { applications, layers },
      );

      setRecommendationScope(updatedScope);
      setScopeDraft(updatedScope);
      setScopeDirty(false);
    } finally {
      setScopeSaving(false);
    }
  }

  async function saveRecommendationScopeIfDirty(
    runId: string,
    fallbackScope?: AssignmentRecommendationScope | null,
  ) {
    void fallbackScope;

    // assignment_prepare_run_demand initializes the run scope already.
    // Persist only an actual user edit instead of rewriting the full default scope
    // on every generation.
    if (!scopeDirty || !scopeDraft) return;

    await saveRecommendationScopeForRun(runId, scopeDraft);
  }

  async function handleGenerateRecommendedAssignment() {
    if (!token || !projectId || generationInFlightRef.current) return;

    generationInFlightRef.current = true;
    // Any older run-data request is no longer allowed to update the screen while
    // a fresh plan is being built.
    runDataRequestIdRef.current += 1;

    setActionLoading(true);
    setError('');
    setSuccess('');

    try {
      // Always create a fresh run when the user clicks Generate/Regenerate.
      // Same-date regeneration must replace the previous generated/published
      // plan instead of reusing the old demand snapshot. The backend clears only
      // assignment-generated artifacts for this project/date before creating the
      // new run, so same-day published rows do not come back as rollover.
      const runResponse = await createAssignmentRun(token, projectId, {
        assignmentDate,
        generatedBy: username || 'system',
      });

      const runId = runResponse.runId;

      // Keep the currently visible plan stable while the backend generates the new
      // one. Setting activeRunId here used to trigger a GET for an unfinished run,
      // which could return zero recommendations and later overwrite the generated
      // result.
      await saveRecommendationScopeIfDirty(runId, demandPageRecommendationScope);

      const uniqueModeOverrides = new Map<
        string,
        { application: string; layerName: string; machineOrManual: WorkMode }
      >();

      // demandModeOverrides contains only modes the user changed away from the
      // default. Do not send defaults for every application/layer: doing so made
      // the backend UPDATE thousands of work_demand_item rows unnecessarily.
      Object.values(demandRowsForDemandPage)
        .flat()
        .filter((row) => !isHourBasedRow(row))
        .forEach((row) => {
          const key = demandModeOverrideKey(row.application, row.layer_name);
          const machineOrManual = demandModeOverrides[key];

          if (!key || key === '|' || !machineOrManual) return;

          uniqueModeOverrides.set(key, {
            application: row.application,
            layerName: row.layer_name,
            machineOrManual,
          });
        });

      const recommendationResponse = await generateAssignmentRecommendations(
        token,
        projectId,
        runId,
        {
          includeRollover,
          modeOverrides: Array.from(uniqueModeOverrides.values()),
          floorRestrictions: floorRestrictionBlocks.map((item) => ({
            block: item.block,
            blockedFloors: [...(item.blocked_floors || [])].sort(
              (a, b) => a - b,
            ),
          })),
        },
      );

      const generatedRecommendations = recommendationResponse.recommendations || [];

      // Invalidate anything that may have started before the generation response,
      // then commit the new run to React state as one stable snapshot.
      runDataRequestIdRef.current += 1;
      activeRunIdRef.current = runId;

      setDemandItems(runResponse.demandItems || []);
      setDemandWalls([]);
      setRecommendations(generatedRecommendations);
      setRecommendationWalls(recommendationResponse.recommendationWalls || []);
      setRuns((current) => [
        recommendationResponse.run,
        ...current.filter((run) => run.run_id !== runId),
      ]);
      setActiveRunId(runId);

      // Capacity was already loaded on Tomorrow Work Demand. Refresh it in the
      // background rather than keeping the Generate button blocked for another API
      // round trip.
      void loadCapacity(assignmentDate);

      setSuccess('Recommended assignment generated.');
      onNavigate?.('assignment-recommended');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      generationInFlightRef.current = false;
      setActionLoading(false);
    }
  }


  async function handleAddFull(row: GroupedDemandRow) {
    if (!activeRunId) {
      setError('Generate recommended assignment first.');
      return;
    }

    if (!row.demand_id) {
      setError('This demand row is missing demand_id. Regenerate assignment first.');
      return;
    }

    if (isHourBasedRow(row)) {
      handleAddHours(row);
      return;
    }

    let rowForAdd = row;
    let remainingWallNames = rowForAdd.wall_details.map((wall) => wall.wall_name);

    // Park Heights intentionally does not preload every work_demand_wall row.
    // Touchup sequence rows can therefore be present in the run snapshot while
    // their wall names are still lazy. Load only this demand before deciding
    // whether Add is possible. This does not change recommendation eligibility.
    if (
      remainingWallNames.length === 0 &&
      projectId !== 'indradhanush' &&
      isTouchupPainterFirstLayerName(row.layer_name)
    ) {
      setActionLoading(true);
      setError('');

      try {
        const exactWalls = await fetchDemandWallsForDemandLocal(
          token,
          projectId,
          row.demand_id,
        );

        setDemandWalls((current) => [
          ...current.filter((wall) => wall.demand_id !== row.demand_id),
          ...exactWalls,
        ]);

        const activeRows = activeRecommendations.filter((rec) =>
          recommendationMatchesDemandRow(rec, row),
        );
        const assignedWallNames = selectedWallNamesForRecommendations(
          activeRows,
          recommendationWalls,
        );
        const productivity = Number(row.productivity_per_hour || 0);
        const remainingWallDetails = buildWallDetailsFromSnapshots(
          exactWalls,
          productivity,
        ).filter((wall) => !assignedWallNames.has(norm(wall.wall_name)));

        rowForAdd = {
          ...row,
          wall_names: remainingWallDetails.map((wall) => wall.wall_name),
          wall_details: remainingWallDetails,
        };
        remainingWallNames = remainingWallDetails.map((wall) => wall.wall_name);
      } catch (err) {
        setError(errorMessage(err));
        return;
      } finally {
        setActionLoading(false);
      }
    }

    if (remainingWallNames.length === 0) {
      setError(
        isTouchupPainterFirstLayerName(row.layer_name)
          ? 'Touchup work is ready, but no mapped wall rows were found for this demand. Regenerate after the demand wall sync is corrected.'
          : 'No remaining walls are available for this work.',
      );
      return;
    }

    // If this demand already has a partial recommendation, Add means:
    // add all currently remaining walls into the same work. The backend patch
    // below merges these walls into the existing recommendation row.
    if (hasActiveRecommendation(row.demand_id, activeRecommendations)) {
      await handleSubmitPartial(rowForAdd, remainingWallNames);
      return;
    }

    if (mutationInFlightRef.current) return;

    mutationInFlightRef.current = true;
    runDataRequestIdRef.current += 1;
    setActionLoading(true);
    setError('');

    try {
      const response = await addFullDemandToRecommendation(token, projectId, row.demand_id, {
        runId: activeRunId,
        changedBy: username || 'system',
        reason: 'Added from work demand workspace',
      });

      setRecommendations(response.recommendations || []);
      setRecommendationWalls(response.recommendationWalls || []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      mutationInFlightRef.current = false;
      setActionLoading(false);
    }
  }

  async function handleAddPartial(row: GroupedDemandRow) {
    if (!activeRunId) {
      setError('Generate recommended assignment first.');
      return;
    }

    if (!row.demand_id) {
      setError('This demand row is missing demand_id. Regenerate assignment first.');
      return;
    }

    if (isHourBasedRow(row)) {
      setError('Cleaning, Helping and Material Shifting are hour-based. Use Add Hours instead.');
      return;
    }

    setError('');

    if (projectId === 'indradhanush') {
      setPartialRow(row);
      return;
    }

    // Park Heights can have thousands of wall rows in a run. Fetch only the
    // selected demand's exact wall areas when the user actually opens Add Partial.
    setActionLoading(true);

    try {
      const exactWalls = await fetchDemandWallsForDemandLocal(
        token,
        projectId,
        row.demand_id,
      );

      setDemandWalls((current) => [
        ...current.filter((wall) => wall.demand_id !== row.demand_id),
        ...exactWalls,
      ]);

      if (
        exactWalls.length === 0 &&
        isTouchupPainterFirstLayerName(row.layer_name)
      ) {
        setError(
          'Touchup work is ready, but no mapped wall rows were found for this demand. Regenerate after the demand wall sync is corrected.',
        );
        return;
      }

      const activeRows = activeRecommendations.filter((rec) =>
        recommendationMatchesDemandRow(rec, row),
      );
      const assignedWallNames = selectedWallNamesForRecommendations(
        activeRows,
        recommendationWalls,
      );
      const productivity = Number(row.productivity_per_hour || 0);
      const remainingWallDetails = buildWallDetailsFromSnapshots(
        exactWalls,
        productivity,
      ).filter((wall) => !assignedWallNames.has(norm(wall.wall_name)));

      setPartialRow({
        ...row,
        wall_names: remainingWallDetails.map((wall) => wall.wall_name),
        wall_details: remainingWallDetails,
        remaining_area: remainingWallDetails.reduce(
          (sum, wall) => sum + Number(wall.area || 0),
          0,
        ),
      });
    } catch {
      // The existing snapshot still contains wall names, so a transient detail
      // fetch failure must not prevent the user from assigning work.
      setPartialRow(row);
    } finally {
      setActionLoading(false);
    }
  }

  function handleAddHours(row: GroupedDemandRow) {
    if (!activeRunId) {
      setError('Generate recommended assignment first.');
      return;
    }

    if (!row.demand_id) {
      setError('This demand row is missing demand_id. Regenerate assignment first.');
      return;
    }

    setError('');
    setHourRow(row);
  }

  async function handleSubmitHours(row: GroupedDemandRow, hoursToAssign: number) {
    if (!activeRunId) {
      setError('Generate recommended assignment first.');
      return;
    }

    if (!row.demand_id) {
      setError('This demand row is missing demand_id. Regenerate assignment first.');
      return;
    }

    if (!Number.isFinite(hoursToAssign) || hoursToAssign <= 0) {
      setError('Enter valid hours to assign.');
      return;
    }

    const remainingHours = Number(row.remaining_hours ?? row.remainingHours ?? row.required_hours ?? row.remaining_area ?? 0);

    if (remainingHours > 0 && hoursToAssign > remainingHours) {
      setError(`Only ${formatNumber(remainingHours)} hours are remaining for this layer.`);
      return;
    }

    if (mutationInFlightRef.current) return;

    mutationInFlightRef.current = true;
    runDataRequestIdRef.current += 1;
    setActionLoading(true);
    setError('');

    try {
      const roundedHoursToAssign = roundToTwo(hoursToAssign);

      const response = await addPartialDemandToRecommendation(token, projectId, row.demand_id, {
        runId: activeRunId,
        assignedArea: roundedHoursToAssign,
        wallNames: ['__HOUR_BASED__'],
        changedBy: username || 'system',
        reason: 'Manual hour allocation for Cleaning/Helping/Material Shifting',
      } as any);

      setRecommendations(response.recommendations || []);
      setRecommendationWalls(response.recommendationWalls || []);
      setHourRow(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      mutationInFlightRef.current = false;
      setActionLoading(false);
    }
  }

  async function handleSubmitPartial(row: GroupedDemandRow, selectedWalls: string[]) {
    if (!activeRunId) {
      setError('Generate recommended assignment first.');
      return;
    }

    if (!row.demand_id) {
      setError('This demand row is missing demand_id. Regenerate assignment first.');
      return;
    }

    if (selectedWalls.length === 0) {
      setError('Select at least one wall for partial assignment.');
      return;
    }

    const selectedWallSet = new Set(selectedWalls.map((wall) => norm(wall)));
    const selectedDetails = row.wall_details.filter((wall) =>
      selectedWallSet.has(norm(wall.wall_name)),
    );

    const assignedArea = selectedDetails.reduce(
      (sum, wall) => sum + Number(wall.area || 0),
      0,
    );

    if (!Number.isFinite(assignedArea) || assignedArea <= 0) {
      setError('Selected walls do not have valid area.');
      return;
    }

    if (mutationInFlightRef.current) return;

    mutationInFlightRef.current = true;
    runDataRequestIdRef.current += 1;
    setActionLoading(true);
    setError('');

    try {
      const response = await addPartialDemandToRecommendation(token, projectId, row.demand_id, {
        runId: activeRunId,
        assignedArea,
        wallNames: selectedWalls,
        changedBy: username || 'system',
        reason: 'Partial wall selection from recommendation workspace',
      } as any);

      setRecommendations(response.recommendations || []);
      setRecommendationWalls(response.recommendationWalls || []);
      setPartialRow(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      mutationInFlightRef.current = false;
      setActionLoading(false);
    }
  }

  async function handleRemoveRecommendation(recommendationId: string) {
    if (mutationInFlightRef.current) return;

    mutationInFlightRef.current = true;
    runDataRequestIdRef.current += 1;
    setActionLoading(true);
    setError('');

    try {
      const response = await removeRecommendationRow(token, projectId, recommendationId, {
        changedBy: username || 'system',
        reason: 'Removed from recommendation workspace',
      });

      setRecommendations(response.recommendations || []);
      setRecommendationWalls(response.recommendationWalls || []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      mutationInFlightRef.current = false;
      setActionLoading(false);
    }
  }

  async function handleRestoreRecommendation(recommendationId: string) {
    if (mutationInFlightRef.current) return;

    mutationInFlightRef.current = true;
    runDataRequestIdRef.current += 1;
    setActionLoading(true);
    setError('');

    try {
      const response = await restoreRecommendationRow(token, projectId, recommendationId, {
        changedBy: username || 'system',
        reason: 'Restored from recommendation workspace',
      });

      setRecommendations(response.recommendations || []);
      setRecommendationWalls(response.recommendationWalls || []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      mutationInFlightRef.current = false;
      setActionLoading(false);
    }
  }

  async function handleWorkModeChange(recommendationId: string, mode: WorkMode) {
    if (mutationInFlightRef.current) return;

    mutationInFlightRef.current = true;
    runDataRequestIdRef.current += 1;
    setActionLoading(true);
    setError('');

    try {
      const updated = await updateRecommendationWorkMode(
        token,
        projectId,
        recommendationId,
        mode,
      );

      setRecommendations(updated || []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      mutationInFlightRef.current = false;
      setActionLoading(false);
    }
  }

  async function handleFinalize() {
    if (!activeRunId) {
      setError('Generate a run before finalizing.');
      return;
    }

    let overrideReason: string | undefined;

    if (balanceHours < 0) {
      const reason = window.prompt(
        'Assignment is over available hours. Enter override reason to publish.',
      );

      if (!reason || reason.trim() === '') {
        setError('Override reason is required to finalize over-capacity assignment.');
        return;
      }

      overrideReason = reason.trim();
    }

    setActionLoading(true);
    setError('');

    try {
      const response = await finalizeAssignmentRun(token, projectId, activeRunId, {
        finalizedBy: username || 'system',
        overrideReason,
      });

      setFinalAssignments(response.finalAssignments || []);
      setFinalAssignmentWalls(response.finalAssignmentWalls || []);

      setRuns((current) =>
        current.map((run) => (run.run_id === activeRunId ? response.run : run)),
      );

      // The finalize response already contains the authoritative final rows.
      // Avoid a second full run reload before navigating to Final Assignment.
      setSuccess('Final assignment published.');
      onNavigate?.('assignment-final');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  }

  if (!legacyAssignmentProject && (healthLoading || (!projectHealth && !healthError))) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
        Checking Assignment Engine prerequisites for this project...
      </div>
    );
  }

  if (!legacyAssignmentProject && healthError) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-5 text-sm text-red-200">
        Unable to check Assignment setup for this project: {healthError}
      </div>
    );
  }

  if (!legacyAssignmentProject && missingProjectSources.length > 0) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm text-amber-100">
        <h3 className="font-semibold">Assignment setup incomplete</h3>
        <p className="mt-2 text-sm text-amber-100/80">
          Assignment Engine is available in the sidebar for every project, but
          this project cannot run assignment workflows until these sources have data:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          {missingProjectSources.map((message) => <li key={message}>{message}</li>)}
        </ul>
        <button
          type="button"
          onClick={() => setHealthRefreshKey((key) => key + 1)}
          className="mt-3 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/10"
        >
          Recheck project data
        </button>
        <p className="mt-3 text-xs text-amber-100/80">
          Check Project Setup and the project's painter master mapping. No
          painter_availability records are required just to open the module;
          existing Park Heights capacity calculation rules are unchanged.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
        Loading assignment engine...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="red">{error}</Alert>}
      {success && <Alert tone="green">{success}</Alert>}

      {view === 'assignment-demand' && (
        <DemandPage
          assignmentDate={assignmentDate}
          setAssignmentDate={setAssignmentDate}
          capacity={capacitySnapshot}
          demandRows={demandRowsForDemandPage}
          liveDemandRows={liveDemandRows}
          productivityOptions={demandProductivityOptions}
          modeOverrides={demandModeOverrides}
          includeRollover={includeRollover}
          floorRestrictionBlocks={floorRestrictionBlocks}
          floorRestrictionsLoading={floorRestrictionsLoading}
          recommendationScope={demandPageRecommendationScope}
          scopeDirty={scopeDirty}
          scopeSaving={scopeSaving}
          actionLoading={actionLoading}
          onRefresh={reloadAll}
          onScopeChange={(nextScope) => {
            setScopeDraft(nextScope);
            setScopeDirty(true);
          }}
          onModeChange={(application, layerName, mode) => {
            const key = demandModeOverrideKey(application, layerName);
            const defaultMode = defaultWorkModeForLayer(layerName);

            setDemandModeOverrides((current) => {
              const next = { ...current };

              if (mode === defaultMode) {
                delete next[key];
              } else {
                next[key] = mode;
              }

              return next;
            });
          }}
          onIncludeRolloverChange={setIncludeRollover}
          onFloorRestrictionsChange={setFloorRestrictionBlocks}
          onGenerateRecommendation={handleGenerateRecommendedAssignment}
        />
      )}

      {view === 'assignment-recommended' && (
        <RecommendedWorkspace
          run={activeRun}
          assignmentDate={assignmentDate}
          setAssignmentDate={setAssignmentDate}
          capacity={capacitySnapshot}
          assignedHours={assignedHours}
          balanceHours={balanceHours}
          helperAvailableHours={capacitySnapshot.helperAvailableHours}
          helperAssignedHours={helperAssignedHours}
          helperBalanceHours={helperBalanceHours}
          demandItems={demandItems}
          demandWalls={demandWalls}
          liveDemandRows={liveDemandRows}
          activeRecommendations={activeRecommendations}
          removedRecommendations={removedRecommendations}
          recommendationWalls={recommendationWalls}
          actionLoading={actionLoading}
          onRegenerate={handleGenerateRecommendedAssignment}
          onFinalize={handleFinalize}
          onAddFull={handleAddFull}
          onAddPartial={handleAddPartial}
          onAddHours={handleAddHours}
          onRemove={handleRemoveRecommendation}
          onRestore={handleRestoreRecommendation}
          onModeChange={handleWorkModeChange}
        />
      )}

      {view === 'assignment-capacity' && (
        <CapacityPage
          capacity={capacitySnapshot}
          capacitySource={capacity?.capacity_source || capacitySnapshot.source}
          assignedHours={assignedHours}
          helperAssignedHours={helperAssignedHours}
          painters={activePaintersFromMaster}
        />
      )}

      {view === 'assignment-final' && (
        <FinalAssignmentPage
          token={token}
          projectId={projectId}
          run={activeRun}
          runs={runs}
          activeRunId={activeRunId}
          finalAssignments={finalAssignments}
          onRunChange={setActiveRunId}
          onReporting={() => {
            onNavigate?.('assignment-reporting');
          }}
        />
      )}

      {view === 'assignment-reporting' && (
        <ReportingPage
          token={token}
          projectId={projectId}
          username={username}
          assignedRows={todayAssigned}
          onSubmitted={async (options) => {
            setSuccess('Reporting submitted into backend.');

            if (options?.fullRefresh === false) {
              return;
            }

            await refreshAfterMutation(activeRunId);
          }}
          onError={setError}
        />
      )}

      {view === 'assignment-layer-progress' && (
        <LayerProgressPage
          rows={layerProgressRows}
          token={token}
          projectId={projectId}
          onError={setError}
        />
      )}


      {partialRow && (
        <PartialWorkModal
          row={partialRow}
          balanceHours={
            isTouchupPainterFirstLayerName(partialRow.layer_name)
              ? touchupAssignableBalanceHours
              : balanceHours
          }
          actionLoading={actionLoading}
          onClose={() => setPartialRow(null)}
          onSubmit={(selectedWalls) => handleSubmitPartial(partialRow, selectedWalls)}
        />
      )}

      {hourRow && (
        <AddHoursModal
          row={hourRow}
          balanceHours={helperBalanceHours}
          actionLoading={actionLoading}
          onClose={() => setHourRow(null)}
          onSubmit={(hoursToAssign) => handleSubmitHours(hourRow, hoursToAssign)}
        />
      )}
    </div>
  );
}


function ResponsiveDatePicker({
  id,
  label,
  value,
  onChange,
  disabled = false,
  size = 'md',
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const selected = parseDateInputLocal(value) || new Date();
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });

  useEffect(() => {
    if (!mobileCalendarOpen) return;

    const selected = parseDateInputLocal(value) || new Date();
    setVisibleMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [mobileCalendarOpen, value]);

  useEffect(() => {
    if (!mobileCalendarOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileCalendarOpen]);

  const calendarDays = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const mondayBasedOffset = (firstDay.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - mondayBasedOffset);

    return Array.from({ length: 42 }, (_, index) =>
      new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + index,
      ),
    );
  }, [visibleMonth]);

  const inputHeight = size === 'sm' ? 'h-9' : 'h-10';
  const inputText = size === 'sm' ? 'text-xs' : 'text-sm';
  const selectedValue = value || localTodayDateInput();

  function chooseDate(date: Date) {
    onChange(dateToInputValue(date));
    setMobileCalendarOpen(false);
  }

  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className={`mb-1 block font-bold uppercase tracking-wide text-slate-500 ${
          size === 'sm' ? 'text-[10px]' : 'text-[11px]'
        }`}
      >
        {label}
      </label>

      {/* Mobile uses an in-app calendar sheet. Native browser date popovers can
          overflow narrow phone viewports and cannot be resized with CSS. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setMobileCalendarOpen(true)}
        className={`flex ${inputHeight} w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 font-mono ${inputText} text-slate-100 outline-none transition hover:border-slate-600 focus:border-amber-400 disabled:cursor-not-allowed disabled:opacity-60 sm:hidden`}
        aria-label={`Choose ${label.toLowerCase()}`}
      >
        <span className="truncate">{displayDateInput(selectedValue)}</span>
        <span aria-hidden="true" className="shrink-0 text-slate-400">
          ▣
        </span>
      </button>

      {/* Desktop keeps the compact native input. */}
      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={`hidden ${inputHeight} w-full min-w-[155px] rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono ${inputText} text-slate-100 outline-none transition hover:border-slate-600 focus:border-amber-400 disabled:cursor-not-allowed disabled:opacity-60 sm:block`}
      />

      {mobileCalendarOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-black/65 sm:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={`${label} calendar`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setMobileCalendarOpen(false);
            }
          }}
        >
          <div className="max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-950 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-700" />

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() =>
                  setVisibleMonth(
                    (current) =>
                      new Date(current.getFullYear(), current.getMonth() - 1, 1),
                  )
                }
                className="grid h-10 w-10 place-items-center rounded-lg border border-slate-700 bg-slate-900 text-lg text-slate-200 hover:bg-slate-800"
                aria-label="Previous month"
              >
                ‹
              </button>

              <div className="text-center">
                <p className="font-display text-base font-bold text-slate-100">
                  {visibleMonth.toLocaleDateString('en-IN', {
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                  {label}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setVisibleMonth(
                    (current) =>
                      new Date(current.getFullYear(), current.getMonth() + 1, 1),
                  )
                }
                className="grid h-10 w-10 place-items-center rounded-lg border border-slate-700 bg-slate-900 text-lg text-slate-200 hover:bg-slate-800"
                aria-label="Next month"
              >
                ›
              </button>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                <div key={day} className="py-1">
                  {day}
                </div>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1">
              {calendarDays.map((date) => {
                const dateValue = dateToInputValue(date);
                const isSelected = dateValue === value;
                const isToday = dateValue === localTodayDateInput();
                const isCurrentMonth =
                  date.getMonth() === visibleMonth.getMonth() &&
                  date.getFullYear() === visibleMonth.getFullYear();

                return (
                  <button
                    key={dateValue}
                    type="button"
                    onClick={() => chooseDate(date)}
                    className={`aspect-square min-h-10 rounded-lg text-sm font-semibold transition ${
                      isSelected
                        ? 'bg-amber-400 text-slate-950'
                        : isToday
                          ? 'border border-cyan-400/60 bg-cyan-500/10 text-cyan-300'
                          : isCurrentMonth
                            ? 'text-slate-200 hover:bg-slate-800'
                            : 'text-slate-600 hover:bg-slate-900'
                    }`}
                    aria-label={date.toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setMobileCalendarOpen(false)}
                className="h-10 rounded-lg border border-slate-700 bg-slate-900 text-sm font-bold text-slate-200 hover:bg-slate-800"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => chooseDate(new Date())}
                className="h-10 rounded-lg bg-amber-400 text-sm font-bold text-slate-950 hover:bg-amber-300"
              >
                Today
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function parseDateInputLocal(value?: string | null) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  return Number.isNaN(date.getTime()) ? null : date;
}

function dateToInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function localTodayDateInput() {
  return dateToInputValue(new Date());
}

function displayDateInput(value?: string | null) {
  const parsed = parseDateInputLocal(value);

  if (!parsed) return 'Select date';

  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function DemandPage({
  assignmentDate,
  setAssignmentDate,
  capacity,
  demandRows,
  liveDemandRows,
  productivityOptions,
  modeOverrides,
  includeRollover,
  floorRestrictionBlocks,
  floorRestrictionsLoading,
  recommendationScope,
  scopeDirty,
  scopeSaving,
  actionLoading,
  onRefresh,
  onScopeChange,
  onModeChange,
  onIncludeRolloverChange,
  onFloorRestrictionsChange,
  onGenerateRecommendation,
}: {
  assignmentDate: string;
  setAssignmentDate: (value: string) => void;
  capacity: CapacitySnapshot;
  demandRows: Record<string, AssignmentDemandRow[]>;
  liveDemandRows: AssignmentDemandRow[];
  productivityOptions: AssignmentProductivityOption[];
  modeOverrides: Record<string, WorkMode>;
  includeRollover: boolean;
  floorRestrictionBlocks: AssignmentFloorRestrictionBlock[];
  floorRestrictionsLoading: boolean;
  recommendationScope: AssignmentRecommendationScope | null;
  scopeDirty: boolean;
  scopeSaving: boolean;
  actionLoading: boolean;
  onRefresh: () => void;
  onScopeChange: (scope: AssignmentRecommendationScope) => void;
  onModeChange: (application: string, layerName: string, mode: WorkMode) => void;
  onIncludeRolloverChange: (value: boolean) => void;
  onFloorRestrictionsChange: (
    blocks: AssignmentFloorRestrictionBlock[],
  ) => void;
  onGenerateRecommendation: () => void;
}) {
  const [activeSection, setActiveSection] = useState(SECTION_ORDER[0]);
  const [searchText, setSearchText] = useState('');
  const [blockFilter, setBlockFilter] = useState('All');
  const [applicationFilter, setApplicationFilter] = useState('All');
  const [sortBy, setSortBy] = useState('highest-hours');

  const groupedBySection = useMemo(() => {
    return SECTION_ORDER.reduce<Record<string, GroupedDemandRow[]>>(
      (result, section) => {
        result[section] = groupDemandRows(demandRows[section] || []).map((row) => {
          if (isHourBasedRow(row)) {
            return {
              ...row,
              machine_or_manual: 'Both',
            };
          }

          const key = demandModeOverrideKey(row.application, row.layer_name);
          const machineOrManual =
            modeOverrides[key] ?? defaultWorkModeForLayer(row.layer_name);
          const productivityPerHour =
            productivityForDemandMode(
              productivityOptions,
              row.application,
              row.layer_name,
              machineOrManual,
            ) ||
            (norm(row.machine_or_manual) === norm(machineOrManual)
              ? Number(row.productivity_per_hour || 0)
              : 0);
          const remainingArea = Number(row.remaining_area || 0);

          return {
            ...row,
            machine_or_manual: machineOrManual,
            productivity_per_hour: productivityPerHour,
            required_hours:
              productivityPerHour > 0
                ? roundToTwo(remainingArea / productivityPerHour)
                : 0,
          };
        });
        return result;
      },
      {},
    );
  }, [demandRows, modeOverrides, productivityOptions]);

  const allGroupedRows = useMemo(
    () => SECTION_ORDER.flatMap((section) => groupedBySection[section] || []),
    [groupedBySection],
  );

  const blockOptions = useMemo(
    () =>
      Array.from(
        new Set(
          allGroupedRows
            .map((row) => String(row.block || '').trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [allGroupedRows],
  );

  const applicationOptions = useMemo(
    () =>
      Array.from(
        new Set(
          allGroupedRows
            .map((row) => String(row.application || '').trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [allGroupedRows],
  );

  const visibleRows = useMemo(() => {
    const query = norm(searchText);
    const rows = [...(groupedBySection[activeSection] || [])].filter((row) => {
      if (blockFilter !== 'All' && String(row.block || '') !== blockFilter) {
        return false;
      }

      if (
        applicationFilter !== 'All' &&
        String(row.application || '') !== applicationFilter
      ) {
        return false;
      }

      if (!query) return true;

      return [
        row.block,
        row.application,
        row.flat,
        row.layer_name,
        row.surface_type,
        row.wall_names.join(' '),
      ].some((value) => norm(value).includes(query));
    });

    rows.sort((a, b) => {
      if (sortBy === 'oldest-first') {
        return demandDateValue(a.oldest_date) - demandDateValue(b.oldest_date);
      }

      if (sortBy === 'floor-order') {
        return (
          flatSortValue(a.flat) - flatSortValue(b.flat) ||
          a.flat.localeCompare(b.flat) ||
          a.layer_name.localeCompare(b.layer_name)
        );
      }

      return (
        Number(b.required_hours || 0) - Number(a.required_hours || 0) ||
        a.flat.localeCompare(b.flat)
      );
    });

    return rows;
  }, [
    activeSection,
    applicationFilter,
    blockFilter,
    groupedBySection,
    searchText,
    sortBy,
  ]);

  const sectionStats = useMemo(() => {
    return SECTION_ORDER.reduce<
      Record<string, { rows: number; area: number; hours: number }>
    >((result, section) => {
      const rows = groupedBySection[section] || [];

      result[section] = {
        rows: rows.length,
        area: rows.reduce(
          (sum, row) =>
            sum +
            (isHourBasedRow(row) ? 0 : Number(row.remaining_area || 0)),
          0,
        ),
        hours: rows.reduce(
          (sum, row) => sum + Number(row.required_hours || 0),
          0,
        ),
      };

      return result;
    }, {});
  }, [groupedBySection]);

  const totalDemandArea = liveDemandRows.length
    ? liveDemandRows.reduce(
        (sum, row) =>
          sum +
          (isHourBasedRow(row)
            ? 0
            : Number(row.remaining_area || row.wall_area || 0)),
        0,
      )
    : allGroupedRows.reduce(
        (sum, row) =>
          sum +
          (isHourBasedRow(row) ? 0 : Number(row.remaining_area || 0)),
        0,
      );

  const totalDemandHours = allGroupedRows.reduce(
    (sum, row) => sum + Number(row.required_hours || 0),
    0,
  );

  const totalRows = allGroupedRows.length;
  const priorityRows =
    (groupedBySection.Rollover || []).length +
    (groupedBySection['QC Rework'] || []).length;

  const loadPct =
    capacity.availableHours > 0
      ? (totalDemandHours / capacity.availableHours) * 100
      : 0;

  const selectedStats = sectionStats[activeSection] || {
    rows: 0,
    area: 0,
    hours: 0,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">
            Tomorrow Work Demand
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            
          </p>
        </div>

        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:w-auto sm:grid-cols-[minmax(155px,auto)_auto_auto]">
          <ResponsiveDatePicker
            label="Plan Date"
            value={assignmentDate}
            onChange={setAssignmentDate}
            disabled={actionLoading}
            size="sm"
          />

          <button
            type="button"
            onClick={onRefresh}
            disabled={actionLoading}
            className="h-9 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-bold hover:bg-slate-800 disabled:opacity-60"
          >
            ↻ Refresh
          </button>

          <button
            type="button"
            onClick={onGenerateRecommendation}
            disabled={actionLoading}
            className="col-span-2 h-9 rounded-lg bg-amber-500 px-4 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60 sm:col-span-1"
          >
            {actionLoading ? 'Generating...' : 'Generate Recommended Assignment →'}
          </button>
        </div>
      </div>

      <RecommendationScopePanel
        scope={recommendationScope}
        disabled={actionLoading || scopeSaving}
        dirty={scopeDirty}
        saving={scopeSaving}
        modeOverrides={modeOverrides}
        onChange={onScopeChange}
        onModeChange={onModeChange}
      />

      <FloorRestrictionPanel
        blocks={floorRestrictionBlocks}
        loading={floorRestrictionsLoading}
        disabled={actionLoading}
        onChange={onFloorRestrictionsChange}
      />

      <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
        <div>
          <p className="text-xs font-bold text-slate-100">Include rollover in recommendation</p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            On by default. Turn it off to keep rollover visible here but exclude it from this generated assignment.
          </p>
        </div>
        <input
          type="checkbox"
          checked={includeRollover}
          disabled={actionLoading}
          onChange={(event) => onIncludeRolloverChange(event.target.checked)}
          className="h-4 w-4 shrink-0"
        />
      </label>

      {!recommendationScope && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-xs text-slate-400">
          No Ongoing/New Layer billable scope is available yet for the current
          demand. {includeRollover
            ? 'Rollover is currently included in recommendation.'
            : 'Rollover is currently excluded from recommendation.'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-800 bg-slate-900 p-2.5 lg:grid-cols-[minmax(220px,1fr)_120px_140px_125px]">
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Search Work
          </span>
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Flat, layer, wall or application"
            className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs outline-none placeholder:text-slate-600 focus:border-amber-400"
          />
        </label>

        <DemandFilterSelect
          label="Block"
          value={blockFilter}
          onChange={setBlockFilter}
          options={blockOptions}
          allLabel="All blocks"
        />

        <DemandFilterSelect
          label="Application"
          value={applicationFilter}
          onChange={setApplicationFilter}
          options={applicationOptions}
          allLabel="All applications"
        />

        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Sort
          </span>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
            className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs outline-none focus:border-amber-400"
          >
            <option value="highest-hours">Highest hours</option>
            <option value="oldest-first">Oldest first</option>
            <option value="floor-order">Floor order</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 items-start gap-2 lg:grid-cols-[170px_minmax(0,1fr)]">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:sticky lg:top-3 lg:self-start lg:auto-rows-max lg:grid-cols-1 lg:content-start">
          {SECTION_ORDER.map((section) => {
            const stats = sectionStats[section] || {
              rows: 0,
              area: 0,
              hours: 0,
            };
            const active = section === activeSection;

            return (
              <button
                key={section}
                type="button"
                onClick={() => setActiveSection(section)}
                className={`rounded-xl border p-2.5 text-left transition ${
                  active
                    ? 'border-amber-500/60 bg-amber-500/10'
                    : 'border-slate-800 bg-slate-900 hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-100">
                    {section}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${demandSectionBadgeClass(
                      section,
                    )}`}
                  >
                    {stats.rows}
                  </span>
                </div>

                <p className="mt-2 text-[10px] leading-4 text-slate-500">
                  {section === 'QC Rework'
                    ? `${formatNumber(stats.area)} sqft · manual review`
                    : section === 'Hour Based'
                      ? `${formatNumber(stats.hours)} h · manual hours`
                      : section === 'Next Layer Ready'
                        ? `${formatNumber(stats.area)} sqft · sequence ready`
                        : section === 'Ongoing'
                          ? `${formatNumber(stats.area)} sqft · continue work`
                          : `${formatNumber(stats.area)} sqft · oldest work`}
                </p>
              </button>
            );
          })}

          <div className="hidden rounded-xl border border-dashed border-slate-700 bg-slate-950 p-2.5 text-[10px] leading-4 text-slate-500 lg:block">
            Priority only controls the order in which work is reviewed.
          </div>
        </div>

        <div className="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2.5">
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                {activeSection} work
              </h3>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {visibleRows.length} shown of {selectedStats.rows} rows ·{' '}
                {formatNumber(selectedStats.area)} sqft ·{' '}
                {formatNumber(selectedStats.hours)} h
              </p>
            </div>

            {(searchText || blockFilter !== 'All' || applicationFilter !== 'All') && (
              <button
                type="button"
                onClick={() => {
                  setSearchText('');
                  setBlockFilter('All');
                  setApplicationFilter('All');
                }}
                className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-[10px] font-bold text-slate-300 hover:bg-slate-800"
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="w-full overflow-hidden">
            <table className="w-full table-fixed border-collapse text-[11px]">
              <colgroup>
                <col className="w-[13%]" />
                <col className="w-[16%]" />
                <col className="w-[25%]" />
                <col className="w-[11%]" />
                <col className="w-[11%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[7%]" />
              </colgroup>

              <thead className="bg-slate-950 text-left text-[9px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="border-b border-slate-800 px-2 py-2">Flat</th>
                  <th className="border-b border-slate-800 px-2 py-2">Layer</th>
                  <th className="border-b border-slate-800 px-2 py-2">
                    Surface / Walls
                  </th>
                  <th className="border-b border-slate-800 px-2 py-2">
                    Remaining
                  </th>
                  <th className="border-b border-slate-800 px-2 py-2">Mode</th>
                  <th className="border-b border-slate-800 px-2 py-2">Hours</th>
                  <th className="border-b border-slate-800 px-2 py-2">Oldest</th>
                  <th className="border-b border-slate-800 px-2 py-2">Status</th>
                </tr>
              </thead>

              <tbody>
                {visibleRows.map((row) => {
                  const hourBased = isHourBasedRow(row);
                  const displayHours = Number(
                    row.remainingHours ??
                      row.required_hours ??
                      row.remaining_hours ??
                      row.remaining_area ??
                      0,
                  );
                  const status = demandReadiness(row);

                  return (
                    <tr
                      key={row.key}
                      className="border-b border-slate-800/80 last:border-b-0 hover:bg-slate-800/60"
                    >
                      <td className="break-words px-2 py-2 align-top">
                        <div className="font-mono text-[11px] font-bold text-cyan-300">
                          {row.flat || '-'}
                        </div>
                        <div className="mt-0.5 break-words text-[9px] leading-3 text-slate-500">
                          {[row.application, row.block].filter(Boolean).join(' · ')}
                        </div>
                      </td>

                      <td className="break-words px-2 py-2 align-top font-semibold leading-4 text-slate-100">
                        {row.layer_name || '-'}
                      </td>

                      <td className="break-words px-2 py-2 align-top leading-4 text-slate-400">
                        {hourBased ? (
                          <span className="text-slate-500">Hour-based work</span>
                        ) : (
                          <>
                            <span className="font-medium text-slate-300">
                              {row.surface_type || '-'}
                            </span>
                            <span className="text-slate-600"> · </span>
                            <span>{row.wall_names.join(', ') || 'Walls not mapped'}</span>
                          </>
                        )}
                      </td>

                      <td className="break-words px-2 py-2 align-top font-mono text-slate-300">
                        {hourBased
                          ? `${formatNumber(displayHours)} h`
                          : `${formatNumber(
                              row.remainingArea ?? row.remaining_area,
                            )} sqft`}
                      </td>

                      <td className="px-2 py-2 align-top">
                        {hourBased ? (
                          <span className="text-slate-500">-</span>
                        ) : (
                          <select
                            value={(row.machine_or_manual || defaultWorkModeForLayer(row.layer_name)) as WorkMode}
                            disabled={actionLoading}
                            onChange={(event) =>
                              onModeChange(
                                row.application,
                                row.layer_name,
                                event.target.value as WorkMode,
                              )
                            }
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-1.5 py-1 text-[10px] outline-none focus:border-amber-400 disabled:opacity-60"
                          >
                            {WORK_MODES.map((mode) => (
                              <option key={mode} value={mode}>
                                {mode}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>

                      <td className="px-2 py-2 align-top font-mono font-semibold text-amber-300">
                        {formatNumber(displayHours)} h
                      </td>

                      <td className="break-words px-2 py-2 align-top font-mono text-[10px] text-slate-400">
                        {shortDate(row.oldest_date)}
                      </td>

                      <td className="px-2 py-2 align-top">
                        <span
                          className={`inline-flex max-w-full rounded-full px-2 py-1 text-[9px] font-bold leading-3 ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {visibleRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-xs text-slate-500"
                    >
                      No work matches the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <DemandSummaryCard
          label="Available Tomorrow"
          value={`${formatNumber(capacity.availableHours)} h`}
          sub={`${capacity.availablePainters} painters × 8 hours`}
          tone="green"
        />
        <DemandSummaryCard
          label="Total Work Demand"
          value={`${formatNumber(totalDemandArea)} sqft`}
          sub={`${totalRows} grouped rows · ${priorityRows} priority rows`}
        />
        <DemandSummaryCard
          label="Estimated Load"
          value={`${formatNumber(loadPct)}%`}
          sub={`${formatNumber(totalDemandHours)} required hours`}
          tone={loadPct > 100 ? 'red' : 'amber'}
          progress={Math.min(100, Math.max(0, loadPct))}
        />
      </div>
    </div>
  );
}



function floorOrdinalLabel(floor: number) {
  if (floor === 0) return 'Ground';

  const mod100 = floor % 100;
  const mod10 = floor % 10;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? 'th'
      : mod10 === 1
        ? 'st'
        : mod10 === 2
          ? 'nd'
          : mod10 === 3
            ? 'rd'
            : 'th';

  return `${floor}${suffix}`;
}

function summarizeBlockedFloors(floors: number[]) {
  const sorted = Array.from(new Set(floors)).sort((a, b) => a - b);
  if (!sorted.length) return 'All floors allowed';

  const ranges: Array<[number, number]> = [];
  let start = sorted[0];
  let previous = sorted[0];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];

    if (current === previous + 1) {
      previous = current;
      continue;
    }

    ranges.push([start, previous]);
    start = current;
    previous = current;
  }

  ranges.push([start, previous]);

  return `Blocked: ${ranges
    .map(([rangeStart, rangeEnd]) =>
      rangeStart === rangeEnd
        ? floorOrdinalLabel(rangeStart)
        : `${floorOrdinalLabel(rangeStart)}–${floorOrdinalLabel(rangeEnd)}`,
    )
    .join(', ')}`;
}

function FloorRestrictionPanel({
  blocks,
  loading,
  disabled,
  onChange,
}: {
  blocks: AssignmentFloorRestrictionBlock[];
  loading?: boolean;
  disabled?: boolean;
  onChange: (blocks: AssignmentFloorRestrictionBlock[]) => void;
}) {
  function toggleFloor(blockName: string, floor: number) {
    onChange(
      blocks.map((item) => {
        if (item.block !== blockName) return item;

        const current = new Set(item.blocked_floors || []);
        if (current.has(floor)) current.delete(floor);
        else current.add(floor);

        return {
          ...item,
          blocked_floors: Array.from(current).sort((a, b) => a - b),
        };
      }),
    );
  }

  function clearBlock(blockName: string) {
    onChange(
      blocks.map((item) =>
        item.block === blockName ? { ...item, blocked_floors: [] } : item,
      ),
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div>
        <h3 className="text-sm font-bold text-slate-100">Floor Restrictions</h3>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">
          Block entire floors from this recommendation across every application
          in that block. The last successfully generated restriction is carried
          forward automatically to the next planning date.
        </p>
      </div>

      {loading ? (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[11px] text-slate-500">
          Loading floor restrictions...
        </div>
      ) : blocks.length === 0 ? (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[11px] text-slate-500">
          No block/floor options found for this project.
        </div>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {blocks.map((item) => {
            const blocked = new Set(item.blocked_floors || []);
            const floorOptions = Array.from(
              new Set([
                ...(item.available_floors || []),
                ...(item.blocked_floors || []),
              ]),
            ).sort((a, b) => a - b);

            return (
              <details
                key={item.block}
                className="group rounded-xl border border-slate-800 bg-slate-950"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-100">{item.block}</p>
                    <p
                      className={`mt-0.5 truncate text-[10px] ${
                        blocked.size > 0 ? 'text-amber-300' : 'text-slate-500'
                      }`}
                    >
                      {summarizeBlockedFloors(item.blocked_floors || [])}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-bold text-cyan-300 group-open:text-cyan-200">
                    Manage
                  </span>
                </summary>

                <div className="border-t border-slate-800 px-3 py-3">
                  <p className="mb-2 text-[10px] text-slate-500">
                    Tap only the floors where work must NOT be assigned.
                  </p>

                  <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto pr-1">
                    {floorOptions.map((floor) => {
                      const isBlocked = blocked.has(floor);

                      return (
                        <button
                          key={`${item.block}-${floor}`}
                          type="button"
                          disabled={disabled}
                          onClick={() => toggleFloor(item.block, floor)}
                          className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition disabled:opacity-50 ${
                            isBlocked
                              ? 'border-red-500/50 bg-red-500/15 text-red-200'
                              : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {floorOrdinalLabel(floor)}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-800 pt-2">
                    <span className="text-[10px] text-slate-500">
                      {blocked.size} floor{blocked.size === 1 ? '' : 's'} blocked
                    </span>
                    <button
                      type="button"
                      disabled={disabled || blocked.size === 0}
                      onClick={() => clearBlock(item.block)}
                      className="text-[10px] font-bold text-slate-300 hover:text-white disabled:opacity-40"
                    >
                      Clear restrictions
                    </button>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}


function RecommendationScopePanel({
  scope,
  disabled,
  dirty,
  saving,
  modeOverrides,
  onChange,
  onModeChange,
}: {
  scope: AssignmentRecommendationScope | null;
  disabled?: boolean;
  dirty?: boolean;
  saving?: boolean;
  modeOverrides: Record<string, WorkMode>;
  onChange: (scope: AssignmentRecommendationScope) => void;
  onModeChange: (application: string, layerName: string, mode: WorkMode) => void;
}) {
  const [expandedApps, setExpandedApps] = useState<Record<string, boolean>>({});

  if (!scope) return null;

  const currentScope: AssignmentRecommendationScope = scope;

  const allLayerNames = Array.from(
    new Set(
      currentScope.applications.flatMap((app) =>
        app.layers.map((layer) => layer.layer_name),
      ),
    ),
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const allowedAppCount = currentScope.applications.filter(
    (app) => app.is_allowed,
  ).length;

  function updateApplication(application: string, isAllowed: boolean) {
    onChange({
      ...currentScope,
      applications: currentScope.applications.map((app) =>
        app.application === application
          ? { ...app, is_allowed: isAllowed }
          : app,
      ),
    });
  }

  function updateLayer(
    application: string,
    layerName: string,
    isAllowed: boolean,
  ) {
    onChange({
      ...currentScope,
      applications: currentScope.applications.map((app) =>
        app.application === application
          ? {
              ...app,
              layers: app.layers.map((layer) =>
                layer.layer_name === layerName
                  ? { ...layer, is_allowed: isAllowed }
                  : layer,
              ),
            }
          : app,
      ),
    });
  }

  function setAllApplications(isAllowed: boolean) {
    onChange({
      ...currentScope,
      applications: currentScope.applications.map((app) => ({
        ...app,
        is_allowed: isAllowed,
      })),
    });
  }

  function setLayerEverywhere(layerName: string, isAllowed: boolean) {
    onChange({
      ...currentScope,
      applications: currentScope.applications.map((app) => ({
        ...app,
        layers: app.layers.map((layer) =>
          layer.layer_name === layerName
            ? { ...layer, is_allowed: isAllowed }
            : layer,
        ),
      })),
    });
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-100">
            Recommendation Scope
          </h3>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">
            Select applications and billable layers allowed for auto
            recommendation. Choose the work mode beside each layer; rollover
            inclusion is controlled separately below.
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {allowedAppCount} / {currentScope.applications.length} applications allowed
            {dirty ? ' · Unsaved scope changes' : ''}
            {saving ? ' · Saving...' : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setAllApplications(true)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            Select All Apps
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => setAllApplications(false)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            Clear Apps
          </button>
        </div>
      </div>

      {allLayerNames.length > 0 && (
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Apply layer restriction to all applications
          </p>

          <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
            {allLayerNames.map((layerName) => (
              <div
                key={layerName}
                className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
              >
                <span className="max-w-[180px] truncate text-slate-300">
                  {layerName}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setLayerEverywhere(layerName, true)}
                  className="font-bold text-emerald-300 disabled:opacity-50"
                >
                  Allow
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setLayerEverywhere(layerName, false)}
                  className="font-bold text-red-300 disabled:opacity-50"
                >
                  Block
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {currentScope.applications.map((app) => {
          const expanded = expandedApps[app.application] ?? false;
          const allowedLayerCount = app.layers.filter(
            (layer) => layer.is_allowed,
          ).length;

          return (
            <div
              key={app.application}
              className="rounded-xl border border-slate-800 bg-slate-950 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <label className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-100">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={app.is_allowed}
                    onChange={(event) =>
                      updateApplication(app.application, event.target.checked)
                    }
                  />
                  <span className="truncate">{app.application}</span>
                </label>

                <button
                  type="button"
                  onClick={() =>
                    setExpandedApps((current) => ({
                      ...current,
                      [app.application]: !expanded,
                    }))
                  }
                  className="shrink-0 text-[11px] font-bold text-cyan-300"
                >
                  {expanded ? 'Hide' : 'Layers'}
                </button>
              </div>

              <p className="mt-1 text-[10px] text-slate-500">
                {allowedLayerCount} / {app.layers.length} billable layers allowed
              </p>

              {expanded && (
                <div className="mt-3 max-h-48 space-y-1 overflow-y-auto border-t border-slate-800 pt-3">
                  {app.layers.map((layer) => {
                    const modeKey = demandModeOverrideKey(
                      app.application,
                      layer.layer_name,
                    );
                    const selectedMode =
                      modeOverrides[modeKey] ??
                      defaultWorkModeForLayer(layer.layer_name);

                    return (
                      <div
                        key={`${app.application}-${layer.layer_name}`}
                        className="grid grid-cols-[minmax(0,1fr)_94px] items-center gap-2 rounded-lg px-1 py-1 text-[11px] text-slate-300"
                      >
                        <label className="flex min-w-0 items-center gap-2">
                          <input
                            type="checkbox"
                            disabled={disabled || !app.is_allowed}
                            checked={layer.is_allowed}
                            onChange={(event) =>
                              updateLayer(
                                app.application,
                                layer.layer_name,
                                event.target.checked,
                              )
                            }
                          />
                          <span className="truncate">{layer.layer_name}</span>
                        </label>

                        <select
                          value={selectedMode}
                          disabled={disabled || !app.is_allowed || !layer.is_allowed}
                          onChange={(event) =>
                            onModeChange(
                              app.application,
                              layer.layer_name,
                              event.target.value as WorkMode,
                            )
                          }
                          className="h-7 w-full rounded-md border border-slate-700 bg-slate-900 px-1.5 text-[10px] font-semibold text-slate-200 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`${app.application} ${layer.layer_name} work mode`}
                        >
                          <option value="Machine">Machine</option>
                          <option value="Manual">Manual</option>
                          <option value="Both">Both</option>
                        </select>
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
  );
}

function DemandFilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs outline-none focus:border-amber-400"
      >
        <option value="All">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function DemandSummaryCard({
  label,
  value,
  sub,
  tone = 'default',
  progress,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: 'default' | 'green' | 'amber' | 'red';
  progress?: number;
}) {
  const toneClass =
    tone === 'green'
      ? 'border-emerald-500/30 bg-emerald-500/10'
      : tone === 'amber'
        ? 'border-amber-500/30 bg-amber-500/10'
        : tone === 'red'
          ? 'border-red-500/30 bg-red-500/10'
          : 'border-slate-800 bg-slate-900';

  const valueClass =
    tone === 'green'
      ? 'text-emerald-300'
      : tone === 'amber'
        ? 'text-amber-300'
        : tone === 'red'
          ? 'text-red-300'
          : 'text-slate-100';

  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 font-display text-xl font-bold ${valueClass}`}>
        {value}
      </p>
      <p className="mt-1 text-[10px] text-slate-500">{sub}</p>
      {progress !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full ${
              tone === 'red' ? 'bg-red-400' : 'bg-amber-400'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

function demandSectionBadgeClass(section: string) {
  if (section === 'Rollover') return 'bg-red-500/20 text-red-300';
  if (section === 'Ongoing') return 'bg-amber-500/20 text-amber-300';
  if (section === 'QC Rework') return 'bg-teal-500/20 text-teal-300';
  if (section === 'Hour Based') return 'bg-violet-500/20 text-violet-300';
  return 'bg-blue-500/20 text-blue-300';
}

function demandDateValue(value?: string | null) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function demandReadiness(row: GroupedDemandRow) {
  if (isHourBasedRow(row)) {
    return {
      label: 'Hour based',
      className: 'bg-blue-500/20 text-blue-300',
    };
  }

  if (row.wall_names.length === 0) {
    return {
      label: 'Check walls',
      className: 'bg-amber-500/20 text-amber-300',
    };
  }

  if (Number(row.productivity_per_hour || 0) <= 0) {
    return {
      label: 'Check rate',
      className: 'bg-red-500/20 text-red-300',
    };
  }

  return {
    label: 'Ready',
    className: 'bg-emerald-500/20 text-emerald-300',
  };
}

function RecommendedWorkspace({
  run,
  assignmentDate,
  setAssignmentDate,
  capacity,
  assignedHours,
  balanceHours,
  helperAvailableHours,
  helperAssignedHours,
  helperBalanceHours,
  demandItems,
  demandWalls,
  liveDemandRows,
  activeRecommendations,
  removedRecommendations,
  recommendationWalls,
  actionLoading,
  onRegenerate,
  onFinalize,
  onAddFull,
  onAddPartial,
  onAddHours,
  onRemove,
  onRestore,
  onModeChange,
}: {
  run: AssignmentRun | null;
  assignmentDate: string;
  setAssignmentDate: React.Dispatch<React.SetStateAction<string>>;
  capacity: CapacitySnapshot;
  assignedHours: number;
  balanceHours: number;
  helperAvailableHours: number;
  helperAssignedHours: number;
  helperBalanceHours: number;
  demandItems: WorkDemandItem[];
  demandWalls: WorkDemandWallSnapshot[];
  liveDemandRows: AssignmentDemandRow[];
  activeRecommendations: RecommendedAssignment[];
  removedRecommendations: RecommendedAssignment[];
  recommendationWalls: RecommendedAssignmentWall[];
  actionLoading: boolean;
  onRegenerate: () => void;
  onFinalize: () => void;
  onAddFull: (row: GroupedDemandRow) => void;
  onAddPartial: (row: GroupedDemandRow) => void;
  onAddHours: (row: GroupedDemandRow) => void;
  onRemove: (recommendationId: string) => void;
  onRestore: (recommendationId: string) => void;
  onModeChange: (recommendationId: string, mode: WorkMode) => void;
}) {
  const capacityUsedRawPct =
    capacity.availableHours > 0
      ? (assignedHours / capacity.availableHours) * 100
      : 0;

  const capacityUsedBarPct = Math.min(
    100,
    Math.max(0, capacityUsedRawPct),
  );
  const helperCapacityUsedRawPct =
    helperAvailableHours > 0
      ? (helperAssignedHours / helperAvailableHours) * 100
      : 0;
  const helperCapacityUsedBarPct = Math.min(
    100,
    Math.max(0, helperCapacityUsedRawPct),
  );

  const demandSource = demandItems.length > 0 ? demandItems : liveDemandRows;

  function getFlatSortNumber(flat: string | null | undefined) {
    const digits = String(flat || '').replace(/\D/g, '');
    return digits ? Number(digits) : Number.MAX_SAFE_INTEGER;
  }

  function compareText(
    a: string | null | undefined,
    b: string | null | undefined,
  ) {
    return String(a || '').localeCompare(String(b || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }

  const groupedActiveRecommendations = useMemo(() => {
    const sortedRows = [...activeRecommendations].sort((a, b) => {
      const applicationCompare = compareText(a.application, b.application);

      if (applicationCompare !== 0) {
        return applicationCompare;
      }

      const flatNumberCompare =
        getFlatSortNumber(a.flat) - getFlatSortNumber(b.flat);

      if (flatNumberCompare !== 0) {
        return flatNumberCompare;
      }

      const flatTextCompare = compareText(a.flat, b.flat);

      if (flatTextCompare !== 0) {
        return flatTextCompare;
      }

      const layerCompare = compareText(a.layer_name, b.layer_name);

      if (layerCompare !== 0) {
        return layerCompare;
      }

      const surfacePriority = (surface?: string | null) => {
        const value = norm(surface);

        if (value === 'CEILING') return 1;
        if (value === 'WALL') return 2;

        return 3;
      };

      return surfacePriority(a.surface_type) - surfacePriority(b.surface_type);
    });

    const map = new Map<string, RecommendedAssignment[]>();

    sortedRows.forEach((row) => {
      const application = row.application || 'Unknown Application';

      if (!map.has(application)) {
        map.set(application, []);
      }

      map.get(application)!.push(row);
    });

    return Array.from(map.entries()).map(([application, rows]) => ({
      application,
      rows,
      totalRows: rows.length,
      totalArea: rows.reduce(
        (sum, row) => sum + Number(row.assigned_area || 0),
        0,
      ),
      totalHours: rows.reduce(
        (sum, row) => sum + Number(row.required_hours || 0),
        0,
      ),
    }));
  }, [activeRecommendations]);

  return (
    <div className="pb-44">
      {/* Page heading: publishing stays in the bottom bar so the user cannot miss it. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">
            Recommended Assignment
          </h2>
          <p className="mt-1 text-sm text-slate-500">
              
          </p>
        </div>

        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:w-auto">
          <ResponsiveDatePicker
            id="recommended-plan-date"
            label="Plan Date"
            value={assignmentDate}
            onChange={setAssignmentDate}
            disabled={actionLoading}
          />

          <button
            type="button"
            onClick={onRegenerate}
            disabled={actionLoading}
            className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-semibold hover:bg-slate-800 disabled:opacity-60 sm:px-4 sm:text-sm"
          >
            Regenerate
          </button>
        </div>
      </div>

      {/* Recommended plan: full width, compact and without a horizontal scrollbar. */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <div>
            <h3 className="font-display text-base font-bold">Plan rows</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {activeRecommendations.length} rows · {formatNumber(assignedHours)} h
            </p>
          </div>

          {run && (
            <StatusPill tone={run.status === 'FINALIZED' ? 'green' : 'amber'}>
              {run.status}
            </StatusPill>
          )}
        </div>

        <div className="w-full">
          <table className="w-full table-fixed border-collapse text-[12px]">
            <colgroup>
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[14%]" />
              <col className="w-[23%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
              <col className="w-[9%]" />
              <col className="w-[7%]" />
              <col className="w-[6%]" />
              <col className="w-[5%]" />
            </colgroup>

            <thead className="bg-slate-950/45 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="border-b border-slate-800 px-2 py-2">Priority</th>
                <th className="border-b border-slate-800 px-2 py-2">Flat</th>
                <th className="border-b border-slate-800 px-2 py-2">Layer</th>
                <th className="border-b border-slate-800 px-2 py-2">
                  Surface / Walls
                </th>
                <th className="border-b border-slate-800 px-2 py-2">Area</th>
                <th className="border-b border-slate-800 px-2 py-2">Mode</th>
                <th className="border-b border-slate-800 px-2 py-2">
                  Productivity
                </th>
                <th className="border-b border-slate-800 px-2 py-2">Hours</th>
                <th className="border-b border-slate-800 px-2 py-2">Source</th>
                <th className="border-b border-slate-800 px-2 py-2 text-right">
                  Action
                </th>
              </tr>
            </thead>

            <tbody>
              {groupedActiveRecommendations.map((group) => (
                <Fragment key={group.application}>
                  <tr className="bg-slate-950/80">
                    <td
                      colSpan={10}
                      className="border-b border-slate-800 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-cyan-400" />
                          <span className="font-display text-sm font-bold text-cyan-300">
                            {group.application}
                          </span>
                        </div>

                        <span className="text-[11px] font-medium text-slate-500">
                          {group.totalRows} rows · {formatNumber(group.totalArea)} sqft ·{' '}
                          {formatNumber(group.totalHours)} h
                        </span>
                      </div>
                    </td>
                  </tr>

                  {group.rows.map((row) => {
                const hourBased = isHourBasedRow(row);
                const recommendationWallNames = hourBased
                  ? []
                  : wallNamesForRecommendedRow(
                      row,
                      recommendationWalls,
                      demandWalls,
                    );

                return (
                  <tr
                    key={row.recommendation_id}
                    className="border-b border-slate-800/80 align-top hover:bg-slate-800/40"
                  >
                    <td className="px-2 py-2.5">
                      <SectionPill
                        section={
                          row.recommendation_reason ||
                          row.assignment_type ||
                          'Recommended'
                        }
                      />
                    </td>

                    <td className="break-words px-2 py-2.5 font-mono font-semibold text-cyan-400">
                      {row.flat}
                    </td>

                    <td className="break-words px-2 py-2.5 font-semibold text-slate-100">
                      {row.layer_name}
                    </td>

                    <td className="break-words px-2 py-2.5 text-slate-400">
                      {hourBased ? (
                        <span>Hour-based work</span>
                      ) : (
                        <div className="space-y-1">
                          <div className="text-slate-300">
                            {row.surface_type || '-'}
                          </div>
                          <ExpandableWallNames
                            wallNames={recommendationWallNames}
                          />
                        </div>
                      )}
                    </td>

                    <td className="px-2 py-2.5 font-mono">
                      {hourBased ? '-' : formatNumber(row.assigned_area)}
                    </td>

                    <td className="px-2 py-2.5">
                      {hourBased ? (
                        <span className="text-slate-500">-</span>
                      ) : (
                        <select
                          value={(row.machine_or_manual || 'Both') as string}
                          onChange={(event) =>
                            onModeChange(
                              row.recommendation_id,
                              event.target.value as WorkMode,
                            )
                          }
                          className="w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] outline-none focus:border-amber-400"
                        >
                          {WORK_MODES.map((mode) => (
                            <option key={mode} value={mode}>
                              {mode}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    <td className="px-2 py-2.5 font-mono">
                      {hourBased
                        ? '-'
                        : `${formatNumber(
                            row.selected_productivity_per_hour || 0,
                          )}/hr`}
                    </td>

                    <td className="px-2 py-2.5 font-mono font-semibold text-amber-300">
                      {formatNumber(row.required_hours || 0)} h
                    </td>

                    <td className="px-2 py-2.5">
                      {row.is_manual_edit ? (
                        <StatusPill tone="amber">Edited</StatusPill>
                      ) : (
                        <StatusPill tone="green">System</StatusPill>
                      )}
                    </td>

                    <td className="px-2 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => onRemove(row.recommendation_id)}
                        className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[10px] font-bold text-red-300 hover:bg-red-500/20"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
                </Fragment>
              ))}

              {groupedActiveRecommendations.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-3 py-8 text-center text-sm text-slate-500"
                  >
                    No plan rows yet. Generate the plan or add work from Tomorrow
                    Work Demand below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Existing Tomorrow Work Demand functionality is unchanged; only its position changes. */}
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-4">
          <h3 className="font-display text-base font-bold">
            Tomorrow Work Demand
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            
          </p>
        </div>

        <div className="space-y-4">
          {SECTION_ORDER.map((section) => (
            <WorkspaceDemandSection
              key={section}
              section={section}
              rows={
                demandSource.filter(
                  (row: any) => norm(demandSectionName(row)) === norm(section),
                ) as Array<WorkDemandItem | AssignmentDemandRow>
              }
              demandWalls={demandWalls}
              activeRecommendations={activeRecommendations}
              removedRecommendations={removedRecommendations}
              recommendationWalls={recommendationWalls}
              onAddFull={onAddFull}
              onAddPartial={onAddPartial}
              onAddHours={onAddHours}
              onRestore={onRestore}
            />
          ))}
        </div>
      </div>

      {/* Fixed publish bar: same workflow and handlers, only the layout changes. */}
      <div
        className={`fixed bottom-20 left-4 right-4 z-30 rounded-2xl border bg-slate-900/95 px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur md:left-[17.5rem] ${
          balanceHours < 0 ? 'border-red-500/50' : 'border-slate-700'
        }`}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-[260px] flex-1 space-y-2">
            <CapacityUsageBar
              label="Painter hours"
              available={capacity.availableHours}
              assigned={assignedHours}
              balance={balanceHours}
              usedPct={capacityUsedRawPct}
              barPct={capacityUsedBarPct}
            />

            <CapacityUsageBar
              label="Helper hours"
              available={helperAvailableHours}
              assigned={helperAssignedHours}
              balance={helperBalanceHours}
              usedPct={helperCapacityUsedRawPct}
              barPct={helperCapacityUsedBarPct}
            />
          </div>

          <button
            type="button"
            onClick={onFinalize}
            disabled={actionLoading || !run}
            className="ml-auto rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Publish Plan
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkspaceDemandSection({
  section,
  rows,
  demandWalls,
  activeRecommendations,
  removedRecommendations,
  recommendationWalls,
  onAddFull,
  onAddPartial,
  onAddHours,
  onRestore,
}: {
  section: string;
  rows: Array<WorkDemandItem | AssignmentDemandRow>;
  demandWalls: WorkDemandWallSnapshot[];
  activeRecommendations: RecommendedAssignment[];
  removedRecommendations: RecommendedAssignment[];
  recommendationWalls: RecommendedAssignmentWall[];
  onAddFull: (row: GroupedDemandRow) => void;
  onAddPartial: (row: GroupedDemandRow) => void;
  onAddHours: (row: GroupedDemandRow) => void;
  onRestore: (recommendationId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const groupedRows = useMemo(() => {
    return groupDemandRows(rows, demandWalls)
      .map((row) => {
        const demandId = row.demand_id || '';

        const activeRows = activeRecommendations.filter((rec) =>
          recommendationMatchesDemandRow(rec, row),
        );

        const removedRows = removedRecommendations.filter((rec) =>
          recommendationMatchesDemandRow(rec, row),
        );

        const manuallyRemoved =
          activeRows.length === 0
            ? removedRows.find((rec) => isManualRemovedRecommendation(rec))
            : undefined;

        const autoRemoved =
          activeRows.length === 0
            ? removedRows.find((rec) => isAutoRemovedRecommendation(rec))
            : undefined;

        const hourBased = isHourBasedRow(row);

        const assignedWallNames = hourBased
          ? new Set<string>()
          : selectedWallNamesForRecommendations(
              activeRows,
              recommendationWalls,
            );

        const hasKnownAssignedWalls = !hourBased && assignedWallNames.size > 0;

        const remainingWallDetails = hourBased
          ? row.wall_details
          : hasKnownAssignedWalls
            ? row.wall_details.filter(
                (wall) => !assignedWallNames.has(norm(wall.wall_name)),
              )
            : row.wall_details;

        const remainingWallNames = remainingWallDetails.map((wall) => wall.wall_name);
        const activeAssignedArea = activeRows.reduce(
          (sum, rec) => sum + Number(rec.assigned_area || 0),
          0,
        );

        const originalArea = Number(row.remaining_area || 0);
        const remainingArea = Math.max(0, originalArea - activeAssignedArea);

        const productivity = Number(row.productivity_per_hour || 0);
        const remainingHours =
          productivity > 0
            ? remainingArea / productivity
            : remainingWallDetails.reduce(
                (sum, wall) => sum + Number(wall.hours || 0),
                0,
              );

        const hasActivePartial = activeRows.length > 0 && remainingArea > 0;

        return {
          ...row,
          demandId,
          activeRows,
          manuallyRemoved,
          autoRemoved,
          hasActivePartial,
          is_hour_based: hourBased,
          wall_names: hourBased ? [] : remainingWallNames,
          wall_details: remainingWallDetails,
          remaining_area: remainingArea,
          required_hours: remainingHours,
          remainingArea,
          remainingHours,
        };
      })
      .filter((row) => {
        // Hide full rows already fully selected in recommended assignment.
        if (row.activeRows.length > 0 && row.remainingArea <= 0) return false;

        // Manually removed rows are shown as Restore + Add Partial.
        if (row.manuallyRemoved) return true;

        // Auto removed rows and normal rows are still assignable. Park Heights
        // Touchup sequence demand is valid even when its wall children are lazy
        // and have not been loaded into the frontend yet.
        return (
          row.remainingArea > 0 &&
          (
            row.is_hour_based ||
            row.wall_details.length > 0 ||
            isTouchupPainterFirstLayerName(row.layer_name)
          )
        );
      });
  }, [activeRecommendations, demandWalls, removedRecommendations, recommendationWalls, rows]);

  function toggle(key: string) {
    setExpanded((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-300">
        <span className={`h-2 w-2 rounded-sm ${SECTION_COLORS[section] || 'bg-slate-400'}`} />
        {section}
      </div>

      <DemandTree
        rows={groupedRows}
        expanded={expanded}
        onToggle={toggle}
        renderAction={(row: any) => {
          if (!row.demandId) {
            return <span className="text-xs text-slate-500">Generate run first</span>;
          }

          if (isHourBasedRow(row)) {
            if (row.manuallyRemoved) {
              return (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onRestore(row.manuallyRemoved.recommendation_id)}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold hover:bg-slate-700"
                  >
                    Restore
                  </button>

                  <button
                    type="button"
                    onClick={() => onAddHours(row)}
                    className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/20"
                  >
                    Add Hours
                  </button>
                </div>
              );
            }

            return (
              <button
                type="button"
                onClick={() =>
                  row.autoRemoved
                    ? onRestore(row.autoRemoved.recommendation_id)
                    : onAddHours(row)
                }
                className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/20"
              >
                Add Hours
              </button>
            );
          }

          if (row.manuallyRemoved) {
            return (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onRestore(row.manuallyRemoved.recommendation_id)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold hover:bg-slate-700"
                >
                  Restore
                </button>

                <button
                  type="button"
                  onClick={() => onAddPartial(row)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold hover:bg-slate-700"
                >
                  Add Partial
                </button>
              </div>
            );
          }

          return (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  row.autoRemoved
                    ? onRestore(row.autoRemoved.recommendation_id)
                    : onAddFull(row)
                }
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold hover:bg-slate-700"
              >
                Add
              </button>

              <button
                type="button"
                onClick={() => onAddPartial(row)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold hover:bg-slate-700"
              >
                Add Partial
              </button>
            </div>
          );
        }}
      />
    </div>
  );
}

function PartialWorkModal({
  row,
  balanceHours,
  actionLoading,
  onClose,
  onSubmit,
}: {
  row: GroupedDemandRow;
  balanceHours: number;
  actionLoading: boolean;
  onClose: () => void;
  onSubmit: (selectedWalls: string[]) => void;
}) {
  const [selectedWalls, setSelectedWalls] = useState<string[]>([]);
  const [wallSearchText, setWallSearchText] = useState('');

  const selectedWallSet = useMemo(
    () => new Set(selectedWalls.map((wall) => norm(wall))),
    [selectedWalls],
  );

  const selectedArea = row.wall_details.reduce(
    (sum, wall) => selectedWallSet.has(norm(wall.wall_name)) ? sum + Number(wall.area || 0) : sum,
    0,
  );

  const selectedHours = row.productivity_per_hour > 0
    ? selectedArea / row.productivity_per_hour
    : row.wall_details.reduce(
        (sum, wall) => selectedWallSet.has(norm(wall.wall_name)) ? sum + Number(wall.hours || 0) : sum,
        0,
      );

  const visibleWallDetails = useMemo(() => {
    const query = norm(wallSearchText);

    if (!query) return row.wall_details;

    // Same rule as reporting wall picker: search filters by STARTING letters.
    return row.wall_details.filter((wall) => norm(wall.wall_name).startsWith(query));
  }, [row.wall_details, wallSearchText]);

  function toggleWall(wallName: string) {
    setSelectedWalls((current) =>
      current.includes(wallName)
        ? current.filter((item) => item !== wallName)
        : [...current, wallName],
    );
  }

  function selectSuggestedWalls() {
    let usedHours = 0;
    const selected: string[] = [];

    for (const wall of visibleWallDetails) {
      const nextHours = row.productivity_per_hour > 0
        ? Number(wall.area || 0) / row.productivity_per_hour
        : Number(wall.hours || 0);

      if (usedHours + nextHours <= Math.max(balanceHours, 0)) {
        selected.push(wall.wall_name);
        usedHours += nextHours;
      }
    }

    setSelectedWalls(selected);
  }

  function selectAllVisibleWalls() {
    setSelectedWalls((current) =>
      Array.from(
        new Set([
          ...current,
          ...visibleWallDetails.map((wall) => wall.wall_name),
        ]),
      ),
    );
  }

  const overBalance = selectedHours > balanceHours && balanceHours >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h3 className="font-display text-xl font-bold text-white">Add Partial Work by Walls</h3>
            <p className="mt-1 text-sm text-slate-400">
              {row.application} · {row.flat} · {row.layer_name} · {row.surface_type || '-'}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <KpiCard label="Balance Hours" value={`${formatNumber(balanceHours)} h`} />
          <KpiCard label="Selected Hours" value={`${formatNumber(selectedHours)} h`} />
          <KpiCard label="Selected Area" value={`${formatNumber(selectedArea)} sqft`} />
          <KpiCard label="Selected Walls" value={selectedWalls.length} />
        </div>

        {overBalance && (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            Selected walls exceed current balance hours. Remove a wall or continue only if you intentionally want over-capacity.
          </div>
        )}

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-3">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
            Search Wall Name
          </label>
          <input
            value={wallSearchText}
            onChange={(event) => setWallSearchText(event.target.value)}
            placeholder="Example: C"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-400"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Showing {visibleWallDetails.length} of {row.wall_details.length} walls
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={selectSuggestedWalls}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-bold hover:bg-slate-800"
          >
            Auto select within balance
          </button>

          <button
            type="button"
            onClick={selectAllVisibleWalls}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-bold hover:bg-slate-800"
          >
            Select all displayed
          </button>

          <button
            type="button"
            onClick={() => setSelectedWalls([])}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-bold hover:bg-slate-800"
          >
            Clear
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[700px] border-collapse text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="border-b border-slate-800 px-3 py-2">Select</th>
                <th className="border-b border-slate-800 px-3 py-2">Wall</th>
                <th className="border-b border-slate-800 px-3 py-2">Area</th>
                <th className="border-b border-slate-800 px-3 py-2">Hours</th>
              </tr>
            </thead>

            <tbody>
              {visibleWallDetails.map((wall) => {
                const checked = selectedWallSet.has(norm(wall.wall_name));
                const hours = row.productivity_per_hour > 0
                  ? Number(wall.area || 0) / row.productivity_per_hour
                  : Number(wall.hours || 0);

                return (
                  <tr key={wall.wall_name} className="border-b border-slate-800/80 hover:bg-slate-900">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleWall(wall.wall_name)}
                      />
                    </td>
                    <td className="px-3 py-3 font-semibold text-cyan-300">{wall.wall_name}</td>
                    <td className="px-3 py-3 font-mono">{formatNumber(wall.area)}</td>
                    <td className="px-3 py-3 font-mono text-amber-300">{formatNumber(hours)} h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={actionLoading || selectedWalls.length === 0}
            onClick={() => onSubmit(selectedWalls)}
            className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
          >
            {actionLoading ? 'Adding...' : 'Add Selected Walls'}
          </button>
        </div>
      </div>
    </div>
  );
}


function AddHoursModal({
  row,
  balanceHours,
  actionLoading,
  onClose,
  onSubmit,
}: {
  row: GroupedDemandRow;
  balanceHours: number;
  actionLoading: boolean;
  onClose: () => void;
  onSubmit: (hoursToAssign: number) => void;
}) {
  const remainingHours = Number(row.remaining_hours ?? row.remainingHours ?? row.required_hours ?? row.remaining_area ?? 0);
  const reportedHours = Number(row.reported_hours ?? 0);
  const totalHours = Number(row.total_hours ?? 24);
  const [hoursToAssign, setHoursToAssign] = useState(() =>
    roundToTwo(
      Math.max(
        0,
        Math.min(
          remainingHours || totalHours,
          Math.max(balanceHours, 0) || remainingHours || 0,
        ),
      ),
    ),
  );

  const exceedsRemaining = remainingHours > 0 && hoursToAssign > remainingHours;
  const exceedsBalance = balanceHours >= 0 && hoursToAssign > balanceHours;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h3 className="font-display text-xl font-bold text-white">Add Hours</h3>
            <p className="mt-1 text-sm text-slate-400">
              {row.application} · {row.flat} · {row.layer_name}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label="Total Planned" value={`${formatNumber(totalHours)} h`} />
          <KpiCard label="Reported" value={`${formatNumber(reportedHours)} h`} />
          <KpiCard label="Remaining" value={`${formatNumber(remainingHours)} h`} />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
            Hours to assign
          </label>
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={hoursToAssign}
            onChange={(event) => setHoursToAssign(Number(event.target.value) || 0)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-amber-400"
          />
        </div>

        {exceedsRemaining && (
          <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            Only {formatNumber(remainingHours)} hours are remaining for this layer.
          </div>
        )}

        {exceedsBalance && (
          <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            This exceeds the current capacity balance of {formatNumber(balanceHours)} hours.
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={actionLoading || hoursToAssign <= 0 || exceedsRemaining}
            onClick={() => onSubmit(roundToTwo(hoursToAssign))}
            className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
          >
            {actionLoading ? 'Adding...' : 'Add Hours'}
          </button>
        </div>
      </div>
    </div>
  );
}


function DemandTree({
  rows,
  expanded,
  onToggle,
  renderAction,
}: {
  rows: any[];
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  renderAction?: (row: any) => ReactNode;
}) {
  const tree = useMemo(() => {
    const blockMap = new Map<string, any>();

    rows.forEach((row) => {
      const block = row.block || 'No Block';
      const application = row.application || 'No Application';
      const flat = row.flat || 'No Flat';

      if (!blockMap.has(block)) {
        blockMap.set(block, {
          key: `block:${block}`,
          name: block,
          applications: new Map<string, any>(),
        });
      }

      const blockNode = blockMap.get(block);

      if (!blockNode.applications.has(application)) {
        blockNode.applications.set(application, {
          key: `block:${block}|app:${application}`,
          name: application,
          flats: new Map<string, any>(),
        });
      }

      const appNode = blockNode.applications.get(application);

      if (!appNode.flats.has(flat)) {
        appNode.flats.set(flat, {
          key: `block:${block}|app:${application}|flat:${flat}`,
          name: flat,
          layers: [],
        });
      }

      appNode.flats.get(flat).layers.push(row);
    });

    return Array.from(blockMap.values()).map((block) => ({
      ...block,
      applications: Array.from(block.applications.values()).map((application: any) => ({
        ...application,
        flats: Array.from(application.flats.values()),
      })),
    }));
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-500">
        No assignable rows.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tree.map((block) => (
        <div key={block.key} className="rounded-xl border border-slate-800 bg-slate-950">
          <button
            type="button"
            onClick={() => onToggle(block.key)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-bold text-slate-100 hover:bg-slate-900"
          >
            <span>{expanded[block.key] ? '▾' : '▸'} {block.name}</span>
            <span className="text-xs text-slate-500">
              {block.applications.length} applications
            </span>
          </button>

          {expanded[block.key] && (
            <div className="space-y-2 border-t border-slate-800 p-3">
              {block.applications.map((application: any) => (
                <div key={application.key} className="rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => onToggle(application.key)}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-semibold text-slate-200 hover:bg-slate-900"
                  >
                    <span>{expanded[application.key] ? '▾' : '▸'} {application.name}</span>
                    <span className="text-xs text-slate-500">
                      {application.flats.length} flats
                    </span>
                  </button>

                  {expanded[application.key] && (
                    <div className="space-y-2 border-t border-slate-800 p-3">
                      {application.flats.map((flat: any) => (
                        <div key={flat.key} className="rounded-lg border border-slate-800">
                          <button
                            type="button"
                            onClick={() => onToggle(flat.key)}
                            className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-semibold text-cyan-300 hover:bg-slate-900"
                          >
                            <span>{expanded[flat.key] ? '▾' : '▸'} {flat.name}</span>
                            <span className="text-xs text-slate-500">
                              {flat.layers.length} layers
                            </span>
                          </button>

                          {expanded[flat.key] && (
                            <div className="overflow-x-auto border-t border-slate-800">
                              <table className="w-full min-w-[750px] border-collapse text-sm">
                                <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                                  <tr>
                                    <th className="px-3 py-2">Layer</th>
                                    <th className="px-3 py-2">Surface</th>
                                    <th className="px-3 py-2">Walls</th>
                                    <th className="px-3 py-2">Qty</th>
                                    <th className="px-3 py-2">Hours</th>
                                    <th className="px-3 py-2">Date</th>
                                    {renderAction && <th className="px-3 py-2">Action</th>}
                                  </tr>
                                </thead>

                                <tbody>
                                  {flat.layers.map((row: any) => {
                                    const wallKey = `walls:${row.key}`;
                                    const hourBased = isHourBasedRow(row);
                                    const displayHours = Number(row.remainingHours ?? row.required_hours ?? row.remaining_hours ?? row.remaining_area ?? 0);

                                    return (
                                      <tr
                                        key={row.key}
                                        className="border-t border-slate-800/80 hover:bg-slate-900"
                                      >
                                        <td className="px-3 py-3 font-semibold">{row.layer_name}</td>
                                        <td className="px-3 py-3">{hourBased ? '-' : row.surface_type || '-'}</td>
                                        <td className="px-3 py-3">
                                          {hourBased ? (
                                            <span className="text-xs font-semibold text-slate-500">Hour-based</span>
                                          ) : row.wall_names.length === 0 ? (
                                            <span className="text-xs font-semibold text-amber-300">
                                              Walls load on Add
                                            </span>
                                          ) : (
                                            <>
                                              <button
                                                type="button"
                                                onClick={() => onToggle(wallKey)}
                                                className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-semibold hover:bg-slate-800"
                                              >
                                                {expanded[wallKey] ? 'Hide' : 'Show'} {row.wall_names.length} walls
                                              </button>

                                              {expanded[wallKey] && (
                                                <div className="mt-2 max-w-md text-xs leading-5 text-slate-400">
                                                  {row.wall_names.join(', ')}
                                                </div>
                                              )}
                                            </>
                                          )}
                                        </td>
                                        <td className="px-3 py-3 font-mono">
                                          {hourBased
                                            ? `${formatNumber(displayHours)} h`
                                            : formatNumber(row.remainingArea ?? row.remaining_area)}
                                        </td>
                                        <td className="px-3 py-3 font-mono text-amber-300">
                                          {formatNumber(displayHours)} h
                                        </td>
                                        <td className="px-3 py-3 font-mono text-slate-400">
                                          {shortDate(row.oldest_date)}
                                        </td>
                                        {renderAction && (
                                          <td className="px-3 py-3">
                                            {renderAction(row)}
                                          </td>
                                        )}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


function CapacityPage({
  capacity,
  capacitySource,
  assignedHours,
  helperAssignedHours,
  painters,
}: {
  capacity: CapacitySnapshot;
  capacitySource: string;
  assignedHours: number;
  helperAssignedHours: number;
  painters: AssignmentPainter[];
}) {
  const balance = capacity.availableHours - assignedHours;
  const helperBalance = capacity.helperAvailableHours - helperAssignedHours;
  const utilization =
    capacity.availableHours > 0 ? (assignedHours / capacity.availableHours) * 100 : 0;
  const helperUtilization =
    capacity.helperAvailableHours > 0
      ? (helperAssignedHours / capacity.helperAvailableHours) * 100
      : 0;

  return (
    <>
      <PageHeading
        title="Painter capacity"
        subtitle=""
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <KpiCard
          label="Available Painters"
          value={capacity.availablePainters}
          sub={capacitySource}
        />
        <KpiCard label="Painter Hours" value={capacity.availableHours} />
        <KpiCard label="Painter Assigned" value={`${formatNumber(assignedHours)} h`} />
        <KpiCard
          label="Painter Balance"
          value={`${formatNumber(balance)} h`}
          sub={`${formatNumber(utilization)}% utilized`}
        />
        <KpiCard
          label="Helper Hours"
          value={`${formatNumber(capacity.helperAvailableHours)} h`}
          sub={`${capacity.helperCount} helpers · ${formatNumber(helperAssignedHours)} h assigned · ${formatNumber(helperBalance)} h balance · ${formatNumber(helperUtilization)}% utilized`}
        />
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900">
        <table className="w-full border-collapse text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="p-3">Painter</th>
              <th className="p-3">ID</th>
              <th className="p-3">Site</th>
              <th className="p-3">Category</th>
              <th className="p-3">Status</th>
              <th className="p-3">Daily Wage</th>
            </tr>
          </thead>

          <tbody>
            {painters.map((painter) => (
              <tr key={painter.painter_id} className="border-t border-slate-800">
                <td className="p-3 font-semibold">{painterDisplay(painter)}</td>
                <td className="p-3 font-mono text-cyan-400">{painter.painter_id}</td>
                <td className="p-3">{painter.current_site || '-'}</td>
                <td className="p-3">{painter.category || '-'}</td>
                <td className="p-3">{painter.status || '-'}</td>
                <td className="p-3 font-mono">
                  {formatNumber(painter.daily_wage || 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FinalAssignmentPage({
  token,
  projectId,
  run,
  runs,
  activeRunId,
  finalAssignments,
  onRunChange,
  onReporting,
}: {
  token: string;
  projectId: string;
  run: AssignmentRun | null;
  runs: AssignmentRun[];
  activeRunId: string;
  finalAssignments: any[];
  onRunChange: (runId: string) => void;
  onReporting: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState(
    run?.assignment_date
      ? toDateInput(run.assignment_date)
      : todayDateInput(),
  );
  const [search, setSearch] = useState('');
  const [applicationFilter, setApplicationFilter] = useState('All');
  const [layerFilter, setLayerFilter] = useState('All');
  const [expandedFlat, setExpandedFlat] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<TodayPainterAttendance | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceError, setAttendanceError] = useState('');
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const attendanceRequestId = useRef(0);

  const loadTodayAttendance = useCallback(
    async (showLoader: boolean) => {
      if (!token || !projectId) {
        if (showLoader) setAttendanceLoading(false);
        return;
      }

      const requestId = ++attendanceRequestId.current;

      if (showLoader) {
        setAttendanceLoading(true);
      }

      try {
        const data = await fetchTodayPainterAttendance(token, projectId);

        if (requestId !== attendanceRequestId.current) return;

        setAttendance(data);
        setAttendanceError('');
      } catch (err) {
        if (requestId !== attendanceRequestId.current) return;

        setAttendanceError(errorMessage(err));
      } finally {
        if (showLoader && requestId === attendanceRequestId.current) {
          setAttendanceLoading(false);
        }
      }
    },
    [projectId, token],
  );

  useEffect(() => {
    setAttendance(null);
    setAttendanceError('');
    setAttendanceOpen(false);
    void loadTodayAttendance(true);

    const refreshTimer = window.setInterval(() => {
      void loadTodayAttendance(false);
    }, 60_000);

    return () => {
      attendanceRequestId.current += 1;
      window.clearInterval(refreshTimer);
    };
  }, [loadTodayAttendance]);

  const loadedRunDate = run?.assignment_date
    ? toDateInput(run.assignment_date)
    : '';

  useEffect(() => {
    if (loadedRunDate) {
      setSelectedDate(loadedRunDate);
    }
  }, [loadedRunDate, run?.run_id]);

  const runsForSelectedDate = useMemo(
    () =>
      runs.filter(
        (candidate) =>
          Boolean(candidate.assignment_date) &&
          toDateInput(candidate.assignment_date) === selectedDate,
      ),
    [runs, selectedDate],
  );

  const selectedDateHasRun = runsForSelectedDate.length > 0;
  const selectedDateMatchesLoadedRun =
    Boolean(run) && loadedRunDate === selectedDate;

  const selectedRun = useMemo(
    () =>
      runsForSelectedDate.find(
        (candidate) => candidate.run_id === activeRunId,
      ) ||
      runsForSelectedDate.find((candidate) => {
        const status = norm(candidate.status);
        return status.includes('FINAL') || status.includes('PUBLISH');
      }) ||
      runsForSelectedDate[0] ||
      null,
    [activeRunId, runsForSelectedDate],
  );

  const assignmentsForSelectedDate = useMemo(() => {
    if (!selectedDateMatchesLoadedRun) return [];

    return finalAssignments.filter((row) => {
      const rowDate = row.assignment_date
        ? toDateInput(row.assignment_date)
        : loadedRunDate;

      return rowDate === selectedDate;
    });
  }, [
    finalAssignments,
    loadedRunDate,
    selectedDate,
    selectedDateMatchesLoadedRun,
  ]);

  const applications = useMemo(
    () =>
      Array.from(
        new Set(
          assignmentsForSelectedDate
            .map((row) => String(row.application || '').trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [assignmentsForSelectedDate],
  );

  const layers = useMemo(
    () =>
      Array.from(
        new Set(
          assignmentsForSelectedDate
            .map((row) => String(row.layer_name || '').trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [assignmentsForSelectedDate],
  );

  const visibleAssignments = useMemo(() => {
    const query = norm(search);

    return assignmentsForSelectedDate
      .filter(
        (row) =>
          applicationFilter === 'All' ||
          norm(row.application) === norm(applicationFilter),
      )
      .filter(
        (row) =>
          layerFilter === 'All' || norm(row.layer_name) === norm(layerFilter),
      )
      .filter((row) => {
        if (!query) return true;

        const painters = Array.isArray(row.assigned_painter_names)
          ? row.assigned_painter_names.join(', ')
          : String(row.assigned_painter_names || '');

        return norm(
          [
            row.assignment_date,
            row.application,
            row.block,
            row.flat,
            row.layer_name,
            row.surface_type,
            row.machine_or_manual,
            row.status,
            painters,
          ].join(' '),
        ).includes(query);
      })
      .sort((a, b) => {
        const flatCompare = String(a.flat || '').localeCompare(
          String(b.flat || ''),
          undefined,
          { numeric: true },
        );

        if (flatCompare !== 0) return flatCompare;

        return String(a.layer_name || '').localeCompare(
          String(b.layer_name || ''),
        );
      });
  }, [
    applicationFilter,
    assignmentsForSelectedDate,
    layerFilter,
    search,
  ]);

  const groupedByFlat = useMemo(() => {
    const groups = new Map<string, any[]>();

    visibleAssignments.forEach((row) => {
      const flat = String(row.flat || 'No Flat');
      const current = groups.get(flat) || [];
      current.push(row);
      groups.set(flat, current);
    });

    return Array.from(groups.entries()).map(([flat, rows]) => ({
      flat,
      rows,
    }));
  }, [visibleAssignments]);

  useEffect(() => {
    if (groupedByFlat.length === 0) {
      setExpandedFlat(null);
      return;
    }

    if (
      !expandedFlat ||
      !groupedByFlat.some((group) => group.flat === expandedFlat)
    ) {
      setExpandedFlat(groupedByFlat[0].flat);
    }
  }, [expandedFlat, groupedByFlat]);

  const summary = useMemo(() => {
    const flats = new Set(
      visibleAssignments.map((row) => String(row.flat || '')),
    );

    const area = visibleAssignments.reduce((sum, row) => {
      if (isHourBasedLayerName(row.layer_name)) return sum;
      return sum + Number(row.assigned_area || 0);
    }, 0);

    const hours = visibleAssignments.reduce(
      (sum, row) => sum + Number(row.expected_hours || 0),
      0,
    );

    return {
      flats: Array.from(flats).filter(Boolean).length,
      assignments: visibleAssignments.length,
      area,
      hours,
    };
  }, [visibleAssignments]);

  function handleDateChange(value: string) {
    setSelectedDate(value);
    setSearch('');
    setApplicationFilter('All');
    setLayerFilter('All');
    setExpandedFlat(null);

    const dateRuns = runs.filter(
      (candidate) =>
        Boolean(candidate.assignment_date) &&
        toDateInput(candidate.assignment_date) === value,
    );

    const preferredRun =
      dateRuns.find((candidate) => {
        const status = norm(candidate.status);
        return status.includes('FINAL') || status.includes('PUBLISH');
      }) ||
      dateRuns[0] ||
      null;

    if (preferredRun && preferredRun.run_id !== activeRunId) {
      onRunChange(preferredRun.run_id);
    }
  }

  function exportFinalAssignments() {
    if (visibleAssignments.length === 0) return;

    const headers = [
      'Date',
      'Application',
      'Flat',
      'Layer',
      'Surface',
      'Area',
      'Hours',
      'Mode',
      'Painters',
      'Status',
    ];

    const values = visibleAssignments.map((row) => {
      const hourBased = isHourBasedLayerName(row.layer_name);
      const painters = Array.isArray(row.assigned_painter_names)
        ? row.assigned_painter_names.join(', ')
        : String(row.assigned_painter_names || '');

      return [
        shortDate(row.assignment_date),
        row.application || '',
        row.flat || '',
        row.layer_name || '',
        hourBased ? '' : row.surface_type || '',
        hourBased ? '' : Number(row.assigned_area || 0),
        Number(row.expected_hours || 0),
        hourBased ? '' : row.machine_or_manual || '',
        painters,
        row.status || '',
      ];
    });

    const escapeCsv = (value: unknown) => {
      const valueText = String(value ?? '');
      return `"${valueText.replace(/"/g, '""')}"`;
    };

    const csv = [headers, ...values]
      .map((row) => row.map(escapeCsv).join(','))
      .join('\n');

    const blob = new Blob([`\uFEFF${csv}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = `final-assignment-${selectedDate}.csv`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const selectedRunStatus = norm(selectedRun?.status);
  const planLabel =
    assignmentsForSelectedDate.length > 0
      ? selectedRunStatus.includes('FINAL') ||
        selectedRunStatus.includes('PUBLISH')
        ? 'Published'
        : selectedRun?.status || 'Available'
      : selectedDateHasRun
        ? selectedRun?.status || 'No published plan'
        : 'No plan';

  const isLoadingSelectedDate =
    selectedDateHasRun && !selectedDateMatchesLoadedRun;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-2xl font-bold">
          Final Assignment
        </h2>
        <p className="mt-1 text-sm text-slate-500">
             
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 md:flex md:flex-wrap md:items-end md:justify-end">
        <ResponsiveDatePicker
          id="final-assignment-date"
          label="Assignment Date"
          value={selectedDate}
          onChange={handleDateChange}
        />

        <button
          type="button"
          onClick={exportFinalAssignments}
          disabled={
            isLoadingSelectedDate || visibleAssignments.length === 0
          }
          className="h-10 self-end rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-sm"
        >
          ⇩ Export
        </button>

        <button
          type="button"
          onClick={onReporting}
          className="col-span-2 h-11 self-end rounded-lg bg-amber-400 px-5 text-sm font-bold text-slate-950 hover:bg-amber-300 md:col-span-1 md:h-10"
        >
          Start Reporting →
        </button>
      </div>

      <button
        type="button"
        onClick={() => {
          if (attendance) {
            setAttendanceOpen(true);
            return;
          }

          void loadTodayAttendance(true);
        }}
        aria-expanded={attendanceOpen}
        className="flex w-full items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-left transition hover:border-emerald-500/50 hover:bg-emerald-500/15"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-lg text-emerald-300">
          ◉
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-emerald-300">
            {attendanceLoading && !attendance
              ? "Checking today's painter attendance..."
              : attendance
                ? `${attendance.present_painter_count} ${
                    attendance.present_painter_count === 1 ? 'painter is' : 'painters are'
                  } present today at ${attendance.site_name}.`
                : "Today's painter attendance is unavailable."}
          </span>
          <span className="mt-0.5 block text-xs text-slate-400">
            {attendance
              ? 'Click to view painter name, clock-in time and clock-out time.'
              : attendanceError || 'Click to retry.'}
          </span>
        </span>

        <span className="hidden shrink-0 text-sm font-bold text-emerald-300 sm:inline">
          {attendance ? 'View details →' : attendanceLoading ? 'Loading...' : 'Retry →'}
        </span>
        <span className="shrink-0 text-lg font-bold text-emerald-300 sm:hidden">
          →
        </span>
      </button>

      <div className="overflow-hidden rounded-xl border border-cyan-500/25 bg-slate-900 shadow-[0_0_0_1px_rgba(34,211,238,0.03)]">
        <div className="grid grid-cols-4 divide-x divide-slate-800 md:grid-cols-5">
          <div className="hidden px-4 py-3 md:block">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              Plan
            </p>
            <p className="mt-1 font-bold text-slate-100">
              {planLabel}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {shortDate(selectedDate)}
            </p>
          </div>

          <FinalSummaryItem label="Flats" value={summary.flats} />
          <FinalSummaryItem
            label="Assignments"
            value={summary.assignments}
          />
          <FinalSummaryItem
            label="Area"
            value={formatNumber(summary.area)}
          />
          <FinalSummaryItem
            label="Hours"
            value={formatNumber(summary.hours)}
          />
        </div>
      </div>

      {isLoadingSelectedDate && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-5 text-center">
          <p className="font-semibold text-blue-300">
            Loading assignments for {shortDate(selectedDate)}...
          </p>
        </div>
      )}

      {!isLoadingSelectedDate && !selectedDateHasRun && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-6 text-center">
          <p className="font-semibold text-amber-300">
            No assignment plan exists for {shortDate(selectedDate)}.
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Select another date that has a generated or published plan.
          </p>
        </div>
      )}

      {!isLoadingSelectedDate && selectedDateHasRun && (
        <>
          <div className="grid gap-2 md:grid-cols-[minmax(240px,1fr)_180px_180px]">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Flat, layer, painter"
              className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-400"
            />

            <select
              value={applicationFilter}
              onChange={(event) =>
                setApplicationFilter(event.target.value)
              }
              className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-amber-400"
            >
              <option value="All">All applications</option>
              {applications.map((application) => (
                <option key={application} value={application}>
                  {application}
                </option>
              ))}
            </select>

            <select
              value={layerFilter}
              onChange={(event) => setLayerFilter(event.target.value)}
              className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-amber-400"
            >
              <option value="All">All layers</option>
              {layers.map((layer) => (
                <option key={layer} value={layer}>
                  {layer}
                </option>
              ))}
            </select>
          </div>

          {/* Mobile flat cards */}
          <div className="space-y-2 md:hidden">
            {groupedByFlat.map((group, groupIndex) => {
              const isExpanded = expandedFlat === group.flat;

              const groupArea = group.rows.reduce((sum, row) => {
                if (isHourBasedLayerName(row.layer_name)) return sum;
                return sum + Number(row.assigned_area || 0);
              }, 0);

              const groupHours = group.rows.reduce(
                (sum, row) =>
                  sum + Number(row.expected_hours || 0),
                0,
              );

              const application = group.rows[0]?.application || '-';

              const allPublished = group.rows.every((row) =>
                norm(row.status).includes('PUBLISH'),
              );

              return (
                <div
                  key={group.flat}
                  className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedFlat(
                        isExpanded ? null : group.flat,
                      )
                    }
                    className="flex w-full items-center gap-3 px-3 py-3 text-left"
                  >
                    <span className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-slate-800 font-mono text-xs font-bold text-amber-400">
                      {String(groupIndex + 1).padStart(2, '0')}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="font-mono text-sm text-slate-100">
                          {group.flat}
                        </strong>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400">
                          {application}
                        </span>
                      </span>

                      <span className="mt-1 block truncate text-[10px] text-slate-500">
                        {group.rows.length}{' '}
                        {group.rows.length === 1
                          ? 'layer'
                          : 'layers'}{' '}
                        · {formatNumber(groupArea)} sqft ·{' '}
                        {formatNumber(groupHours)} h
                      </span>
                    </span>

                    <span
                      className={`rounded-full px-2 py-1 text-[9px] font-bold ${
                        allPublished
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-blue-500/15 text-blue-400'
                      }`}
                    >
                      {allPublished
                        ? 'Published'
                        : group.rows[0]?.status || 'Active'}
                    </span>

                    <span className="text-xs text-slate-500">
                      {isExpanded ? '⌃' : '⌄'}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-800 px-3 py-2">
                      {group.rows.map((row) => {
                        const hourBased =
                          isHourBasedLayerName(row.layer_name);

                        const painters = Array.isArray(
                          row.assigned_painter_names,
                        )
                          ? row.assigned_painter_names.join(', ')
                          : String(
                              row.assigned_painter_names || '',
                            );

                        return (
                          <div
                            key={row.assignment_id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-slate-800 py-2.5 last:border-b-0"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-100">
                                {row.layer_name}
                              </p>
                              <p className="mt-1 truncate text-[10px] text-slate-500">
                                {hourBased
                                  ? 'Hour-based work'
                                  : `${row.surface_type || '-'} · ${
                                      painters ||
                                      row.machine_or_manual ||
                                      '-'
                                    }`}
                              </p>
                            </div>

                            <div className="text-right">
                              <p className="font-mono text-xs font-bold text-slate-100">
                                {hourBased
                                  ? `${formatNumber(
                                      row.expected_hours,
                                    )} h`
                                  : `${formatNumber(
                                      row.assigned_area,
                                    )} sqft`}
                              </p>
                              <p className="mt-1 font-mono text-[10px] text-slate-500">
                                {formatNumber(row.expected_hours)} h
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {groupedByFlat.length === 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 text-center text-sm text-slate-500">
                No published assignments found for{' '}
                {shortDate(selectedDate)}.
              </div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-slate-800 bg-slate-900 md:block">
            <table className="w-full table-fixed border-collapse text-xs">
              <colgroup>
                <col className="w-[11%]" />
                <col className="w-[13%]" />
                <col className="w-[12%]" />
                <col className="w-[18%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
              </colgroup>

              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-3">Date</th>
                  <th className="p-3">Application</th>
                  <th className="p-3">Flat</th>
                  <th className="p-3">Layer</th>
                  <th className="p-3">Surface</th>
                  <th className="p-3">Area</th>
                  <th className="p-3">Hours</th>
                  <th className="p-3">Mode</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>

              <tbody>
                {visibleAssignments.map((row) => {
                  const hourBased =
                    isHourBasedLayerName(row.layer_name);

                  return (
                    <tr
                      key={row.assignment_id}
                      className="border-t border-slate-800 text-slate-300"
                    >
                      <td className="break-words p-3">
                        {shortDate(row.assignment_date)}
                      </td>
                      <td className="break-words p-3">
                        {row.application || '-'}
                      </td>
                      <td className="break-words p-3 font-mono font-semibold text-cyan-400">
                        {row.flat || '-'}
                      </td>
                      <td className="break-words p-3 font-semibold text-slate-100">
                        {row.layer_name || '-'}
                      </td>
                      <td className="break-words p-3">
                        {hourBased
                          ? '-'
                          : row.surface_type || '-'}
                      </td>
                      <td className="break-words p-3 font-mono">
                        {hourBased
                          ? '-'
                          : formatNumber(row.assigned_area)}
                      </td>
                      <td className="break-words p-3 font-mono">
                        {formatNumber(row.expected_hours)} h
                      </td>
                      <td className="break-words p-3">
                        {hourBased
                          ? '-'
                          : row.machine_or_manual || '-'}
                      </td>
                      <td className="break-words p-3">
                        <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-400">
                          {row.status || 'Published'}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {visibleAssignments.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="p-8 text-center text-sm text-slate-500"
                    >
                      No published assignments found for{' '}
                      {shortDate(selectedDate)}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {attendanceOpen && attendance && (
        <PainterAttendanceModal
          attendance={attendance}
          onClose={() => setAttendanceOpen(false)}
        />
      )}
    </div>
  );
}

function FinalSummaryItem({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="px-2 py-3 text-center md:px-4 md:text-left">
      <p className="text-[9px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-base font-bold text-slate-100">{value}</p>
    </div>
  );
}

function PainterAttendanceModal({
  attendance,
  onClose,
}: {
  attendance: TodayPainterAttendance;
  onClose: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/70 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="today-painter-attendance-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h3
              id="today-painter-attendance-title"
              className="font-display text-lg font-bold text-slate-100 sm:text-xl"
            >
              Today&apos;s Painter Attendance
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              {attendance.site_name} · {shortDate(attendance.attendance_date)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {attendance.present_painter_count} attended today ·{' '}
              {attendance.currently_on_site_count} currently on site
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-lg text-slate-300 hover:bg-slate-800"
            aria-label="Close painter attendance details"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="border-b border-slate-800 px-4 py-3">Painter Name</th>
                <th className="border-b border-slate-800 px-4 py-3">Clock In</th>
                <th className="border-b border-slate-800 px-4 py-3">Clock Out</th>
              </tr>
            </thead>

            <tbody>
              {attendance.painters.map((painter) => (
                <tr
                  key={painter.person_id}
                  className="border-b border-slate-800/80 text-slate-300 last:border-b-0 hover:bg-slate-900"
                >
                  <td className="px-4 py-3 font-semibold text-slate-100">
                    {painter.painter_name || '-'}
                  </td>
                  <td className="px-4 py-3 font-mono text-cyan-300">
                    {painter.clock_in_time_display || '-'}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {painter.clock_out_time_display ? (
                      <span className="text-slate-300">
                        {painter.clock_out_time_display}
                      </span>
                    ) : painter.currently_on_site ? (
                      <span className="font-sans text-xs font-bold text-emerald-300">
                        Not clocked out
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}

              {attendance.painters.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    No Member-role painters have clocked in at this site today.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end border-t border-slate-800 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

type ReportingHoursMode = 'recommended' | 'manual';

type PreparedAssignedReportingRow = {
  row: TodayAssignedReportingRow;
  painterNames: string[];
  workingHours: number;
};

type GroupLaborConfig = {
  painterNames: string[];
  hoursMode: ReportingHoursMode;
  manualGroupHours: number;
};

function ReportingPage({
  token,
  projectId,
  username,
  assignedRows,
  onSubmitted,
  onError,
}: {
  token: string;
  projectId: string;
  username?: string | null;
  assignedRows: TodayAssignedReportingRow[];
  onSubmitted: (options?: { fullRefresh?: boolean }) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [tab, setTab] =
    useState<
      | 'assigned'
      | 'form'
      | 'reported'
      | 'assigned-history'
      | 'assigned-vs-reported'
    >('assigned');
  const [prefill, setPrefill] = useState<TodayAssignedReportingRow | null>(null);
  const [reportedDate, setReportedDate] = useState(todayDateInput());
  const [reportedRows, setReportedRows] = useState<ReportedBackendRow[]>([]);
  const [reportedLoading, setReportedLoading] = useState(false);
  const [assignedDate, setAssignedDate] = useState(todayDateInput());
  const [assignedHistoryRows, setAssignedHistoryRows] = useState<AssignedHistoryRow[]>([]);
  const [assignedHistoryLoading, setAssignedHistoryLoading] = useState(false);
  const [assignedWorkDate, setAssignedWorkDate] = useState(todayDateInput());
  const [assignedWorkDateReady, setAssignedWorkDateReady] = useState(false);
  const [assignedWorkRows, setAssignedWorkRows] = useState<TodayAssignedReportingRow[]>(assignedRows);
  const [assignedWorkLoading, setAssignedWorkLoading] = useState(false);
  const [comparisonDate, setComparisonDate] = useState(todayDateInput());
  const [comparisonAssignedRows, setComparisonAssignedRows] = useState<AssignedHistoryRow[]>([]);
  const [comparisonReportedRows, setComparisonReportedRows] = useState<ReportedBackendRow[]>([]);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [reportingPainters, setReportingPainters] = useState<AssignmentPainter[]>([]);
  // Keep Application+Layer labour choices at ReportingPage level so they
  // survive opening an individual row Edit form, switching Reporting tabs,
  // and changing Assigned Work filters. Painters are removed only when the
  // user explicitly clears/changes them.
  const [assignedGroupLabor, setAssignedGroupLabor] = useState<
    Record<string, GroupLaborConfig>
  >({});

  useEffect(() => {
    let cancelled = false;

    fetchAssignmentPainters(token, projectId)
      .then((rows) => {
        if (!cancelled) setReportingPainters(rows);
      })
      .catch((err) => {
        if (!cancelled) onError(errorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [onError, projectId, token]);

  useEffect(() => {
    let cancelled = false;

    setAssignedWorkDateReady(false);

    fetchDefaultReportingAssignmentDate(token, projectId)
      .then((result: { assignment_date: string | null }) => {
        if (cancelled) return;

        const defaultDate = toDateInput(result.assignment_date || '') || todayDateInput();
        setAssignedWorkDate(defaultDate);
      })
      .catch(() => {
        if (!cancelled) {
          setAssignedWorkDate(todayDateInput());
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAssignedWorkDateReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, token]);

  const loadAssignedWorkRows = useCallback(async () => {
    setAssignedWorkLoading(true);

    try {
      const rows = await fetchPendingAssignedRowsByDateLocal(
        token,
        projectId,
        assignedWorkDate,
      );
      setAssignedWorkRows(rows);
    } catch (err) {
      onError(errorMessage(err));
      setAssignedWorkRows([]);
    } finally {
      setAssignedWorkLoading(false);
    }
  }, [assignedWorkDate, projectId, token, onError]);

  const loadReportedRows = useCallback(async () => {
    setReportedLoading(true);

    try {
      const rows = await fetchReportedBackendRowsLocal(token, projectId, reportedDate);
      setReportedRows(rows);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setReportedLoading(false);
    }
  }, [projectId, reportedDate, token, onError]);

  const loadAssignedHistoryRows = useCallback(async () => {
    setAssignedHistoryLoading(true);

    try {
      const rows = await fetchAssignedHistoryRowsLocal(token, projectId, assignedDate);
      setAssignedHistoryRows(rows);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setAssignedHistoryLoading(false);
    }
  }, [projectId, assignedDate, token, onError]);

  const loadAssignedVsReportedRows = useCallback(async () => {
    setComparisonLoading(true);

    try {
      const [assigned, reported] = await Promise.all([
        fetchAssignedHistoryRowsLocal(token, projectId, comparisonDate),
        fetchReportedBackendRowsLocal(token, projectId, comparisonDate),
      ]);

      setComparisonAssignedRows(assigned);
      setComparisonReportedRows(reported);
    } catch (err) {
      onError(errorMessage(err));
      setComparisonAssignedRows([]);
      setComparisonReportedRows([]);
    } finally {
      setComparisonLoading(false);
    }
  }, [comparisonDate, onError, projectId, token]);

  useEffect(() => {
    if (tab === 'assigned' && assignedWorkDateReady) {
      loadAssignedWorkRows();
    }
  }, [assignedWorkDateReady, tab, loadAssignedWorkRows]);

  useEffect(() => {
    if (tab === 'reported') {
      loadReportedRows();
    }
  }, [tab, loadReportedRows]);

  useEffect(() => {
    if (tab === 'assigned-history') {
      loadAssignedHistoryRows();
    }
  }, [tab, loadAssignedHistoryRows]);

  useEffect(() => {
    if (tab === 'assigned-vs-reported') {
      loadAssignedVsReportedRows();
    }
  }, [tab, loadAssignedVsReportedRows]);

  function openAssignedForm(row: TodayAssignedReportingRow) {
    setPrefill(row);
    setTab('form');
  }

  function openUnassignedForm() {
    setPrefill(null);
    setTab('form');
  }

  async function submitSelectedAssignedRows(
    entries: PreparedAssignedReportingRow[],
  ) {
    await bulkSubmitAssignedReporting(token, projectId, {
      items: entries.map(({ row, painterNames, workingHours }) => {
        const hourBased = isHourBasedLayerName(row.layer_name);

        return {
          assignmentId: row.assignment_id,
          block: row.block || undefined,
          application: row.application,
          flat: row.flat,
          layerId: row.layer_id,
          layerName: row.layer_name,
          wallNames: hourBased
            ? []
            : splitList(row.pending_wall_names || row.assigned_wall_names || ''),
          painterNames,
          machineOrManual: row.machine_or_manual || 'Both',
          workingHours: Math.max(0, Number(workingHours || 0)),
          pendingArea: hourBased
            ? 0
            : Math.max(0, Number(row.pending_area || 0)),
          workDate:
            toDateInput(row.assignment_date) || assignedWorkDate || todayDateInput(),
          materialName: row.material_name || null,
          materialUsedLKg: Math.max(0, Number(row.material_used_l_kg || 0)),
          remark: null,
        };
      }),
      changedBy: username || 'system',
    });

    const submittedAssignmentIds = new Set(
      entries.map(({ row }) => row.assignment_id),
    );

    setAssignedWorkRows((currentRows) =>
      currentRows.filter(
        (row) => !submittedAssignmentIds.has(row.assignment_id),
      ),
    );

    await onSubmitted({ fullRefresh: false });
  }

  return (
    <>
      <PageHeading
        title="Reporting"
        subtitle=""
      />

      <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible [&>button]:shrink-0">
        <button
          type="button"
          onClick={() => setTab('assigned')}
          className={tabButton(tab === 'assigned')}
        >
          Assigned Work
        </button>

        <button
          type="button"
          onClick={openUnassignedForm}
          className={tabButton(tab === 'form' && !prefill)}
        >
          Unassigned Work
        </button>

        <button
          type="button"
          onClick={() => setTab('reported')}
          className={tabButton(tab === 'reported')}
        >
          Reported Work
        </button>

        <button
          type="button"
          onClick={() => setTab('assigned-history')}
          className={tabButton(tab === 'assigned-history')}
        >
          Assigned History (By Date)
        </button>

        <button
          type="button"
          onClick={() => setTab('assigned-vs-reported')}
          className={tabButton(tab === 'assigned-vs-reported')}
        >
          Assigned VS Reported
        </button>
      </div>

      {tab === 'assigned' && (
        <AssignedReporting
          assignedDate={assignedWorkDate}
          setAssignedDate={setAssignedWorkDate}
          assignedRows={assignedWorkRows}
          painters={reportingPainters}
          groupLabor={assignedGroupLabor}
          setGroupLabor={setAssignedGroupLabor}
          loading={assignedWorkLoading}
          onRefresh={loadAssignedWorkRows}
          onReport={openAssignedForm}
          onBulkSubmit={submitSelectedAssignedRows}
          onError={onError}
        />
      )}

      {tab === 'form' && (
        <UnifiedReportingForm
          key={prefill?.assignment_id || 'unassigned'}
          token={token}
          projectId={projectId}
          username={username}
          prefill={prefill}
          painters={reportingPainters}
          mobileFullscreen
          onSubmitted={async () => {
            setPrefill(null);
            setTab('assigned');

            if (prefill?.assignment_id) {
              setAssignedWorkRows((currentRows) =>
                currentRows.filter(
                  (row) => row.assignment_id !== prefill.assignment_id,
                ),
              );
            } else {
              await loadAssignedWorkRows();
            }

            await onSubmitted({ fullRefresh: false });
          }}
          onCancelPrefill={() => {
            setPrefill(null);
            setTab('assigned');
          }}
          onError={onError}
        />
      )}

      {tab === 'reported' && (
        <ReportedWorkView
          token={token}
          projectId={projectId}
          username={username}
          painters={reportingPainters}
          reportedDate={reportedDate}
          setReportedDate={setReportedDate}
          rows={reportedRows}
          loading={reportedLoading}
          onRefresh={loadReportedRows}
          onUpdated={async () => {
            await loadReportedRows();
            await onSubmitted({ fullRefresh: false });
          }}
          onError={onError}
        />
      )}

      {tab === 'assigned-history' && (
        <AssignedHistoryView
          assignedDate={assignedDate}
          setAssignedDate={setAssignedDate}
          rows={assignedHistoryRows}
          loading={assignedHistoryLoading}
          onRefresh={loadAssignedHistoryRows}
        />
      )}

      {tab === 'assigned-vs-reported' && (
        <AssignedVsReportedView
          comparisonDate={comparisonDate}
          setComparisonDate={setComparisonDate}
          assignedRows={comparisonAssignedRows}
          reportedRows={comparisonReportedRows}
          loading={comparisonLoading}
          onRefresh={loadAssignedVsReportedRows}
        />
      )}
    </>
  );
}

function AssignedReporting({
  assignedDate,
  setAssignedDate,
  assignedRows,
  painters,
  groupLabor,
  setGroupLabor,
  loading,
  onRefresh,
  onReport,
  onBulkSubmit,
  onError,
}: {
  assignedDate: string;
  setAssignedDate: (value: string) => void;
  assignedRows: TodayAssignedReportingRow[];
  painters: AssignmentPainter[];
  groupLabor: Record<string, GroupLaborConfig>;
  setGroupLabor: (
    value:
      | Record<string, GroupLaborConfig>
      | ((
          current: Record<string, GroupLaborConfig>,
        ) => Record<string, GroupLaborConfig>),
  ) => void;
  loading: boolean;
  onRefresh: () => void;
  onReport: (row: TodayAssignedReportingRow) => void;
  onBulkSubmit: (rows: PreparedAssignedReportingRow[]) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [applicationFilter, setApplicationFilter] = useState('All');
  const [layerFilter, setLayerFilter] = useState('All');
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const painterOptions = useMemo(
    () =>
      painters
        .map(painterDisplay)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [painters],
  );

  const applications = useMemo(
    () =>
      Array.from(
        new Set(
          assignedRows
            .map((row) => String(row.application || '').trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [assignedRows],
  );

  const layers = useMemo(() => {
    const rowsForLayerFilter =
      applicationFilter === 'All'
        ? assignedRows
        : assignedRows.filter(
            (row) => norm(row.application) === norm(applicationFilter),
          );

    return Array.from(
      new Set(
        rowsForLayerFilter
          .map((row) => String(row.layer_name || '').trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [applicationFilter, assignedRows]);

  const visibleAssignedRows = useMemo(
    () =>
      assignedRows.filter((row) => {
        const applicationMatches =
          applicationFilter === 'All' ||
          norm(row.application) === norm(applicationFilter);

        const layerMatches =
          layerFilter === 'All' || norm(row.layer_name) === norm(layerFilter);

        return applicationMatches && layerMatches;
      }),
    [applicationFilter, assignedRows, layerFilter],
  );

  const assignedGroups = useMemo(() => {
    const grouped = new Map<
      string,
      {
        key: string;
        application: string;
        layerName: string;
        rows: TodayAssignedReportingRow[];
      }
    >();

    visibleAssignedRows.forEach((row) => {
      const application = String(row.application || '').trim() || '-';
      const layerName = String(row.layer_name || '').trim() || '-';
      const key = `${norm(application)}|${norm(layerName)}`;

      const current = grouped.get(key);

      if (current) {
        current.rows.push(row);
      } else {
        grouped.set(key, {
          key,
          application,
          layerName,
          rows: [row],
        });
      }
    });

    return Array.from(grouped.values()).sort((a, b) => {
      const applicationCompare = a.application.localeCompare(
        b.application,
        undefined,
        { numeric: true },
      );

      if (applicationCompare !== 0) return applicationCompare;

      return a.layerName.localeCompare(b.layerName, undefined, {
        numeric: true,
      });
    });
  }, [visibleAssignedRows]);

  const allRowsByGroup = useMemo(() => {
    const grouped = new Map<string, TodayAssignedReportingRow[]>();

    assignedRows.forEach((row) => {
      const key = `${norm(row.application)}|${norm(row.layer_name)}`;
      const rows = grouped.get(key) || [];
      rows.push(row);
      grouped.set(key, rows);
    });

    return grouped;
  }, [assignedRows]);

  function groupLaborConfig(groupKey: string) {
    return (
      groupLabor[groupKey] || {
        painterNames: [],
        hoursMode: 'recommended' as ReportingHoursMode,
        manualGroupHours: 0,
      }
    );
  }

  function groupRequiredPainterHours(rows: TodayAssignedReportingRow[]) {
    return rows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.hours_for_one_painter || 0)),
      0,
    );
  }

  function recommendedGroupHours(
    rows: TodayAssignedReportingRow[],
    painterNames: string[],
  ) {
    const requiredPainterHours = groupRequiredPainterHours(rows);
    const painterCount = Math.max(painterNames.length, 1);

    return roundToTwo(requiredPainterHours / painterCount);
  }

  function effectiveGroupClockHours(
    rows: TodayAssignedReportingRow[],
    config: GroupLaborConfig,
  ) {
    return config.hoursMode === 'manual'
      ? Math.max(0, Number(config.manualGroupHours || 0))
      : recommendedGroupHours(rows, config.painterNames);
  }

  function effectiveRowWorkingHours(
    row: TodayAssignedReportingRow,
    groupRows: TodayAssignedReportingRow[],
    config: GroupLaborConfig,
  ) {
    const totalPainterHours = groupRequiredPainterHours(groupRows);
    const rowPainterHours = Math.max(
      0,
      Number(row.hours_for_one_painter || 0),
    );

    if (totalPainterHours <= 0) return 0;

    return roundToTwo(
      effectiveGroupClockHours(groupRows, config) *
        (rowPainterHours / totalPainterHours),
    );
  }

  function updateGroupPainters(groupKey: string, painterNames: string[]) {
    setGroupLabor((current) => ({
      ...current,
      [groupKey]: {
        ...(current[groupKey] || {
          painterNames: [],
          hoursMode: 'recommended' as ReportingHoursMode,
          manualGroupHours: 0,
        }),
        painterNames,
      },
    }));
  }

  function updateGroupHoursMode(
    groupKey: string,
    rows: TodayAssignedReportingRow[],
    hoursMode: ReportingHoursMode,
  ) {
    setGroupLabor((current) => {
      const currentConfig =
        current[groupKey] ||
        ({
          painterNames: [],
          hoursMode: 'recommended',
          manualGroupHours: 0,
        } satisfies GroupLaborConfig);

      return {
        ...current,
        [groupKey]: {
          ...currentConfig,
          hoursMode,
          manualGroupHours:
            hoursMode === 'manual' && currentConfig.manualGroupHours <= 0
              ? recommendedGroupHours(rows, currentConfig.painterNames)
              : currentConfig.manualGroupHours,
        },
      };
    });
  }

  function updateGroupManualHours(groupKey: string, hours: number) {
    setGroupLabor((current) => ({
      ...current,
      [groupKey]: {
        ...(current[groupKey] || {
          painterNames: [],
          hoursMode: 'manual' as ReportingHoursMode,
          manualGroupHours: 0,
        }),
        hoursMode: 'manual',
        manualGroupHours: Math.max(0, Number(hours || 0)),
      },
    }));
  }

  function rowWithGroupLabor(
    row: TodayAssignedReportingRow,
  ): TodayAssignedReportingRow {
    const groupKey = `${norm(row.application)}|${norm(row.layer_name)}`;
    const groupRows = allRowsByGroup.get(groupKey) || [row];
    const config = groupLaborConfig(groupKey);

    return {
      ...row,
      reporting_painter_names: config.painterNames,
      reporting_working_hours: effectiveRowWorkingHours(
        row,
        groupRows,
        config,
      ),
      reporting_hours_mode: config.hoursMode,
    };
  }

  useEffect(() => {
    const activeIds = new Set(assignedRows.map((row) => row.assignment_id));

    setSelectedAssignmentIds((current) => {
      const next = new Set(
        Array.from(current).filter((assignmentId) => activeIds.has(assignmentId)),
      );

      if (
        next.size === current.size &&
        Array.from(next).every((assignmentId) => current.has(assignmentId))
      ) {
        return current;
      }

      return next;
    });
  }, [assignedRows]);

  const selectedRows = useMemo(
    () =>
      assignedRows.filter((row) =>
        selectedAssignmentIds.has(row.assignment_id),
      ),
    [assignedRows, selectedAssignmentIds],
  );

  const visibleSelectedCount = useMemo(
    () =>
      visibleAssignedRows.reduce(
        (count, row) =>
          count + (selectedAssignmentIds.has(row.assignment_id) ? 1 : 0),
        0,
      ),
    [selectedAssignmentIds, visibleAssignedRows],
  );

  const allVisibleSelected =
    visibleAssignedRows.length > 0 &&
    visibleSelectedCount === visibleAssignedRows.length;

  function handleDateChange(value: string) {
    setAssignedDate(value);
    setApplicationFilter('All');
    setLayerFilter('All');
    setSelectedAssignmentIds(new Set());
  }

  function clearAssignedFilters() {
    setApplicationFilter('All');
    setLayerFilter('All');
  }

  function toggleRow(row: TodayAssignedReportingRow) {
    setSelectedAssignmentIds((current) => {
      const next = new Set(current);

      if (next.has(row.assignment_id)) {
        next.delete(row.assignment_id);
      } else {
        next.add(row.assignment_id);
      }

      return next;
    });
  }

  function toggleGroup(rows: TodayAssignedReportingRow[]) {
    setSelectedAssignmentIds((current) => {
      const next = new Set(current);
      const allSelected =
        rows.length > 0 &&
        rows.every((row) => next.has(row.assignment_id));

      rows.forEach((row) => {
        if (allSelected) {
          next.delete(row.assignment_id);
        } else {
          next.add(row.assignment_id);
        }
      });

      return next;
    });
  }

  function toggleGroupExpanded(groupKey: string) {
    setExpandedGroupKeys((current) => {
      const next = new Set(current);

      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }

      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedAssignmentIds((current) => {
      const next = new Set(current);

      if (allVisibleSelected) {
        visibleAssignedRows.forEach((row) => next.delete(row.assignment_id));
      } else {
        visibleAssignedRows.forEach((row) => next.add(row.assignment_id));
      }

      return next;
    });
  }

  async function submitSelected() {
    if (selectedRows.length === 0 || bulkSubmitting) return;

    const preparedRows: PreparedAssignedReportingRow[] = [];

    for (const row of selectedRows) {
      const groupKey = `${norm(row.application)}|${norm(row.layer_name)}`;
      const groupRows = allRowsByGroup.get(groupKey) || [row];
      const config = groupLaborConfig(groupKey);

      if (config.painterNames.length === 0) {
        onError(
          `Select painter(s) for ${row.application} - ${row.layer_name} before bulk reporting.`,
        );
        return;
      }

      const workingHours = effectiveRowWorkingHours(row, groupRows, config);

      if (workingHours <= 0) {
        onError(
          `Working hours are missing for ${row.application} - ${row.layer_name}.`,
        );
        return;
      }

      preparedRows.push({
        row,
        painterNames: config.painterNames,
        workingHours,
      });
    }

    setBulkSubmitting(true);

    try {
      await onBulkSubmit(preparedRows);
      setSelectedAssignmentIds(new Set());
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBulkSubmitting(false);
    }
  }

  const hasAssignedFilters =
    applicationFilter !== 'All' || layerFilter !== 'All';

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 sm:rounded-2xl sm:p-4">
        {/* Phone: date/fetch stay compact; application/layer filters sit below. */}
        <div className="sm:hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <ResponsiveDatePicker
              label="Assignment Date"
              value={assignedDate}
              onChange={handleDateChange}
              size="sm"
            />

            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || bulkSubmitting}
              className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs font-bold hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? '...' : 'Fetch'}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <select
              value={applicationFilter}
              onChange={(event) => {
                setApplicationFilter(event.target.value);
                setLayerFilter('All');
              }}
              className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 outline-none focus:border-amber-400"
            >
              <option value="All">All applications</option>
              {applications.map((application) => (
                <option key={application} value={application}>
                  {application}
                </option>
              ))}
            </select>

            <select
              value={layerFilter}
              onChange={(event) => setLayerFilter(event.target.value)}
              className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 outline-none focus:border-amber-400"
            >
              <option value="All">All layers</option>
              {layers.map((layer) => (
                <option key={layer} value={layer}>
                  {layer}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-slate-500">
            <span>Pending work for the selected date</span>
            <span className="shrink-0 font-mono font-bold text-slate-300">
              {visibleAssignedRows.length} / {assignedRows.length} rows
            </span>
          </div>
        </div>

        {/* Tablet/Desktop: date, fetch and assigned-work filters in one line. */}
        <div className="hidden flex-wrap items-end gap-3 sm:flex">
          <ResponsiveDatePicker
            label="Assignment Date"
            value={assignedDate}
            onChange={handleDateChange}
          />

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || bulkSubmitting}
            className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-4 text-sm font-bold hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Loading...' : 'Fetch Pending Assigned Rows'}
          </button>

          <select
            value={applicationFilter}
            onChange={(event) => {
                setApplicationFilter(event.target.value);
                setLayerFilter('All');
              }}
            className="h-10 min-w-[180px] rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-amber-400"
          >
            <option value="All">All applications</option>
            {applications.map((application) => (
              <option key={application} value={application}>
                {application}
              </option>
            ))}
          </select>

          <select
            value={layerFilter}
            onChange={(event) => setLayerFilter(event.target.value)}
            className="h-10 min-w-[180px] rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-amber-400"
          >
            <option value="All">All layers</option>
            {layers.map((layer) => (
              <option key={layer} value={layer}>
                {layer}
              </option>
            ))}
          </select>

          {hasAssignedFilters && (
            <button
              type="button"
              onClick={clearAssignedFilters}
              className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs font-bold text-slate-300 hover:bg-slate-800"
            >
              Clear Filters
            </button>
          )}

          <p className="ml-auto pb-2 text-xs text-slate-500">
            {visibleAssignedRows.length} shown of {assignedRows.length} pending{' '}
            {assignedRows.length === 1 ? 'row' : 'rows'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 sm:rounded-2xl sm:px-4">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-200">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleAllVisible}
            disabled={visibleAssignedRows.length === 0 || bulkSubmitting}
            className="h-4 w-4 rounded border-slate-600 bg-slate-950"
          />
          Select all filtered ({visibleAssignedRows.length})
        </label>

        <span className="text-xs text-slate-500">
          {selectedRows.length} selected
          {visibleSelectedCount !== selectedRows.length
            ? ` · ${visibleSelectedCount} visible`
            : ''}
        </span>

        <button
          type="button"
          onClick={submitSelected}
          disabled={selectedRows.length === 0 || bulkSubmitting || loading}
          className="ml-auto h-10 rounded-lg bg-emerald-500 px-4 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
        >
          {bulkSubmitting
            ? `Submitting ${selectedRows.length}...`
            : `Submit ${selectedRows.length} ${
                selectedRows.length === 1 ? 'Entry' : 'Entries'
              }`}
        </button>
      </div>

      {/* Phone: Application + Layer groups, with existing rows underneath. */}
      <div className="space-y-2 sm:hidden">
        {assignedGroups.map((group) => {
          const expanded = expandedGroupKeys.has(group.key);
          const selectedCount = group.rows.reduce(
            (count, row) =>
              count + (selectedAssignmentIds.has(row.assignment_id) ? 1 : 0),
            0,
          );
          const allGroupSelected =
            group.rows.length > 0 && selectedCount === group.rows.length;
          const totalPendingArea = group.rows.reduce(
            (sum, row) =>
              sum +
              (isHourBasedLayerName(row.layer_name)
                ? 0
                : Number(row.pending_area || 0)),
            0,
          );
          const laborConfig = groupLaborConfig(group.key);
          const totalRequiredPainterHours = groupRequiredPainterHours(
            group.rows,
          );
          const recommendedHours = recommendedGroupHours(
            group.rows,
            laborConfig.painterNames,
          );
          const displayedGroupHours = effectiveGroupClockHours(
            group.rows,
            laborConfig,
          );

          return (
            <div
              key={group.key}
              className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900"
            >
              <div className="flex items-center gap-3 bg-gradient-to-r from-cyan-500/10 via-slate-900 to-slate-900 px-3 py-3 hover:from-cyan-500/15 hover:via-slate-800">
                <input
                  type="checkbox"
                  checked={allGroupSelected}
                  onChange={() => toggleGroup(group.rows)}
                  disabled={bulkSubmitting}
                  aria-label={`Select all ${group.application} ${group.layerName}`}
                  className="h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-950"
                />

                <button
                  type="button"
                  onClick={() => toggleGroupExpanded(group.key)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  aria-expanded={expanded}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-bold text-cyan-200">
                        {group.application}
                      </span>
                      <span className="text-[10px] font-bold text-cyan-300">
                        {group.rows.length}{' '}
                        {group.rows.length === 1 ? 'row' : 'rows'}
                      </span>
                    </div>

                    <p className="mt-1 text-xs font-bold text-slate-100">
                      {group.layerName}
                    </p>

                    <p className="mt-1 text-[10px] text-slate-500">
                      {selectedCount} selected
                      {totalPendingArea > 0
                        ? ` · ${formatNumber(totalPendingArea)} sqft pending`
                        : ''}
                    </p>
                  </div>

                  <span className="shrink-0 text-xs font-bold text-cyan-300">
                    {expanded ? 'Hide' : 'Show'}
                  </span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 border-t border-cyan-500/15 bg-slate-900/80 px-3 py-2.5">
                <CompactPainterDropdown
                  items={painterOptions}
                  selected={laborConfig.painterNames}
                  onChange={(names) => updateGroupPainters(group.key, names)}
                  disabled={bulkSubmitting}
                />

                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                  <select
                    value={laborConfig.hoursMode}
                    onChange={(event) =>
                      updateGroupHoursMode(
                        group.key,
                        group.rows,
                        event.target.value as ReportingHoursMode,
                      )
                    }
                    disabled={bulkSubmitting}
                    className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-[10px] font-semibold text-slate-200 outline-none focus:border-amber-400"
                  >
                    <option value="recommended">Recommended hours</option>
                    <option value="manual">Manual hours</option>
                  </select>

                  {laborConfig.hoursMode === 'manual' ? (
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={laborConfig.manualGroupHours}
                      onChange={(event) =>
                        updateGroupManualHours(
                          group.key,
                          Number(event.target.value) || 0,
                        )
                      }
                      disabled={bulkSubmitting}
                      className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-amber-300 outline-none focus:border-amber-400"
                    />
                  ) : (
                    <div className="flex h-9 items-center rounded-lg border border-slate-800 bg-slate-950 px-2 font-mono text-xs font-bold text-amber-300">
                      {formatNumber(recommendedHours)} h
                    </div>
                  )}
                </div>

                <p className="text-[9px] text-slate-500">
                  {formatNumber(totalRequiredPainterHours)} painter-h ÷{' '}
                  {Math.max(laborConfig.painterNames.length, 1)} painter
                  {Math.max(laborConfig.painterNames.length, 1) === 1 ? '' : 's'}{' '}
                  = {formatNumber(displayedGroupHours)} h
                </p>
              </div>

              {expanded && (
                <div className="space-y-2 border-t-2 border-cyan-500/20 bg-slate-950/80 p-2.5 shadow-[inset_0_8px_18px_rgba(0,0,0,0.18)]">
                  {group.rows.map((row) => (
                    <AssignedWorkMobileCard
                      key={`${row.assignment_id}-${row.layer_id}-${row.surface_type || ''}-${row.pending_wall_names || row.assigned_wall_names || ''}`}
                      row={rowWithGroupLabor(row)}
                      selected={selectedAssignmentIds.has(row.assignment_id)}
                      disabled={bulkSubmitting}
                      onToggle={() => toggleRow(row)}
                      onReport={(rowToEdit) =>
                        onReport(rowWithGroupLabor(rowToEdit))
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {!loading && visibleAssignedRows.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 text-center">
            <p className="text-sm font-semibold text-slate-300">
              No pending assigned work
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {assignedRows.length > 0
                ? 'Clear filters or choose another application/layer.'
                : 'Select another assignment date or refresh this view.'}
            </p>
          </div>
        )}

        {loading && visibleAssignedRows.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 text-center text-sm text-slate-500">
            Loading pending assigned work...
          </div>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 sm:block">
        <table className="w-full min-w-[1600px] border-collapse text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="p-3">Select</th>
              <th className="p-3">Application</th>
              <th className="p-3">Flat</th>
              <th className="p-3">Layer</th>
              <th className="p-3">Pending Walls</th>
              <th className="p-3">Assigned Area</th>
              <th className="p-3">Pending Area</th>
              <th className="p-3">Material</th>
              <th className="p-3">Material Qty</th>
              <th className="p-3">Painters</th>
              <th className="p-3">Working Hours</th>
              <th className="p-3">Mode</th>
              <th className="p-3">Action</th>
            </tr>
          </thead>

          <tbody>
            {assignedGroups.map((group) => {
              const expanded = expandedGroupKeys.has(group.key);
              const groupHourBased = isHourBasedLayerName(group.layerName);
              const selectedCount = group.rows.reduce(
                (count, row) =>
                  count +
                  (selectedAssignmentIds.has(row.assignment_id) ? 1 : 0),
                0,
              );
              const allGroupSelected =
                group.rows.length > 0 && selectedCount === group.rows.length;

              const totalAssignedArea = group.rows.reduce(
                (sum, row) => sum + Number(row.assigned_area || 0),
                0,
              );
              const totalPendingArea = group.rows.reduce(
                (sum, row) => sum + Number(row.pending_area || 0),
                0,
              );
              const totalMaterialQty = group.rows.reduce(
                (sum, row) => sum + Number(row.material_used_l_kg || 0),
                0,
              );
              const totalRequiredPainterHours = groupRequiredPainterHours(
                group.rows,
              );
              const laborConfig = groupLaborConfig(group.key);
              const recommendedHours = recommendedGroupHours(
                group.rows,
                laborConfig.painterNames,
              );
              const displayedGroupHours = effectiveGroupClockHours(
                group.rows,
                laborConfig,
              );

              const materialNames = Array.from(
                new Set(
                  group.rows
                    .map((row) => String(row.material_name || '').trim())
                    .filter(Boolean),
                ),
              );
              const modes = Array.from(
                new Set(
                  group.rows
                    .map((row) => String(row.machine_or_manual || '').trim())
                    .filter(Boolean),
                ),
              );

              const materialLabel =
                materialNames.length === 0
                  ? '-'
                  : materialNames.length === 1
                    ? materialNames[0]
                    : 'Mixed';
              const modeLabel =
                groupHourBased || modes.length === 0
                  ? '-'
                  : modes.length === 1
                    ? modes[0]
                    : 'Mixed';

              return (
                <Fragment key={group.key}>
                  <tr
                    onClick={() => toggleGroupExpanded(group.key)}
                    className="cursor-pointer border-t border-slate-700 bg-slate-800/60 shadow-[inset_3px_0_0_rgba(34,211,238,0.20)] transition hover:bg-slate-800/80"
                    aria-expanded={expanded}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={allGroupSelected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggleGroup(group.rows)}
                        disabled={bulkSubmitting}
                        aria-label={`Select all ${group.application} ${group.layerName}`}
                        className="h-4 w-4 rounded border-slate-600 bg-slate-950"
                      />
                    </td>

                    <td className="p-3 font-bold text-slate-100">
                      {group.application}
                    </td>

                    <td className="p-3">
                      <span className="rounded-md bg-cyan-500/10 px-2 py-1 text-xs font-bold text-cyan-300">
                        {group.rows.length}{' '}
                        {group.rows.length === 1 ? 'row' : 'rows'}
                      </span>
                    </td>

                    <td className="p-3 font-bold text-slate-100">
                      {group.layerName}
                    </td>

                    <td className="p-3 text-xs text-slate-400">
                      {selectedCount} selected ·{' '}
                      {expanded ? 'click to collapse' : 'click to expand'}
                    </td>

                    <td className="p-3 font-mono font-bold">
                      {groupHourBased
                        ? '-'
                        : formatNumber(totalAssignedArea)}
                    </td>

                    <td className="p-3 font-mono font-bold">
                      {groupHourBased
                        ? '-'
                        : formatNumber(totalPendingArea)}
                    </td>

                    <td className="p-3 text-slate-300">{materialLabel}</td>

                    <td className="p-3 font-mono text-slate-300">
                      {groupHourBased
                        ? '-'
                        : formatNumber(totalMaterialQty)}
                    </td>

                    <td
                      className="p-3 align-top"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <CompactPainterDropdown
                        items={painterOptions}
                        selected={laborConfig.painterNames}
                        onChange={(names) =>
                          updateGroupPainters(group.key, names)
                        }
                        disabled={bulkSubmitting}
                      />
                    </td>

                    <td
                      className="p-3 align-top"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="min-w-[150px] space-y-1.5">
                        <select
                          value={laborConfig.hoursMode}
                          onChange={(event) =>
                            updateGroupHoursMode(
                              group.key,
                              group.rows,
                              event.target.value as ReportingHoursMode,
                            )
                          }
                          disabled={bulkSubmitting}
                          className="h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-[11px] font-semibold text-slate-200 outline-none focus:border-amber-400"
                        >
                          <option value="recommended">Recommended</option>
                          <option value="manual">Manual</option>
                        </select>

                        {laborConfig.hoursMode === 'manual' ? (
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={laborConfig.manualGroupHours}
                            onChange={(event) =>
                              updateGroupManualHours(
                                group.key,
                                Number(event.target.value) || 0,
                              )
                            }
                            disabled={bulkSubmitting}
                            className="h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-amber-300 outline-none focus:border-amber-400"
                          />
                        ) : (
                          <div className="font-mono text-sm font-bold text-amber-300">
                            {formatNumber(recommendedHours)} h
                          </div>
                        )}

                        <p className="text-[9px] leading-3 text-slate-500">
                          {formatNumber(totalRequiredPainterHours)} painter-h ÷{' '}
                          {Math.max(laborConfig.painterNames.length, 1)} painter
                          {Math.max(laborConfig.painterNames.length, 1) === 1
                            ? ''
                            : 's'}{' '}
                          = {formatNumber(displayedGroupHours)} h
                        </p>
                      </div>
                    </td>

                    <td className="p-3">{modeLabel}</td>

                    <td className="p-3">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleGroupExpanded(group.key);
                        }}
                        className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20"
                      >
                        {expanded ? 'Hide rows' : 'Show rows'}
                      </button>
                    </td>
                  </tr>

                  {expanded &&
                    group.rows.map((row) => {
                      const hourBased = isHourBasedLayerName(row.layer_name);
                      const selected = selectedAssignmentIds.has(
                        row.assignment_id,
                      );
                      const effectivePainters = laborConfig.painterNames;
                      const effectiveWorkingHours = effectiveRowWorkingHours(
                        row,
                        group.rows,
                        laborConfig,
                      );

                      return (
                        <tr
                          key={`${row.assignment_id}-${row.layer_id}-${row.surface_type || ''}-${row.pending_wall_names || row.assigned_wall_names || ''}`}
                          className={`border-t border-slate-800/80 ${
                            selected
                              ? 'bg-emerald-500/5'
                              : 'bg-slate-950/35'
                          }`}
                        >
                          <td className="border-l-2 border-cyan-400/10 p-3 pl-6">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleRow(row)}
                              disabled={bulkSubmitting}
                              aria-label={`Select ${row.flat} ${row.layer_name}`}
                              className="h-4 w-4 rounded border-slate-600 bg-slate-950"
                            />
                          </td>
                          <td className="p-3 text-slate-500">
                            {row.application}
                          </td>
                          <td className="p-3 font-mono text-cyan-400">
                            {row.flat}
                          </td>
                          <td className="p-3 text-slate-300">
                            {row.layer_name}
                          </td>
                          <td className="p-3 text-slate-400">
                            {hourBased
                              ? '-'
                              : row.pending_wall_names ||
                                row.assigned_wall_names ||
                                '-'}
                          </td>
                          <td className="p-3 font-mono">
                            {hourBased
                              ? '-'
                              : formatNumber(row.assigned_area)}
                          </td>
                          <td className="p-3 font-mono">
                            {hourBased
                              ? '-'
                              : formatNumber(row.pending_area)}
                          </td>
                          <td className="p-3 text-slate-300">
                            {row.material_name || '-'}
                          </td>
                          <td className="p-3 font-mono text-slate-300">
                            {hourBased
                              ? '-'
                              : formatNumber(row.material_used_l_kg || 0)}
                          </td>
                          <td className="p-3 text-xs text-slate-300">
                            {effectivePainters.length > 0
                              ? effectivePainters.join(', ')
                              : '-'}
                          </td>
                          <td className="p-3 font-mono text-amber-300">
                            {formatNumber(effectiveWorkingHours)} h
                          </td>
                          <td className="p-3">
                            {hourBased
                              ? '-'
                              : row.machine_or_manual || '-'}
                          </td>
                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => onReport(rowWithGroupLabor(row))}
                              disabled={bulkSubmitting}
                              className="rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-60"
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}

            {visibleAssignedRows.length === 0 && (
              <tr>
                <td colSpan={13} className="p-6 text-sm text-slate-500">
                  {assignedRows.length > 0
                    ? 'No pending assigned work found for selected application/layer.'
                    : 'No pending assigned work found for selected date.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AssignedWorkMobileCard({
  row,
  selected,
  disabled,
  onToggle,
  onReport,
}: {
  row: TodayAssignedReportingRow;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onReport: (row: TodayAssignedReportingRow) => void;
}) {
  const [wallsExpanded, setWallsExpanded] = useState(false);
  const hourBased = isHourBasedLayerName(row.layer_name);
  const walls = hourBased
    ? 'Hour-based work'
    : String(row.pending_wall_names || row.assigned_wall_names || 'Walls not mapped');
  const wallsNeedExpansion = walls.length > 95;
  const visibleWalls =
    wallsNeedExpansion && !wallsExpanded ? `${walls.slice(0, 92)}…` : walls;

  return (
    <article
      className={`overflow-hidden rounded-xl border bg-slate-950/85 shadow-[inset_3px_0_0_rgba(100,116,139,0.22)] ${
        selected
          ? 'border-emerald-500/60'
          : 'border-slate-700/80'
      }`}
    >
      <div className="p-3">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            disabled={disabled}
            aria-label={`Select ${row.flat} ${row.layer_name}`}
            className="mt-1 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-950"
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">
                    {row.application || '-'}
                  </span>
                  <strong className="font-mono text-sm text-cyan-300">
                    {row.flat || '-'}
                  </strong>
                </div>

                <p className="mt-1.5 text-xs font-semibold text-slate-100">
                  {row.layer_name || '-'}
                </p>
                {(row.reporting_painter_names?.length ||
                  row.assigned_painter_names?.length) && (
                  <p className="mt-1 text-[9px] leading-3 text-slate-500">
                    {(row.reporting_painter_names?.length
                      ? row.reporting_painter_names
                      : row.assigned_painter_names
                    )?.join(', ')}
                  </p>
                )}
              </div>

              <span className="shrink-0 font-mono text-sm font-bold text-amber-300">
                {formatNumber(
                  row.reporting_working_hours ?? row.hours_for_one_painter,
                )}{' '}
                h
              </span>
            </div>

            <div className="mt-2 rounded-lg border border-slate-800/70 bg-slate-900/55 px-2.5 py-2">
              <p className="break-words text-[10px] leading-4 text-slate-400">
                {!hourBased && row.surface_type ? (
                  <span className="font-semibold text-slate-300">
                    {row.surface_type} ·{' '}
                  </span>
                ) : null}
                {visibleWalls}
              </p>

              {wallsNeedExpansion && (
                <button
                  type="button"
                  onClick={() => setWallsExpanded((current) => !current)}
                  className="mt-1 text-[10px] font-bold text-cyan-300"
                >
                  {wallsExpanded ? 'Show less' : 'Show all walls'}
                </button>
              )}
            </div>

            <div className="mt-2 rounded-lg border border-slate-800/80 bg-slate-900/40 px-2.5 py-2">
              <p className="text-[8px] font-bold uppercase tracking-wide text-slate-600">
                Material
              </p>
              <p className="mt-0.5 break-words text-[10px] font-semibold text-slate-200">
                {row.material_name || '-'}
                {!hourBased && row.material_name
                  ? ` · ${formatNumber(row.material_used_l_kg || 0)} L/KG`
                  : ''}
              </p>
            </div>

            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-t border-slate-800 pt-3">
              <div className="grid grid-cols-3 gap-2">
                <AssignedWorkMetric
                  label="Assigned"
                  value={hourBased ? '-' : formatNumber(row.assigned_area)}
                />
                <AssignedWorkMetric
                  label="Pending"
                  value={hourBased ? '-' : formatNumber(row.pending_area)}
                />
                <AssignedWorkMetric
                  label="Mode"
                  value={hourBased ? '-' : row.machine_or_manual || '-'}
                />
              </div>

              <button
                type="button"
                onClick={() => onReport(row)}
                disabled={disabled}
                className="h-9 shrink-0 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-3 text-[10px] font-bold text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-60"
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function AssignedWorkMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[8px] font-bold uppercase tracking-wide text-slate-600">
        {label}
      </p>
      <p className="mt-0.5 truncate font-mono text-[10px] font-semibold text-slate-200">
        {value}
      </p>
    </div>
  );
}

function UnifiedReportingForm({
  token,
  projectId,
  username,
  prefill,
  painters,
  mobileFullscreen = false,
  onSubmitted,
  onCancelPrefill,
  onError,
}: {
  token: string;
  projectId: string;
  username?: string | null;
  prefill: TodayAssignedReportingRow | null;
  painters: AssignmentPainter[];
  mobileFullscreen?: boolean;
  onSubmitted: () => void | Promise<void>;
  onCancelPrefill: () => void;
  onError: (message: string) => void;
}) {
  const [blocks, setBlocks] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [flats, setFlats] = useState<any[]>([]);
  const [layers, setLayers] = useState<any[]>([]);
  const [walls, setWalls] = useState<AssignmentWallOption[]>([]);
  const [productivityOptions, setProductivityOptions] = useState<
    AssignmentProductivityOption[]
  >([]);

  const [block, setBlock] = useState('');
  const [application, setApplication] = useState('');
  const [flat, setFlat] = useState('');
  const [layerId, setLayerId] = useState('');
  const [selectedWalls, setSelectedWalls] = useState<string[]>([]);
  const [selectedPainters, setSelectedPainters] = useState<string[]>([]);
  const [mode, setMode] = useState<WorkMode>('Both');
  const [workDate, setWorkDate] = useState(todayDateInput());
  const [workingHours, setWorkingHours] = useState(8);
  const [hoursEntryMode, setHoursEntryMode] =
    useState<ReportingHoursMode>('recommended');
  const [materialName, setMaterialName] = useState('');
  const [materialUsed, setMaterialUsed] = useState(0);
  const [materialSuggestion, setMaterialSuggestion] = useState<AssignmentMaterialSuggestion | null>(null);
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isAssignedReporting = Boolean(prefill?.assignment_id);
  const painterOptions = useMemo(
    () =>
      painters
        .map(painterDisplay)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [painters],
  );

  useEffect(() => {
    if (!mobileFullscreen || typeof window === 'undefined') {
      return;
    }

    const mobileQuery = window.matchMedia('(max-width: 767px)');

    if (!mobileQuery.matches) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileFullscreen]);

  useEffect(() => {
    fetchAssignmentBlocks(token, projectId)
      .then(setBlocks)
      .catch((err) => onError(errorMessage(err)));
  }, [onError, projectId, token]);

  useEffect(() => {
    if (!block) {
      setApplications([]);
      return;
    }

    fetchAssignmentApplications(token, projectId, block)
      .then(setApplications)
      .catch((err) => onError(errorMessage(err)));
  }, [block, onError, projectId, token]);

  useEffect(() => {
    if (!application) {
      setFlats([]);
      return;
    }

    fetchAssignmentFlats(token, projectId, { block, application })
      .then(setFlats)
      .catch((err) => onError(errorMessage(err)));
  }, [application, block, onError, projectId, token]);

  useEffect(() => {
    if (!application || !flat) {
      setLayers([]);
      return;
    }

    fetchAssignmentLayers(token, projectId, { application, flat })
      .then(setLayers)
      .catch((err) => onError(errorMessage(err)));
  }, [application, flat, onError, projectId, token]);

  useEffect(() => {
    if (!application || !flat || !layerId) {
      setWalls([]);
      return;
    }

    fetchAssignmentWalls(token, projectId, { application, flat, layerId })
      .then(setWalls)
      .catch((err) => onError(errorMessage(err)));
  }, [application, flat, layerId, onError, projectId, token]);

  useEffect(() => {
    if (!prefill) {
      setBlock('');
      setApplication('');
      setFlat('');
      setLayerId('');
      setSelectedWalls([]);
      setSelectedPainters([]);
      setMode('Both');
      setWorkDate(todayDateInput());
      setWorkingHours(8);
      setHoursEntryMode('recommended');
      setMaterialName('');
      setMaterialUsed(0);
      setMaterialSuggestion(null);
      setRemark('');
      return;
    }

    setBlock(prefill.block || '');
    setApplication(prefill.application || '');
    setFlat(prefill.flat || '');
    setLayerId(prefill.layer_id || '');
    setMode((prefill.machine_or_manual as WorkMode) || 'Both');
    setWorkDate(toDateInput(prefill.assignment_date) || todayDateInput());
    setSelectedWalls(splitList(prefill.pending_wall_names || prefill.assigned_wall_names || ''));
    setSelectedPainters(
      (prefill.reporting_painter_names?.length
        ? prefill.reporting_painter_names
        : prefill.assigned_painter_names) || [],
    );
    const prefilledWorkingHours = Number(
      prefill.reporting_working_hours ??
        (isHourBasedLayerName(prefill.layer_name)
          ? prefill.hours_for_one_painter
          : 0),
    );
    setWorkingHours(Math.max(0, prefilledWorkingHours));
    setHoursEntryMode(
      prefill.reporting_hours_mode ||
        (prefill.reporting_working_hours != null ? 'manual' : 'recommended'),
    );
    setMaterialName(prefill.material_name || '');
    setMaterialUsed(Math.max(0, Number(prefill.material_used_l_kg || 0)));
    setMaterialSuggestion(null);
    setRemark(`Assigned reporting submitted by ${username || 'system'}`);
  }, [prefill, username]);

  const wallOptions = useMemo(() => {
    const allNames = [
      ...walls.map((wall) => wall.wall_name),
      ...selectedWalls,
    ];

    return Array.from(new Set(allNames.filter(Boolean)));
  }, [selectedWalls, walls]);

  const selectedArea = useMemo(() => {
    if (selectedWalls.length === 0) return 0;

    const selectedSet = new Set(selectedWalls.map(norm));

    const dropdownArea = walls.reduce((sum, wall) => {
      if (!selectedSet.has(norm(wall.wall_name))) return sum;

      return sum + Number(
        (wall as any).pending_area ??
          (wall as any).wall_area ??
          (wall as any).assigned_today_area ??
          (wall as any).area ??
          0,
      );
    }, 0);

    if (dropdownArea > 0) return dropdownArea;

    // Assigned reporting opens with pre-selected pending walls before the
    // wall dropdown has always returned its full area data. In that case,
    // use the assigned-row pending area so working-hours and material-used
    // suggestions still work immediately for assigned work.
    if (isAssignedReporting && prefill) {
      return Number(
        (prefill as any).pending_area ??
          (prefill as any).assigned_area ??
          0,
      );
    }

    return 0;
  }, [isAssignedReporting, prefill, selectedWalls, walls]);

  const selectedLayerRow = useMemo(() => {
    return layers.find((item) => item.layer_id === layerId) || null;
  }, [layerId, layers]);

  const selectedLayerName = String(selectedLayerRow?.layer_name || prefill?.layer_name || '');
  const selectedLayerIsHourBased =
    Boolean(selectedLayerRow?.is_hour_based) || isHourBasedLayerName(selectedLayerName);

  useEffect(() => {
    if (!application || !selectedLayerName) {
      setProductivityOptions([]);
      return;
    }

    fetchAssignmentProductivityOptions(token, projectId, {
      application,
      layerName: selectedLayerName,
    })
      .then(setProductivityOptions)
      .catch((err) => onError(errorMessage(err)));
  }, [application, onError, projectId, selectedLayerName, token]);

  useEffect(() => {
    if (!application || !layerId || !selectedLayerName) {
      setMaterialSuggestion(null);
      setMaterialName('');
      setMaterialUsed(0);
      return;
    }

    fetchAssignmentMaterialSuggestion(token, projectId, {
      application,
      layerName: selectedLayerName,
    })
      .then((data) => {
        setMaterialSuggestion(data);
        setMaterialName(data?.material_name || '');
      })
      .catch((err) => {
        setMaterialSuggestion(null);
        setMaterialName('');
        setMaterialUsed(0);
        onError(errorMessage(err));
      });
  }, [application, layerId, onError, projectId, selectedLayerName, token]);

  const selectedProductivityPerHour = useMemo(() => {
    if (productivityOptions.length === 0) return 0;

    const exactMode = productivityOptions.find(
      (item) => norm(item.machine_or_manual) === norm(mode),
    );

    const bothMode = productivityOptions.find(
      (item) => norm(item.machine_or_manual) === 'BOTH',
    );

    const firstValid = productivityOptions.find(
      (item) =>
        Number(
          (item as any).productivity_per_hour ??
            (item as any).ideal_productivity_sqft_hr ??
            0,
        ) > 0,
    );

    return Number(
      (exactMode as any)?.productivity_per_hour ??
        (exactMode as any)?.ideal_productivity_sqft_hr ??
        (bothMode as any)?.productivity_per_hour ??
        (bothMode as any)?.ideal_productivity_sqft_hr ??
        (firstValid as any)?.productivity_per_hour ??
        (firstValid as any)?.ideal_productivity_sqft_hr ??
        0,
    );
  }, [mode, productivityOptions]);

  const painterCountForSuggestion = Math.max(selectedPainters.length, 1);

  const suggestedWorkingHours = useMemo(() => {
    if (selectedLayerIsHourBased) return Number(workingHours || 0);

    if (selectedArea <= 0 || selectedProductivityPerHour <= 0) {
      return 0;
    }

    return roundToTwo(
      selectedArea / selectedProductivityPerHour / painterCountForSuggestion,
    );
  }, [
    painterCountForSuggestion,
    selectedArea,
    selectedLayerIsHourBased,
    selectedProductivityPerHour,
    workingHours,
  ]);

  useEffect(() => {
    if (hoursEntryMode !== 'recommended') return;
    if (selectedLayerIsHourBased) return;

    if (suggestedWorkingHours > 0) {
      setWorkingHours(suggestedWorkingHours);
    }
  }, [hoursEntryMode, selectedLayerIsHourBased, suggestedWorkingHours]);

  const suggestedMaterialUsed = useMemo(() => {
    if (selectedLayerIsHourBased) return 0;

    const coverage = Number(materialSuggestion?.coverage || 0);

    if (selectedArea <= 0 || coverage <= 0) {
      return 0;
    }

    return roundToTwo(selectedArea / coverage);
  }, [materialSuggestion?.coverage, selectedArea, selectedLayerIsHourBased]);

  useEffect(() => {
    if (selectedLayerIsHourBased) return;

    setMaterialUsed(suggestedMaterialUsed);
  }, [selectedLayerIsHourBased, suggestedMaterialUsed]);

  const selectedLayerTotalHours = Number(selectedLayerRow?.total_hours ?? 24);
  const selectedLayerReportedHours = Number(
    selectedLayerRow?.reported_hours ??
      (selectedLayerIsHourBased
        ? 0
        : ((Number(
            selectedLayerRow?.wkdpct ??
              selectedLayerRow?.work_done_pct ??
              selectedLayerRow?.completion_pct ??
              selectedLayerRow?.completion_percent ??
              0,
          ) / 100) * selectedLayerTotalHours)),
  );
  const selectedLayerRemainingHours = Number(
    selectedLayerRow?.remaining_hours ??
      Math.max(0, selectedLayerTotalHours - selectedLayerReportedHours),
  );
  const selectedLayerPct = selectedLayerIsHourBased
    ? roundToTwo((selectedLayerReportedHours / Math.max(selectedLayerTotalHours, 1)) * 100)
    : Number(
        selectedLayerRow?.wkdpct ??
          selectedLayerRow?.work_done_pct ??
          selectedLayerRow?.completion_pct ??
          selectedLayerRow?.completion_percent ??
          0,
      );
  const newReportingHours = Number(workingHours || 0) * Math.max(selectedPainters.length, 1);
  const willExceedHourPlan =
    selectedLayerIsHourBased &&
    selectedPainters.length > 0 &&
    selectedLayerReportedHours + newReportingHours > selectedLayerTotalHours;

  const selectedLayerHasNoPendingWalls =
    Boolean(layerId) && !selectedLayerIsHourBased && wallOptions.length === 0;

  const selectedLayerWarning = selectedLayerIsHourBased
    ? ''
    : selectedLayerHasNoPendingWalls
      ? selectedLayerPct >= 100
        ? 'This layer is already 100% completed. No pending walls are available, so it cannot be reported again from this form.'
        : 'No pending walls are available for this layer. Check if this layer has already been reported or if surface data is missing.'
      : '';

  const requiredFieldsMissing =
    !block ||
    !application ||
    !flat ||
    !layerId ||
    !workDate ||
    selectedPainters.length === 0 ||
    Number(workingHours || 0) <= 0 ||
    (!selectedLayerIsHourBased && selectedWalls.length === 0);

  const canSubmit = !submitting && !selectedLayerHasNoPendingWalls && !requiredFieldsMissing;

  function changeBlock(value: string) {
    setBlock(value);
    setApplication('');
    setFlat('');
    setLayerId('');
    setSelectedWalls([]);
    setSelectedPainters([]);
    setMode('Both');
    setWorkingHours(8);
    setHoursEntryMode('recommended');
    setMaterialSuggestion(null);
    setMaterialName('');
    setMaterialUsed(0);
  }

  function changeApplication(value: string) {
    setApplication(value);
    setFlat('');
    setLayerId('');
    setSelectedWalls([]);
    setSelectedPainters([]);
    setMode('Both');
    setWorkingHours(8);
    setHoursEntryMode('recommended');
    setMaterialSuggestion(null);
    setMaterialName('');
    setMaterialUsed(0);
  }

  function changeFlat(value: string) {
    setFlat(value);
    setLayerId('');
    setSelectedWalls([]);
    setSelectedPainters([]);
    setMode('Both');
    setWorkingHours(8);
    setHoursEntryMode('recommended');
    setMaterialSuggestion(null);
    setMaterialName('');
    setMaterialUsed(0);
  }

  function changeLayer(value: string) {
    const nextLayer = layers.find((item) => item.layer_id === value);

    setLayerId(value);
    setSelectedWalls([]);
    setSelectedPainters([]);
    setMode(defaultWorkModeForLayer(nextLayer?.layer_name));
    setWorkingHours(8);
    setHoursEntryMode('recommended');
    setMaterialSuggestion(null);
    setMaterialName('');
    setMaterialUsed(0);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !block ||
      !application ||
      !flat ||
      !layerId ||
      selectedPainters.length === 0 ||
      Number(workingHours || 0) <= 0 ||
      (!selectedLayerIsHourBased && selectedWalls.length === 0)
    ) {
      onError(
        selectedLayerIsHourBased
          ? 'Fill block, application, flat, layer, painters and working hours.'
          : 'Fill block, application, flat, layer, walls, painters and working hours.',
      );
      return;
    }

    setSubmitting(true);

    try {
      await submitAssignmentReporting(token, projectId, {
        block,
        application,
        flat,
        layerId,
        wallNames: selectedLayerIsHourBased ? [] : selectedWalls,
        painterNames: selectedPainters,
        machineOrManual: mode,
        workingHours: Math.max(0, Number(workingHours || 0)),
        workDate,
        assignmentId: prefill?.assignment_id || null,
        materialName: materialName || null,
        materialUsedLKg: materialUsed || 0,
        remark:
          remark ||
          (isAssignedReporting
            ? `Assigned reporting submitted by ${username || 'system'}`
            : `Unassigned reporting submitted by ${username || 'system'}`),
      });

      await onSubmitted();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      id="assignment-reporting-form"
      onSubmit={submit}
      className={
        mobileFullscreen
          ? 'fixed inset-0 z-[80] flex min-h-0 flex-col overflow-hidden bg-slate-950 md:static md:block md:overflow-visible md:rounded-2xl md:border md:border-slate-800 md:bg-slate-900 md:p-4'
          : 'rounded-2xl border border-slate-800 bg-slate-900 p-4'
      }
    >
      {/* Phone-only full-screen header. Assigned and unassigned forms use
          the same structure; only the title and prefilled values differ. */}
      {mobileFullscreen && (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-950 px-3 md:hidden">
          <button
            type="button"
            onClick={onCancelPrefill}
            aria-label={
              isAssignedReporting
                ? 'Back to assigned work'
                : 'Back from unassigned work'
            }
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-sm font-bold text-slate-200 hover:bg-slate-800"
          >
            ←
          </button>

          <div className="min-w-0">
            <h3 className="truncate font-display text-sm font-bold text-slate-100">
              {isAssignedReporting
                ? 'Report Assigned Work'
                : 'Report Unassigned Work'}
            </h3>
            <p className="truncate text-[9px] leading-3 text-slate-500">
              {isAssignedReporting
                ? 'Assigned work is prefilled. Edit as needed.'
                : 'Select work details. Edit as needed.'}
            </p>
          </div>
        </div>
      )}

      <div
        className={
          mobileFullscreen
            ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-2 md:overflow-visible md:p-0'
            : ''
        }
      >
        {/* Existing desktop heading remains unchanged. */}
        <div
          className={`mb-4 flex flex-wrap items-start justify-between gap-3 ${
            mobileFullscreen ? 'hidden md:flex' : ''
          }`}
        >
          <div>
            <h3 className="font-display text-base font-bold">
              {isAssignedReporting
                ? 'Report Assigned Work'
                : 'Report Unassigned Work'}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {isAssignedReporting
                ? 'Assigned work is prefilled. Edit walls, painters, hours or material only when needed.'
                : 'This inserts directly into backend with assignmentId = null.'}
            </p>
          </div>

          {isAssignedReporting && (
            <button
              type="button"
              onClick={onCancelPrefill}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800"
            >
              Cancel Assigned Reporting
            </button>
          )}
        </div>

        {/* Compact one-column phone form; desktop keeps the existing 3-column form. */}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3 md:gap-3 [&_label]:text-[9px] md:[&_label]:text-[11px] [&_select]:h-9 [&_select]:py-1.5 [&_select]:text-xs md:[&_select]:h-auto md:[&_select]:py-2 md:[&_select]:text-sm">
          <Select
            label="Block"
            value={block}
            onChange={changeBlock}
            options={blocks.map((item) => item.block)}
            disabled={isAssignedReporting}
            helperText={isAssignedReporting ? 'Fixed from assigned work.' : undefined}
          />

          <Select
            label="Application"
            value={application}
            onChange={changeApplication}
            options={applications.map((item) => item.application)}
            disabled={isAssignedReporting || !block}
            helperText={
              isAssignedReporting
                ? 'Fixed from assigned work.'
                : !block
                  ? 'Select block first.'
                  : undefined
            }
          />

          <Select
            label="Flat"
            value={flat}
            onChange={changeFlat}
            options={flats.map((item) => item.flat)}
            disabled={isAssignedReporting || !application}
            helperText={
              isAssignedReporting
                ? 'Fixed from assigned work.'
                : !application
                  ? 'Select application first.'
                  : undefined
            }
          />

          <div>
            <Select
              label="Layer"
              value={layerId}
              onChange={changeLayer}
              options={layers.map((item) => {
                const itemIsHourBased =
                  Boolean(item.is_hour_based) ||
                  isHourBasedLayerName(item.layer_name);
                const totalHours = Number(item.total_hours ?? 24);
                const reportedHours = Number(item.reported_hours ?? 0);
                const pct = itemIsHourBased
                  ? roundToTwo(
                      (reportedHours / Math.max(totalHours, 1)) * 100,
                    )
                  : Number(
                      item.wkdpct ??
                        item.work_done_pct ??
                        item.completion_pct ??
                        item.completion_percent ??
                        0,
                    );

                return {
                  value: item.layer_id,
                  label: `${item.layer_name} (${formatNumber(pct)}%)`,
                };
              })}
              disabled={isAssignedReporting || !flat}
              helperText={
                isAssignedReporting
                  ? 'Fixed from assigned work.'
                  : !flat
                    ? 'Select flat first.'
                    : undefined
              }
            />

            {selectedLayerWarning && (
              <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">
                {selectedLayerWarning}
              </div>
            )}

            {willExceedHourPlan && (
              <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200">
                This reporting will cross{' '}
                {formatNumber(selectedLayerTotalHours)} planned hours.
              </div>
            )}
          </div>

          <Select
            label="Mode"
            value={mode}
            onChange={(value) => setMode(value as WorkMode)}
            options={WORK_MODES}
            disabled={isAssignedReporting || !layerId}
            helperText={
              isAssignedReporting
                ? 'Fixed from assigned work.'
                : !layerId
                  ? 'Select layer first.'
                  : undefined
            }
          />

          <ResponsiveDatePicker
            label="Work Date"
            value={workDate}
            onChange={setWorkDate}
            size={mobileFullscreen ? 'sm' : 'md'}
          />

          {!selectedLayerIsHourBased && (
            <div>
              <label className="mb-1 block uppercase tracking-wide text-slate-500">
                Area (sqft)
              </label>
              <input
                value={formatNumber(selectedArea)}
                readOnly
                className="h-9 w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 text-xs text-slate-300 outline-none md:h-auto md:px-3 md:py-2 md:text-sm"
              />
              <p className="mt-1 hidden text-[11px] text-slate-500 md:block">
                Auto-filled from selected walls.
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block uppercase tracking-wide text-slate-500">
              Material Name
            </label>
            <input
              value={materialName}
              readOnly
              placeholder={
                layerId
                  ? 'No material mapped for this application-layer'
                  : 'Auto-filled after layer selection'
              }
              className="h-9 w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 text-xs text-slate-300 outline-none md:h-auto md:px-3 md:py-2 md:text-sm"
            />

            {materialSuggestion && (
              <p className="mt-1 text-[10px] text-slate-500 md:text-[11px]">
                Coverage: {formatNumber(materialSuggestion.coverage)} sqft/unit
              </p>
            )}

            {!materialSuggestion && layerId && (
              <p className="mt-1 text-[10px] font-semibold text-amber-300 md:text-[11px]">
                Material mapping missing for selected application and layer.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
              Material Used L/KG
            </label>
            <input
              type="number"
              step={0.01}
              min={0}
              inputMode="decimal"
              value={materialUsed}
              onChange={(event) =>
                setMaterialUsed(roundToTwo(Number(event.target.value) || 0))
              }
              className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs outline-none focus:border-amber-400 md:h-auto md:px-3 md:py-2 md:text-sm"
            />

            {!selectedLayerIsHourBased && materialSuggestion && selectedArea > 0 && (
              <p className="mt-1 text-[10px] text-slate-500 md:text-[11px]">
                Suggested: {formatNumber(selectedArea)} sqft ÷{' '}
                {formatNumber(materialSuggestion.coverage)} coverage ={' '}
                {formatNumber(suggestedMaterialUsed)} L/KG.
              </p>
            )}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 md:mt-4 md:gap-4 lg:grid-cols-2">
          {!selectedLayerIsHourBased ? (
            layerId ? (
              <MultiPicker
                title="Walls"
                items={wallOptions}
                selected={selectedWalls}
                onChange={setSelectedWalls}
                showSelectAll
                showClearAll
                showSearch
                searchPlaceholder="Search wall name, e.g. C"
                mobileCompact
                mobileListHeight="walls"
                showSelectedCount
              />
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-500 md:text-sm">
                Select layer first to load walls.
              </div>
            )
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-500 md:text-sm">
              Hour-based layer: walls and area are not required.
            </div>
          )}

          {layerId && (selectedLayerIsHourBased || selectedWalls.length > 0) ? (
            <div>
              <MultiPicker
                title="Painters"
                items={painterOptions}
                selected={selectedPainters}
                onChange={setSelectedPainters}
                showClearAll
                mobileCompact
                mobileListHeight="painters"
              />

              <p className="mt-1 text-[10px] text-slate-500 md:text-[11px]">
                {selectedPainters.length > 0
                  ? `${selectedPainters.length} painter${selectedPainters.length === 1 ? '' : 's'} selected.`
                  : 'Suggested hours currently assume 1 painter.'}
              </p>

              <div className="mt-3">
                <label className="mb-1 block text-[9px] uppercase tracking-wide text-slate-500 md:text-[11px]">
                  Working Hours / Painter
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  inputMode="decimal"
                  value={roundToTwo(Number(workingHours || 0))}
                  onChange={(event) => {
                    setHoursEntryMode('manual');
                    setWorkingHours(
                      roundToTwo(
                        Math.max(0, Number(event.target.value) || 0),
                      ),
                    );
                  }}
                  disabled={!layerId || submitting}
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 font-mono text-xs text-amber-300 outline-none focus:border-amber-400 md:h-auto md:px-3 md:py-2 md:text-sm"
                />

                {!selectedLayerIsHourBased && (
                  <p className="mt-1 text-[10px] text-slate-500 md:text-[11px]">
                    Suggested: {formatNumber(selectedArea)} sqft ÷{' '}
                    {formatNumber(selectedProductivityPerHour)} sqft/hr ÷{' '}
                    {painterCountForSuggestion} painter
                    {painterCountForSuggestion === 1 ? '' : 's'} ={' '}
                    {formatNumber(suggestedWorkingHours)} h per painter. Edit the
                    value directly if actual hours differ.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-500 md:text-sm">
              {selectedLayerIsHourBased
                ? 'Select layer first to select painters.'
                : 'Select walls first to select painters.'}
            </div>
          )}
        </div>

        <div className="mt-2 md:mt-4">
          <label className="mb-1 block text-[9px] uppercase tracking-wide text-slate-500 md:text-[11px]">
            Remark
          </label>
          <textarea
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs outline-none focus:border-amber-400 md:px-3 md:text-sm"
          />
        </div>

        {/* Desktop submit remains exactly in the normal form. */}
        <button
          type="submit"
          disabled={!canSubmit}
          className={`mt-4 rounded-lg bg-emerald-500 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 ${
            mobileFullscreen ? 'hidden md:inline-flex' : ''
          }`}
        >
          {submitting
            ? 'Submitting...'
            : selectedLayerHasNoPendingWalls
              ? 'No Pending Walls'
              : requiredFieldsMissing
                ? 'Fill Required Fields'
                : 'Submit Reporting'}
        </button>
      </div>

      {/* Phone footer stays visible while the form body scrolls. */}
      {mobileFullscreen && (
        <div className="grid h-[58px] shrink-0 grid-cols-[0.8fr_1.4fr] gap-2 border-t border-slate-800 bg-slate-950 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
          <button
            type="button"
            onClick={onCancelPrefill}
            disabled={submitting}
            className="h-10 rounded-lg border border-slate-700 bg-slate-900 text-xs font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={!canSubmit}
            className="h-10 rounded-lg bg-emerald-500 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting
              ? 'Submitting...'
              : selectedLayerHasNoPendingWalls
                ? 'No Pending Walls'
                : requiredFieldsMissing
                  ? 'Fill Required Fields'
                  : 'Submit Report'}
          </button>
        </div>
      )}
    </form>
  );
}

function ReportedWorkView({
  token,
  projectId,
  username,
  painters,
  reportedDate,
  setReportedDate,
  rows,
  loading,
  onRefresh,
  onUpdated,
  onError,
}: {
  token: string;
  projectId: string;
  username?: string | null;
  painters: AssignmentPainter[];
  reportedDate: string;
  setReportedDate: (value: string) => void;
  rows: ReportedBackendRow[];
  loading: boolean;
  onRefresh: () => void;
  onUpdated: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [editingRow, setEditingRow] = useState<ReportedBackendRow | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  async function handleSaveEdit(payload: UpdateReportedBackendRowPayload) {
    if (!editingRow) return;

    setEditLoading(true);

    try {
      await updateReportedBackendRowLocal(
        token,
        projectId,
        editingRow.id,
        payload,
      );
      setEditingRow(null);
      await onUpdated();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setEditLoading(false);
    }
  }

  if (editingRow) {
    return (
      <EditReportedBackendRowForm
        token={token}
        projectId={projectId}
        row={editingRow}
        username={username}
        painters={painters}
        loading={editLoading}
        onClose={() => {
          if (!editLoading) setEditingRow(null);
        }}
        onSave={handleSaveEdit}
        onError={onError}
      />
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 sm:rounded-2xl sm:p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:flex sm:flex-wrap sm:gap-3">
          <ResponsiveDatePicker
            label="Reported Date"
            value={reportedDate}
            onChange={setReportedDate}
            size="sm"
          />

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs font-bold hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:h-10 sm:px-4 sm:text-sm"
          >
            <span className="sm:hidden">{loading ? '...' : 'Fetch'}</span>
            <span className="hidden sm:inline">
              {loading ? 'Loading...' : 'Fetch Reported Rows'}
            </span>
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-slate-500 sm:hidden">
          <span>Reported work for the selected date</span>
          <span className="shrink-0 font-mono font-bold text-slate-300">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'}
          </span>
        </div>
      </div>

      {/* Phone cards use the same visual hierarchy as Assigned Work. */}
      <div className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <ReportedWorkMobileCard
            key={row.id}
            row={row}
            onEdit={() => setEditingRow(row)}
          />
        ))}

        {!loading && rows.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 text-center">
            <p className="text-sm font-semibold text-slate-300">
              No reported work
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Select another reported date or refresh this view.
            </p>
          </div>
        )}

        {loading && rows.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 text-center text-sm text-slate-500">
            Loading reported work...
          </div>
        )}
      </div>

      {/* Existing desktop table is preserved. */}
      <div className="hidden sm:block">
        <SimpleTable
          columns={[
            'ID',
            'Date',
            'Application',
            'Flat',
            'Layer',
            'Walls',
            'Area',
            'Painters',
            'Hours',
            'Work Status',
            'Action',
          ]}
          rows={rows.map((row) => {
            const hourBased = isHourBasedLayerName(row.work_layer);

            return [
              <span key={row.id} className="font-mono text-xs text-cyan-300">{row.id}</span>,
              shortDate(row.work_date),
              row.application,
              row.flat,
              row.work_layer,
              hourBased ? '-' : row.wall_names || '-',
              hourBased ? '-' : formatNumber(row.area),
              row.painter_names || '-',
              formatNumber(row.working_hours),
              row.work_status || '-',
              <button
                key={`edit-${row.id}`}
                type="button"
                onClick={() => setEditingRow(row)}
                className="rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20"
              >
                Edit
              </button>,
            ];
          })}
          empty="No backend reporting rows found for selected date."
        />
      </div>

    </div>
  );
}

function ReportedWorkMobileCard({
  row,
  onEdit,
}: {
  row: ReportedBackendRow;
  onEdit: () => void;
}) {
  const [wallsExpanded, setWallsExpanded] = useState(false);
  const hourBased = isHourBasedLayerName(row.work_layer);
  const walls = hourBased
    ? 'Hour-based work'
    : String(row.wall_names || 'Walls not mapped');
  const wallsNeedExpansion = walls.length > 95;
  const visibleWalls =
    wallsNeedExpansion && !wallsExpanded ? `${walls.slice(0, 92)}…` : walls;

  return (
    <article className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">
                {row.application || '-'}
              </span>
              <strong className="font-mono text-sm text-cyan-300">
                {row.flat || '-'}
              </strong>
            </div>

            <p className="mt-1.5 text-xs font-semibold text-slate-100">
              {row.work_layer || '-'}
            </p>
            <p className="mt-1 font-mono text-[9px] text-slate-500">
              {shortDate(row.work_date)} · {row.id}
            </p>
          </div>

          <span className="shrink-0 font-mono text-sm font-bold text-amber-300">
            {formatNumber(row.working_hours)} h
          </span>
        </div>

        <div className="mt-2 rounded-lg bg-slate-950/70 px-2.5 py-2">
          <p className="break-words text-[10px] leading-4 text-slate-400">
            {visibleWalls}
          </p>

          {wallsNeedExpansion && (
            <button
              type="button"
              onClick={() => setWallsExpanded((current) => !current)}
              className="mt-1 text-[10px] font-bold text-cyan-300"
            >
              {wallsExpanded ? 'Show less' : 'Show all walls'}
            </button>
          )}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3">
          <AssignedWorkMetric
            label="Area"
            value={hourBased ? '-' : formatNumber(row.area)}
          />
          <AssignedWorkMetric
            label="Painters"
            value={row.painter_names || '-'}
          />
          <AssignedWorkMetric
            label="Status"
            value={row.work_status || '-'}
          />
        </div>

        <button
          type="button"
          onClick={onEdit}
          className="mt-3 w-full rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20"
        >
          Edit reported row
        </button>
      </div>
    </article>
  );
}


function EditReportedBackendRowForm({
  token,
  projectId,
  row,
  username,
  painters,
  loading,
  onClose,
  onSave,
  onError,
}: {
  token: string;
  projectId: string;
  row: ReportedBackendRow;
  username?: string | null;
  painters: AssignmentPainter[];
  loading: boolean;
  onClose: () => void;
  onSave: (payload: UpdateReportedBackendRowPayload) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const hourBased = isHourBasedLayerName(row.work_layer);
  const [layers, setLayers] = useState<any[]>([]);
  const [walls, setWalls] = useState<AssignmentWallOption[]>([]);
  const [layerId, setLayerId] = useState(row.layer_id || '');
  const [originalWallOptions, setOriginalWallOptions] = useState<string[]>(
    hourBased ? [] : splitList(row.wall_names || ''),
  );
  const [selectedWalls, setSelectedWalls] = useState<string[]>(
    hourBased ? [] : splitList(row.wall_names || ''),
  );
  const [machineOrManual, setMachineOrManual] = useState<WorkMode>(
    ((row.machine_or_manual || 'Both') as WorkMode),
  );
  const [selectedPainters, setSelectedPainters] = useState<string[]>(
    splitList(row.painter_names || ''),
  );
  const [workingHours, setWorkingHours] = useState(
    Math.max(0, Number(row.working_hours || 0)),
  );
  const [materialName] = useState(row.material_name || '');
  const [materialUsed, setMaterialUsed] = useState(
    Number(row.material_used_l_kg || 0),
  );
  const [remark, setRemark] = useState(row.remark || '');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    setLayerId(row.layer_id || '');
    setOriginalWallOptions(hourBased ? [] : splitList(row.wall_names || ''));
    setSelectedWalls(hourBased ? [] : splitList(row.wall_names || ''));
    setMachineOrManual(((row.machine_or_manual || 'Both') as WorkMode));
    setSelectedPainters(splitList(row.painter_names || ''));
    setWorkingHours(Math.max(0, Number(row.working_hours || 0)));
    setMaterialUsed(Number(row.material_used_l_kg || 0));
    setRemark(row.remark || '');
    setLocalError('');
  }, [hourBased, row]);

  useEffect(() => {
    if (!row.application || !row.flat) {
      setLayers([]);
      return;
    }

    fetchAssignmentLayers(token, projectId, {
      application: row.application,
      flat: row.flat,
    })
      .then((items) => {
        setLayers(items);

        if (!row.layer_id) {
          const matchingLayer = items.find(
            (item: any) => norm(item.layer_name) === norm(row.work_layer),
          );

          if (matchingLayer?.layer_id) {
            setLayerId(matchingLayer.layer_id);
          }
        }
      })
      .catch((err) => onError(errorMessage(err)));
  }, [onError, projectId, row.application, row.flat, row.layer_id, row.work_layer, token]);

  useEffect(() => {
    if (hourBased || !row.application || !row.flat || !layerId) {
      setWalls([]);
      return;
    }

    fetchAssignmentWalls(token, projectId, {
      application: row.application,
      flat: row.flat,
      layerId,
    })
      .then(setWalls)
      .catch((err) => onError(errorMessage(err)));
  }, [hourBased, layerId, onError, projectId, row.application, row.flat, token]);

  const selectedLayerRow = useMemo(() => {
    return (
      layers.find(
        (item: any) =>
          String(item.layer_id || '') === String(layerId || '') ||
          norm(item.layer_name) === norm(row.work_layer),
      ) || null
    );
  }, [layerId, layers, row.work_layer]);

  const wallOptions = useMemo(() => {
    const allNames = [
      ...walls.map((wall) => wall.wall_name),
      ...originalWallOptions,
      ...selectedWalls,
    ];

    return Array.from(new Set(allNames.filter(Boolean)));
  }, [originalWallOptions, selectedWalls, walls]);

  const painterOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...painters.map(painterDisplay).filter(Boolean),
            ...selectedPainters,
          ].filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [painters, selectedPainters],
  );

  const selectedArea = useMemo(() => {
    if (hourBased) return 0;
    if (selectedWalls.length === 0) return 0;

    const originalNames = originalWallOptions.length
      ? originalWallOptions
      : splitList(row.wall_names || '');
    const originalSet = new Set(originalNames.map(norm));
    const fallbackAreaPerOriginalWall =
      originalNames.length > 0 ? Number(row.area || 0) / originalNames.length : 0;

    return roundToTwo(
      selectedWalls.reduce((sum, selectedWall) => {
        const matchedWall = walls.find(
          (wall) => norm(wall.wall_name) === norm(selectedWall),
        );

        const dropdownArea = Number(
          (matchedWall as any)?.pending_area ??
            (matchedWall as any)?.wall_area ??
            (matchedWall as any)?.assigned_today_area ??
            (matchedWall as any)?.area ??
            0,
        );

        if (dropdownArea > 0) {
          return sum + dropdownArea;
        }

        if (originalSet.has(norm(selectedWall))) {
          return sum + fallbackAreaPerOriginalWall;
        }

        return sum;
      }, 0),
    );
  }, [hourBased, originalWallOptions, row.area, row.wall_names, selectedWalls, walls]);

  const canSave = useMemo(() => {
    if (loading) return false;
    if (!hourBased && selectedWalls.length === 0) return false;
    if (
      !Number.isFinite(Number(workingHours)) ||
      Number(workingHours) < 0
    ) {
      return false;
    }
    if (!Number.isFinite(Number(materialUsed)) || Number(materialUsed) < 0) {
      return false;
    }
    return true;
  }, [
    hourBased,
    loading,
    materialUsed,
    selectedWalls.length,
    workingHours,
  ]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError('');

    if (!hourBased && selectedWalls.length === 0) {
      setLocalError('Select at least one wall for area-based reported work.');
      return;
    }

    if (
      !Number.isFinite(Number(workingHours)) ||
      Number(workingHours) < 0
    ) {
      setLocalError('Enter valid working hours per painter.');
      return;
    }

    if (!Number.isFinite(Number(materialUsed)) || Number(materialUsed) < 0) {
      setLocalError('Enter valid material used quantity.');
      return;
    }

    await onSave({
      wallNames: hourBased ? [] : selectedWalls,
      painterNames: selectedPainters,
      machineOrManual,
      workingHours: roundToTwo(Math.max(0, Number(workingHours || 0))),
      materialName: materialName.trim() || null,
      materialUsedLKg: roundToTwo(Number(materialUsed) || 0),
      remark: remark.trim() || null,
      changedBy: username || 'system',
    });
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-100 sm:rounded-2xl sm:p-4 md:text-sm"
    >
      <div className="mb-4 flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-100 sm:text-lg">
            Edit Reported Work
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            This updates the same backend row. Dependent assignment views will read the updated backend data.
          </p>
          <p className="mt-1 font-mono text-[10px] text-slate-600">
            Backend ID: {row.id}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
        >
          Cancel Edit
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 text-[10px] uppercase tracking-wide text-slate-500 md:grid-cols-3 md:gap-3 md:text-[11px]">
        <div>
          <label className="mb-1 block">Block</label>
          <input
            value={row.block || '-'}
            readOnly
            className="h-9 w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 text-xs text-slate-300 outline-none md:h-auto md:px-3 md:py-2 md:text-sm"
          />
          <p className="mt-1 text-[10px] normal-case tracking-normal text-slate-500">
            Fixed from reported row.
          </p>
        </div>

        <div>
          <label className="mb-1 block">Application</label>
          <input
            value={row.application || '-'}
            readOnly
            className="h-9 w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 text-xs text-slate-300 outline-none md:h-auto md:px-3 md:py-2 md:text-sm"
          />
          <p className="mt-1 text-[10px] normal-case tracking-normal text-slate-500">
            Fixed from reported row.
          </p>
        </div>

        <div>
          <label className="mb-1 block">Flat</label>
          <input
            value={row.flat || '-'}
            readOnly
            className="h-9 w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 text-xs text-slate-300 outline-none md:h-auto md:px-3 md:py-2 md:text-sm"
          />
          <p className="mt-1 text-[10px] normal-case tracking-normal text-slate-500">
            Fixed from reported row.
          </p>
        </div>

        <div>
          <label className="mb-1 block">Layer</label>
          <input
            value={`${row.work_layer || '-'} (${formatNumber((selectedLayerRow as any)?.wkdpct ?? 0)}%)`}
            readOnly
            className="h-9 w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 text-xs text-slate-300 outline-none md:h-auto md:px-3 md:py-2 md:text-sm"
          />
          <p className="mt-1 text-[10px] normal-case tracking-normal text-slate-500">
            Fixed from reported row.
          </p>
        </div>

        <Select
          label="Mode"
          value={machineOrManual}
          onChange={(value) => setMachineOrManual(value as WorkMode)}
          options={WORK_MODES}
          disabled
          helperText="Fixed from the reported assignment."
        />

        <div>
          <label className="mb-1 block">Work Date</label>
          <input
            value={toDateInput(row.work_date)}
            readOnly
            className="h-9 w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 text-xs text-slate-300 outline-none md:h-auto md:px-3 md:py-2 md:text-sm"
          />
          <p className="mt-1 text-[10px] normal-case tracking-normal text-slate-500">
            Date is not changed from edit mode.
          </p>
        </div>

        {!hourBased && (
          <div>
            <label className="mb-1 block">Area (sqft)</label>
            <input
              value={formatNumber(selectedArea)}
              readOnly
              className="h-9 w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 text-xs text-slate-300 outline-none md:h-auto md:px-3 md:py-2 md:text-sm"
            />
            <p className="mt-1 text-[10px] normal-case tracking-normal text-slate-500">
              Recalculated from selected walls on save.
            </p>
          </div>
        )}

        <div>
          <label className="mb-1 block">Material Name</label>
          <input
            value={materialName || 'No material recorded'}
            readOnly
            className="h-9 w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 text-xs text-slate-300 outline-none md:h-auto md:px-3 md:py-2 md:text-sm"
          />
          <p className="mt-1 text-[10px] normal-case tracking-normal text-slate-500">
            Material name remains as reported.
          </p>
        </div>

        <div>
          <label className="mb-1 block">Material Used L/KG</label>
          <input
            type="number"
            step={0.01}
            min={0}
            inputMode="decimal"
            value={materialUsed}
            disabled={loading}
            onChange={(event) =>
              setMaterialUsed(roundToTwo(Number(event.target.value) || 0))
            }
            className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-100 outline-none focus:border-amber-400 md:h-auto md:px-3 md:py-2 md:text-sm"
          />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-3 md:mt-4 md:grid-cols-2">
        {!hourBased ? (
          <MultiPicker
            title={`Walls${selectedWalls.length ? ` (${selectedWalls.length} selected)` : ''}`}
            items={wallOptions}
            selected={selectedWalls}
            onChange={setSelectedWalls}
            showSelectAll
            showClearAll
            showSearch
            searchPlaceholder="Search wall name, e.g. C"
            mobileCompact
            mobileListHeight="walls"
            showSelectedCount
          />
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-500 md:text-sm">
            Hour-based work has no wall selection.
          </div>
        )}

        <MultiPicker
          title={`Painters${selectedPainters.length ? ` (${selectedPainters.length} selected)` : ''}`}
          items={painterOptions}
          selected={selectedPainters}
          onChange={setSelectedPainters}
          showClearAll
          showSearch
          searchPlaceholder="Search painter"
          mobileCompact
          showSelectedCount
        />
      </div>

      <div className="mt-2 md:mt-4">
        <label className="mb-1 block text-[9px] uppercase tracking-wide text-slate-500 md:text-[11px]">
          Working Hours / Painter
        </label>
        <input
          type="number"
          min={0}
          step={0.01}
          inputMode="decimal"
          value={roundToTwo(Number(workingHours || 0))}
          disabled={loading}
          onChange={(event) =>
            setWorkingHours(
              roundToTwo(Math.max(0, Number(event.target.value) || 0)),
            )
          }
          className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 font-mono text-xs text-slate-100 outline-none focus:border-amber-400 md:h-auto md:px-3 md:py-2 md:text-sm"
        />
        <p className="mt-1 text-[10px] text-slate-500 md:text-[11px]">
          Stored as hours per painter for this reported backend row.
        </p>
      </div>

      <div className="mt-2 md:mt-4">
        <label className="mb-1 block text-[9px] uppercase tracking-wide text-slate-500 md:text-[11px]">
          Remark
        </label>
        <textarea
          value={remark}
          disabled={loading}
          onChange={(event) => setRemark(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs outline-none focus:border-amber-400 md:px-3 md:text-sm"
        />
      </div>

      {localError && (
        <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200">
          {localError}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
        <button
          type="submit"
          disabled={!canSave}
          className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Saving...' : 'Save Edited Reporting'}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="rounded-lg border border-slate-700 bg-slate-950 px-5 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}


function AssignedHistoryView({
  assignedDate,
  setAssignedDate,
  rows,
  loading,
  onRefresh,
}: {
  assignedDate: string;
  setAssignedDate: (value: string) => void;
  rows: AssignedHistoryRow[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 sm:rounded-2xl sm:p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:flex sm:flex-wrap sm:gap-3">
          <ResponsiveDatePicker
            label="Assignment Date"
            value={assignedDate}
            onChange={setAssignedDate}
            size="sm"
          />

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs font-bold hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:h-10 sm:px-4 sm:text-sm"
          >
            <span className="sm:hidden">{loading ? '...' : 'Fetch'}</span>
            <span className="hidden sm:inline">
              {loading ? 'Loading...' : 'Fetch Assigned Rows'}
            </span>
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-slate-500 sm:hidden">
          <span>Assigned history for the selected date</span>
          <span className="shrink-0 font-mono font-bold text-slate-300">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'}
          </span>
        </div>
      </div>

      {/* Phone cards use the same visual hierarchy as Assigned Work. */}
      <div className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <AssignedHistoryMobileCard
            key={`${row.assignment_id}-${row.layer_id || ''}-${row.surface_type || ''}`}
            row={row}
          />
        ))}

        {!loading && rows.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 text-center">
            <p className="text-sm font-semibold text-slate-300">
              No assignment history
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Select another assignment date or refresh this view.
            </p>
          </div>
        )}

        {loading && rows.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 text-center text-sm text-slate-500">
            Loading assignment history...
          </div>
        )}
      </div>

      {/* Existing desktop table is preserved. */}
      <div className="hidden sm:block">
        <SimpleTable
          columns={[
            'Date',
            'Application',
            'Flat',
            'Layer',
            'Surface',
            'Walls',
            'Area',
            'Hours',
            'Mode',
            'Status',
          ]}
          rows={rows.map((row) => {
            const hourBased = isHourBasedLayerName(row.layer_name);

            return [
              shortDate(row.assignment_date),
              row.application,
              row.flat,
              row.layer_name,
              hourBased ? '-' : row.surface_type || '-',
              hourBased ? '-' : row.wall_names || '-',
              hourBased ? '-' : formatNumber(row.assigned_area),
              `${formatNumber(row.expected_hours)} h`,
              hourBased ? '-' : row.machine_or_manual || '-',
              row.assignment_status || '-',
            ];
          })}
          empty="No assigned rows found for selected date."
        />
      </div>
    </div>
  );
}

function AssignedHistoryMobileCard({ row }: { row: AssignedHistoryRow }) {
  const [wallsExpanded, setWallsExpanded] = useState(false);
  const hourBased = isHourBasedLayerName(row.layer_name);
  const walls = hourBased
    ? 'Hour-based work'
    : String(row.wall_names || 'Walls not mapped');
  const wallsNeedExpansion = walls.length > 95;
  const visibleWalls =
    wallsNeedExpansion && !wallsExpanded ? `${walls.slice(0, 92)}…` : walls;

  return (
    <article className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">
                {row.application || '-'}
              </span>
              <strong className="font-mono text-sm text-cyan-300">
                {row.flat || '-'}
              </strong>
            </div>

            <p className="mt-1.5 text-xs font-semibold text-slate-100">
              {row.layer_name || '-'}
            </p>
            <p className="mt-1 font-mono text-[9px] text-slate-500">
              {shortDate(row.assignment_date)}
            </p>
          </div>

          <span className="shrink-0 font-mono text-sm font-bold text-amber-300">
            {formatNumber(row.expected_hours)} h
          </span>
        </div>

        <div className="mt-2 rounded-lg bg-slate-950/70 px-2.5 py-2">
          <p className="break-words text-[10px] leading-4 text-slate-400">
            {!hourBased && row.surface_type ? (
              <span className="font-semibold text-slate-300">
                {row.surface_type} ·{' '}
              </span>
            ) : null}
            {visibleWalls}
          </p>

          {wallsNeedExpansion && (
            <button
              type="button"
              onClick={() => setWallsExpanded((current) => !current)}
              className="mt-1 text-[10px] font-bold text-cyan-300"
            >
              {wallsExpanded ? 'Show less' : 'Show all walls'}
            </button>
          )}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3">
          <AssignedWorkMetric
            label="Area"
            value={hourBased ? '-' : formatNumber(row.assigned_area)}
          />
          <AssignedWorkMetric
            label="Mode"
            value={hourBased ? '-' : row.machine_or_manual || '-'}
          />
          <AssignedWorkMetric
            label="Status"
            value={row.assignment_status || '-'}
          />
        </div>
      </div>
    </article>
  );
}

function AssignedVsReportedView({
  comparisonDate,
  setComparisonDate,
  assignedRows,
  reportedRows,
  loading,
  onRefresh,
}: {
  comparisonDate: string;
  setComparisonDate: (value: string) => void;
  assignedRows: AssignedHistoryRow[];
  reportedRows: ReportedBackendRow[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [searchText, setSearchText] = useState('');
  const [applicationFilter, setApplicationFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [expandedMobileRows, setExpandedMobileRows] = useState<Record<string, boolean>>({});

  const comparisonRows = useMemo<AssignedVsReportedRow[]>(() => {
    const reportsByAssignment = new Map<string, ReportedBackendRow[]>();

    reportedRows.forEach((reported) => {
      const assignmentId = String(reported.assignment_id || '').trim();

      if (!assignmentId) return;

      const current = reportsByAssignment.get(assignmentId) || [];
      current.push(reported);
      reportsByAssignment.set(assignmentId, current);
    });

    return assignedRows
      .map((assigned) => {
        const assignmentId = String(assigned.assignment_id || '').trim();
        const matchingReports = reportsByAssignment.get(assignmentId) || [];
        const hourBased = isHourBasedLayerName(assigned.layer_name);

        const assignedArea = hourBased
          ? 0
          : Number(assigned.assigned_area || 0);

        const reportedArea = hourBased
          ? 0
          : matchingReports.reduce(
              (sum, reported) => sum + Number(reported.area || 0),
              0,
            );

        const assignedHours = Number(assigned.expected_hours || 0);
        const reportedHours = matchingReports.reduce(
          (sum, reported) => sum + Number(reported.working_hours || 0),
          0,
        );

        const remainingArea = hourBased
          ? 0
          : Math.max(0, assignedArea - reportedArea);

        const remainingHours = Math.max(
          0,
          assignedHours - reportedHours,
        );

        const assignedWalls = uniqueNormalizedList(
          splitList(assigned.wall_names || ''),
        );

        const reportedWalls = uniqueNormalizedList(
          matchingReports.flatMap((reported) =>
            splitList(reported.wall_names || ''),
          ),
        );

        const reportedWallSet = new Set(
          reportedWalls.map((wall) => norm(wall)),
        );

        const remainingWalls = assignedWalls.filter(
          (wall) => !reportedWallSet.has(norm(wall)),
        );

        const assignedMeasure =
          hourBased || assignedArea <= 0 ? assignedHours : assignedArea;

        const reportedMeasure =
          hourBased || assignedArea <= 0 ? reportedHours : reportedArea;

        const progressPct =
          assignedMeasure > 0
            ? roundToTwo((reportedMeasure / assignedMeasure) * 100)
            : reportedMeasure > 0
              ? 100
              : 0;

        let status: AssignedVsReportedStatus = 'Not Reported';

        if (matchingReports.length > 0 && reportedMeasure > 0) {
          if (
            assignedMeasure > 0 &&
            reportedMeasure > assignedMeasure + 0.01
          ) {
            status = 'Over Reported';
          } else if (
            assignedMeasure <= 0 ||
            reportedMeasure + 0.01 >= assignedMeasure
          ) {
            status = 'Fully Reported';
          } else {
            status = 'Partially Reported';
          }
        }

        const painters = uniqueNormalizedList(
          matchingReports.flatMap((reported) =>
            splitList(reported.painter_names || ''),
          ),
        );

        return {
          key: `${assignmentId}|${assigned.layer_id || ''}|${
            assigned.surface_type || ''
          }`,
          assignmentId,
          assignmentDate: assigned.assignment_date,
          block: assigned.block,
          application: assigned.application,
          flat: assigned.flat,
          layerName: assigned.layer_name,
          surfaceType: assigned.surface_type,
          machineOrManual: assigned.machine_or_manual,
          hourBased,
          assignedArea,
          reportedArea,
          remainingArea,
          assignedHours,
          reportedHours,
          remainingHours,
          assignedWalls,
          reportedWalls,
          remainingWalls,
          painters,
          reportCount: matchingReports.length,
          progressPct,
          status,
        };
      })
      .sort(
        (a, b) =>
          a.application.localeCompare(b.application) ||
          flatSortValue(a.flat) - flatSortValue(b.flat) ||
          a.flat.localeCompare(b.flat) ||
          a.layerName.localeCompare(b.layerName),
      );
  }, [assignedRows, reportedRows]);

  const assignedIds = useMemo(
    () =>
      new Set(
        assignedRows
          .map((row) => String(row.assignment_id || '').trim())
          .filter(Boolean),
      ),
    [assignedRows],
  );

  const unmatchedReportedCount = useMemo(
    () =>
      reportedRows.filter((row) => {
        const assignmentId = String(row.assignment_id || '').trim();
        return !assignmentId || !assignedIds.has(assignmentId);
      }).length,
    [assignedIds, reportedRows],
  );

  const applicationOptions = useMemo(
    () =>
      Array.from(
        new Set(
          comparisonRows
            .map((row) => String(row.application || '').trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [comparisonRows],
  );

  const visibleRows = useMemo(() => {
    const query = norm(searchText);

    return comparisonRows.filter((row) => {
      if (
        applicationFilter !== 'All' &&
        row.application !== applicationFilter
      ) {
        return false;
      }

      if (statusFilter !== 'All' && row.status !== statusFilter) {
        return false;
      }

      if (!query) return true;

      return norm(
        [
          row.assignmentId,
          row.block,
          row.application,
          row.flat,
          row.layerName,
          row.surfaceType,
          row.machineOrManual,
          row.status,
          row.assignedWalls.join(' '),
          row.reportedWalls.join(' '),
          row.remainingWalls.join(' '),
          row.painters.join(' '),
        ].join(' '),
      ).includes(query);
    });
  }, [
    applicationFilter,
    comparisonRows,
    searchText,
    statusFilter,
  ]);

  const summary = useMemo(() => {
    return {
      assignments: visibleRows.length,
      fullyReported: visibleRows.filter(
        (row) => row.status === 'Fully Reported',
      ).length,
      partiallyReported: visibleRows.filter(
        (row) => row.status === 'Partially Reported',
      ).length,
      notReported: visibleRows.filter(
        (row) => row.status === 'Not Reported',
      ).length,
      remainingArea: visibleRows.reduce(
        (sum, row) => sum + Number(row.remainingArea || 0),
        0,
      ),
      remainingHours: visibleRows.reduce(
        (sum, row) => sum + Number(row.remainingHours || 0),
        0,
      ),
    };
  }, [visibleRows]);

  function handleDateChange(value: string) {
    setComparisonDate(value);
    setSearchText('');
    setApplicationFilter('All');
    setStatusFilter('All');
    setExpandedMobileRows({});
  }

  function toggleMobileDetails(rowKey: string) {
    setExpandedMobileRows((current) => ({
      ...current,
      [rowKey]: !current[rowKey],
    }));
  }

  return (
    <div className="assigned-vs-reported-view space-y-3 sm:space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 sm:rounded-2xl sm:p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:flex sm:flex-wrap sm:gap-3">
          <ResponsiveDatePicker
            label="Comparison Date"
            value={comparisonDate}
            onChange={handleDateChange}
            size="sm"
          />

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs font-bold hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:h-10 sm:px-4 sm:text-sm"
          >
            <span className="sm:hidden">{loading ? '...' : 'Fetch'}</span>
            <span className="hidden sm:inline">
              {loading ? 'Loading...' : 'Fetch Comparison'}
            </span>
          </button>
        </div>

        <p className="mt-2 text-[10px] leading-4 text-slate-500 sm:text-xs">
          Read-only comparison of Assigned History and Reported Work for the
          selected date. No data is created or updated from this view.
        </p>
      </div>

      {unmatchedReportedCount > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] leading-4 text-amber-200 sm:px-4 sm:py-3 sm:text-xs">
          {unmatchedReportedCount} reported{' '}
          {unmatchedReportedCount === 1 ? 'row is' : 'rows are'} not linked to
          an assignment from this date and therefore{' '}
          {unmatchedReportedCount === 1 ? 'is' : 'are'} excluded from the
          comparison.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <ComparisonSummaryCard
          label="Assignments"
          value={summary.assignments}
        />
        <ComparisonSummaryCard
          label="Fully Reported"
          value={summary.fullyReported}
          tone="green"
        />
        <ComparisonSummaryCard
          label="Partially Reported"
          value={summary.partiallyReported}
          tone="amber"
        />
        <ComparisonSummaryCard
          label="Not Reported"
          value={summary.notReported}
          tone="red"
        />
        <ComparisonSummaryCard
          label="Remaining Area"
          value={`${formatNumber(summary.remainingArea)} sqft`}
        />
        <ComparisonSummaryCard
          label="Remaining Hours"
          value={`${formatNumber(summary.remainingHours)} h`}
        />
      </div>

      <div className="grid gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3 sm:grid-cols-[minmax(220px,1fr)_190px_180px] sm:rounded-2xl sm:p-4">
        <input
          type="search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search flat, layer, wall or painter"
          className="h-10 min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-400 sm:text-sm"
        />

        <ComparisonFilterSelect
          ariaLabel="Filter by application"
          value={applicationFilter}
          onChange={setApplicationFilter}
          options={[
            { value: 'All', label: 'All applications' },
            ...applicationOptions.map((application) => ({
              value: application,
              label: application,
            })),
          ]}
        />

        <ComparisonFilterSelect
          ariaLabel="Filter by reporting status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'All', label: 'Status' },
            { value: 'Not Reported', label: 'Not Reported' },
            { value: 'Partially Reported', label: 'Partially Reported' },
            { value: 'Fully Reported', label: 'Fully Reported' },
            { value: 'Over Reported', label: 'Over Reported' },
          ]}
        />
      </div>

      <div className="space-y-2 md:hidden">
        {visibleRows.map((row) => (
          <AssignedVsReportedMobileCard
            key={row.key}
            row={row}
            expanded={Boolean(expandedMobileRows[row.key])}
            onToggle={() => toggleMobileDetails(row.key)}
          />
        ))}

        {!loading && visibleRows.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 text-center">
            <p className="text-sm font-semibold text-slate-300">
              No comparison rows found
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Select another date or clear the current filters.
            </p>
          </div>
        )}

        {loading && visibleRows.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 text-center text-sm text-slate-500">
            Loading assigned and reported work...
          </div>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 md:block">
        <table className="w-full min-w-[1500px] border-collapse text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="border-b border-slate-800 p-3">Date</th>
              <th className="border-b border-slate-800 p-3">Application</th>
              <th className="border-b border-slate-800 p-3">Flat</th>
              <th className="border-b border-slate-800 p-3">Layer</th>
              <th className="border-b border-slate-800 p-3">Surface</th>
              <th className="border-b border-slate-800 p-3">Assigned Area</th>
              <th className="border-b border-slate-800 p-3">Reported Area</th>
              <th className="border-b border-slate-800 p-3">Remaining Area</th>
              <th className="border-b border-slate-800 p-3">Assigned Hours</th>
              <th className="border-b border-slate-800 p-3">Reported Hours</th>
              <th className="border-b border-slate-800 p-3">Remaining Hours</th>
              <th className="border-b border-slate-800 p-3">Remaining Walls</th>
              <th className="border-b border-slate-800 p-3">Progress</th>
              <th className="border-b border-slate-800 p-3">Status</th>
            </tr>
          </thead>

          <tbody>
            {visibleRows.map((row) => (
              <tr
                key={row.key}
                className="border-b border-slate-800/80 align-top hover:bg-slate-800/40"
              >
                <td className="p-3">{shortDate(row.assignmentDate)}</td>
                <td className="p-3">{row.application || '-'}</td>
                <td className="p-3 font-mono font-semibold text-cyan-300">
                  {row.flat || '-'}
                </td>
                <td className="p-3 font-semibold text-slate-100">
                  {row.layerName || '-'}
                </td>
                <td className="p-3">
                  {row.hourBased ? '-' : row.surfaceType || '-'}
                </td>
                <td className="p-3 font-mono">
                  {row.hourBased ? '-' : formatNumber(row.assignedArea)}
                </td>
                <td className="p-3 font-mono">
                  {row.hourBased ? '-' : formatNumber(row.reportedArea)}
                </td>
                <td className="p-3 font-mono font-semibold text-amber-300">
                  {row.hourBased ? '-' : formatNumber(row.remainingArea)}
                </td>
                <td className="p-3 font-mono">
                  {formatNumber(row.assignedHours)} h
                </td>
                <td className="p-3 font-mono">
                  {formatNumber(row.reportedHours)} h
                </td>
                <td className="p-3 font-mono font-semibold text-amber-300">
                  {formatNumber(row.remainingHours)} h
                </td>
                <td className="max-w-[300px] break-words p-3 text-slate-400">
                  {row.hourBased
                    ? '-'
                    : row.remainingWalls.join(', ') || 'None'}
                </td>
                <td className="p-3">
                  <ComparisonProgress value={row.progressPct} />
                </td>
                <td className="p-3">
                  <ComparisonStatusPill status={row.status} />
                </td>
              </tr>
            ))}

            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={14} className="p-8 text-center text-sm text-slate-500">
                  No assigned-versus-reported rows found for the selected date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComparisonFilterSelect({
  ariaLabel,
  value,
  onChange,
  options,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const selectedLabel =
    options.find((option) => option.value === value)?.label ||
    options[0]?.label ||
    'Select';

  useEffect(() => {
    if (!mobileOpen || typeof document === 'undefined') return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  function chooseOption(nextValue: string) {
    onChange(nextValue);
    setMobileOpen(false);
  }

  return (
    <div className="min-w-0">
      {/* Phone/tablet: custom selector stays inside the viewport. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-left text-xs text-slate-100 outline-none transition hover:border-slate-600 focus:border-cyan-400 md:hidden"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={mobileOpen}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <span className="shrink-0 text-[10px] text-slate-500" aria-hidden="true">
          ▼
        </span>
      </button>

      {/* Desktop keeps the compact native select. */}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        className="hidden h-10 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400 md:block"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-[150] flex items-end justify-center bg-black/65 p-2 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setMobileOpen(false);
            }
          }}
        >
          <div className="max-h-[72dvh] w-[calc(100vw-1rem)] max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
              <p className="min-w-0 truncate text-sm font-bold text-slate-100">
                {ariaLabel}
              </p>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-300 hover:bg-slate-800"
                aria-label="Close filter"
              >
                ×
              </button>
            </div>

            <div className="max-h-[calc(72dvh-58px)] overflow-y-auto overscroll-contain p-2">
              {options.map((option) => {
                const selected = option.value === value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => chooseOption(option.value)}
                    className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                      selected
                        ? 'bg-cyan-500/15 font-bold text-cyan-300'
                        : 'text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <span className="min-w-0 flex-1 break-words">
                      {option.label}
                    </span>
                    {selected && (
                      <span className="shrink-0 text-cyan-300" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AssignedVsReportedMobileCard({
  row,
  expanded,
  onToggle,
}: {
  row: AssignedVsReportedRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">
                {row.application || '-'}
              </span>
              <strong className="font-mono text-sm text-cyan-300">
                {row.flat || '-'}
              </strong>
            </div>

            <p className="mt-1.5 text-xs font-semibold text-slate-100">
              {row.layerName || '-'}
            </p>
            <p className="mt-1 text-[9px] text-slate-500">
              {shortDate(row.assignmentDate)}
              {!row.hourBased && row.surfaceType
                ? ` · ${row.surfaceType}`
                : ''}
            </p>
          </div>

          <ComparisonStatusPill status={row.status} />
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
              Progress
            </span>
            <span className="font-mono text-xs font-bold text-slate-200">
              {formatNumber(row.progressPct)}%
            </span>
          </div>
          <ComparisonProgress value={row.progressPct} />
        </div>

        {!row.hourBased && (
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3">
            <AssignedWorkMetric
              label="Assigned"
              value={formatNumber(row.assignedArea)}
            />
            <AssignedWorkMetric
              label="Reported"
              value={formatNumber(row.reportedArea)}
            />
            <AssignedWorkMetric
              label="Remaining"
              value={formatNumber(row.remainingArea)}
            />
          </div>
        )}

        <div
          className={`grid grid-cols-3 gap-2 ${
            row.hourBased
              ? 'mt-3 border-t border-slate-800 pt-3'
              : 'mt-2'
          }`}
        >
          <AssignedWorkMetric
            label="Assigned Hrs"
            value={`${formatNumber(row.assignedHours)} h`}
          />
          <AssignedWorkMetric
            label="Reported Hrs"
            value={`${formatNumber(row.reportedHours)} h`}
          />
          <AssignedWorkMetric
            label="Remaining Hrs"
            value={`${formatNumber(row.remainingHours)} h`}
          />
        </div>

        <button
          type="button"
          onClick={onToggle}
          className="mt-3 flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-left"
        >
          <span className="text-[10px] font-bold text-slate-300">
            Wall and reporting details
          </span>
          <span className="text-[10px] text-slate-500">
            {expanded ? 'Hide' : 'Show'}
          </span>
        </button>

        {expanded && (
          <div className="mt-2 space-y-2 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
            {!row.hourBased && (
              <>
                <ComparisonWallList
                  label="Assigned Walls"
                  walls={row.assignedWalls}
                />
                <ComparisonWallList
                  label="Reported Walls"
                  walls={row.reportedWalls}
                />
                <ComparisonWallList
                  label="Remaining Walls"
                  walls={row.remainingWalls}
                  tone="amber"
                />
              </>
            )}

            <ComparisonWallList
              label="Painters"
              walls={row.painters}
            />

            <div className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-2">
              <AssignedWorkMetric
                label="Report Rows"
                value={String(row.reportCount)}
              />
              <AssignedWorkMetric
                label="Mode"
                value={row.hourBased ? '-' : row.machineOrManual || '-'}
              />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function ComparisonSummaryCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'green' | 'amber' | 'red';
}) {
  const valueClass =
    tone === 'green'
      ? 'text-emerald-300'
      : tone === 'amber'
        ? 'text-amber-300'
        : tone === 'red'
          ? 'text-red-300'
          : 'text-slate-100';

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 font-mono text-base font-bold ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

function ComparisonProgress({ value }: { value: number }) {
  const pct = Number(value || 0);
  const cappedPct = Math.min(100, Math.max(0, pct));
  const barClass =
    pct >= 100
      ? 'bg-emerald-400'
      : pct > 0
        ? 'bg-amber-400'
        : 'bg-red-400';

  return (
    <div className="min-w-[90px]">
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full ${barClass}`}
          style={{ width: `${cappedPct}%` }}
        />
      </div>
      <p className="mt-1 font-mono text-[9px] text-slate-500">
        {formatNumber(pct)}%
      </p>
    </div>
  );
}

function ComparisonStatusPill({
  status,
}: {
  status: AssignedVsReportedStatus;
}) {
  const className =
    status === 'Fully Reported'
      ? 'bg-emerald-500/15 text-emerald-300'
      : status === 'Partially Reported'
        ? 'bg-amber-500/15 text-amber-300'
        : status === 'Over Reported'
          ? 'bg-blue-500/15 text-blue-300'
          : 'bg-red-500/15 text-red-300';

  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-1 text-[9px] font-bold ${className}`}
    >
      {status}
    </span>
  );
}

function ComparisonWallList({
  label,
  walls,
  tone = 'default',
}: {
  label: string;
  walls: string[];
  tone?: 'default' | 'amber';
}) {
  return (
    <div>
      <p className="text-[8px] font-bold uppercase tracking-wide text-slate-600">
        {label}
      </p>
      <p
        className={`mt-1 break-words text-[10px] leading-4 ${
          tone === 'amber' ? 'text-amber-300' : 'text-slate-400'
        }`}
      >
        {walls.length > 0 ? walls.join(', ') : 'None'}
      </p>
    </div>
  );
}

function uniqueNormalizedList(values: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();

  values.forEach((value) => {
    const cleanValue = String(value || '').trim();
    const key = norm(cleanValue);

    if (!cleanValue || !key || seen.has(key)) return;

    seen.add(key);
    result.push(cleanValue);
  });

  return result;
}


function LayerProgressPage({
  rows,
  token,
  projectId,
  onError,
}: {
  rows: AssignmentLayerProgressRow[];
  token: string;
  projectId: string;
  onError: (message: string) => void;
}) {
  const [selectedApplication, setSelectedApplication] = useState<string>('All');
  const [selectedFlat, setSelectedFlat] = useState<string>('');
  const [expandedApps, setExpandedApps] = useState<Record<string, boolean>>({});
  const [expandedMobileFlats, setExpandedMobileFlats] = useState<Record<string, boolean>>({});
  const [searchText, setSearchText] = useState('');
  const [selectedRowKey, setSelectedRowKey] = useState('');
  const [detailRows, setDetailRows] = useState<LayerProgressDetailRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const search = norm(searchText);

  const searchedRows = useMemo(() => {
    if (!search) return rows;

    return rows.filter((row) => {
      return (
        norm(row.application).includes(search) ||
        norm(row.flat).includes(search) ||
        norm(row.layer_name).includes(search) ||
        norm(row.block).includes(search)
      );
    });
  }, [rows, search]);

  const mobileApplications = useMemo(() => {
    return Array.from(
      new Set(rows.map((row) => row.application).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const applications = useMemo(() => {
    return Array.from(
      new Set(searchedRows.map((row) => row.application).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));
  }, [searchedRows]);

  const flatsByApplication = useMemo(() => {
    const map = new Map<string, string[]>();

    searchedRows.forEach((row) => {
      if (!map.has(row.application)) {
        map.set(row.application, []);
      }

      const flats = map.get(row.application)!;

      if (!flats.includes(row.flat)) {
        flats.push(row.flat);
      }
    });

    map.forEach((flats) => {
      flats.sort((a, b) => flatSortValue(a) - flatSortValue(b) || a.localeCompare(b));
    });

    return map;
  }, [searchedRows]);

  const filteredRows = useMemo(() => {
    return searchedRows
      .filter((row) => {
        if (selectedApplication !== 'All' && row.application !== selectedApplication) {
          return false;
        }

        if (selectedFlat && row.flat !== selectedFlat) {
          return false;
        }

        return true;
      })
      .sort(compareLayerProgressRows);
  }, [searchedRows, selectedApplication, selectedFlat]);

  const grouped = useMemo(() => {
    const map = new Map<string, AssignmentLayerProgressRow[]>();

    filteredRows.forEach((row) => {
      const key = `${row.application}|${row.flat}`;

      if (!map.has(key)) {
        map.set(key, []);
      }

      map.get(key)!.push(row);
    });

    return Array.from(map.entries())
      .map(([key, layerRows]) => {
        const [application, flat] = key.split('|');

        return {
          key,
          application,
          flat,
          rows: layerRows,
        };
      })
      .sort(
        (a, b) =>
          a.application.localeCompare(b.application) ||
          flatSortValue(a.flat) - flatSortValue(b.flat) ||
          a.flat.localeCompare(b.flat),
      );
  }, [filteredRows]);

  useEffect(() => {
    if (grouped.length === 0) {
      setExpandedMobileFlats({});
      return;
    }

    setExpandedMobileFlats((current) => {
      const hasVisibleExpandedFlat = grouped.some((group) => current[group.key]);

      if (hasVisibleExpandedFlat) return current;

      return {
        ...current,
        [grouped[0].key]: true,
      };
    });
  }, [grouped]);

  function selectAll() {
    setSelectedApplication('All');
    setSelectedFlat('');
    setSelectedRowKey('');
    setDetailRows([]);
  }

  function selectApplication(application: string) {
    setSelectedApplication(application);
    setSelectedFlat('');
    setSelectedRowKey('');
    setDetailRows([]);
  }

  function selectFlat(application: string, flat: string) {
    setSelectedApplication(application);
    setSelectedFlat(flat);
    setSelectedRowKey('');
    setDetailRows([]);
  }

  function toggleApp(application: string) {
    setExpandedApps((current) => ({
      ...current,
      [application]: !current[application],
    }));
  }

  function toggleMobileFlat(groupKey: string) {
    setExpandedMobileFlats((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  }

  async function openLayerDetails(row: AssignmentLayerProgressRow) {
    const rowKey = `${row.application}|${row.flat}|${row.layer_id}`;

    if (selectedRowKey === rowKey) {
      setSelectedRowKey('');
      setDetailRows([]);
      return;
    }

    setSelectedRowKey(rowKey);
    setDetailLoading(true);
    setDetailRows([]);

    try {
      const details = await fetchLayerProgressDetailsLocal(token, projectId, row);
      setDetailRows(details);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeading
        title="Layer Progress"
        subtitle=""
      />

      {/* Phone-only search and application selector. */}
      <div className="space-y-3 md:hidden">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Search Flat or Layer
          </label>

          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 focus-within:border-cyan-400">
            <span aria-hidden="true" className="text-sm text-slate-500">
              ⌕
            </span>
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Flat, layer or block"
              className="h-10 min-w-0 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
            />
            {searchText && (
              <button
                type="button"
                onClick={() => setSearchText('')}
                aria-label="Clear search"
                className="grid h-7 w-7 place-items-center rounded-md text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                ×
              </button>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-slate-500">
            <span>{grouped.length} flats</span>
            <span>{filteredRows.length} layer rows</span>
          </div>
        </div>

        <div className="-mx-3 overflow-x-auto px-3 pb-1">
          <div className="flex min-w-max gap-2">
            <button
              type="button"
              onClick={selectAll}
              className={`h-9 rounded-lg border px-3 text-xs font-bold transition ${
                selectedApplication === 'All'
                  ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-300'
                  : 'border-slate-700 bg-slate-900 text-slate-400'
              }`}
            >
              All
            </button>

            {mobileApplications.map((application) => (
              <button
                key={application}
                type="button"
                onClick={() => selectApplication(application)}
                className={`h-9 rounded-lg border px-3 text-xs font-bold transition ${
                  selectedApplication === application
                    ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-300'
                    : 'border-slate-700 bg-slate-900 text-slate-400'
                }`}
              >
                {application}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {grouped.map((group, groupIndex) => {
            const isExpanded = Boolean(expandedMobileFlats[group.key]);
            const completedLayers = group.rows.filter(
              (row) => Number(row.wkdpct || 0) >= 100,
            ).length;
            const averageProgress =
              group.rows.length > 0
                ? group.rows.reduce(
                    (sum, row) => sum + Number(row.wkdpct || 0),
                    0,
                  ) / group.rows.length
                : 0;

            return (
              <article
                key={group.key}
                className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900"
              >
                <button
                  type="button"
                  onClick={() => toggleMobileFlat(group.key)}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left"
                >
                  <span className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-slate-800 font-mono text-[10px] font-bold text-amber-400">
                    {String(groupIndex + 1).padStart(2, '0')}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="font-mono text-sm text-cyan-300">
                        {group.flat}
                      </strong>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400">
                        {group.application}
                      </span>
                    </span>

                    <span className="mt-1 block text-[10px] text-slate-500">
                      {group.rows.length} layers · {completedLayers} completed
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-xs font-bold text-slate-100">
                      {formatNumber(averageProgress)}%
                    </span>
                    <span className="mt-1 block text-[10px] text-slate-500">
                      {isExpanded ? '⌃' : '⌄'}
                    </span>
                  </span>
                </button>

                <div className="h-1 bg-slate-800">
                  <div
                    className={`h-full transition-all ${
                      averageProgress >= 100
                        ? 'bg-emerald-400'
                        : averageProgress > 0
                          ? 'bg-amber-400'
                          : 'bg-red-400'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(0, averageProgress))}%`,
                    }}
                  />
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-800 px-3 py-2">
                    {group.rows.map((row) => {
                      const rowKey = `${row.application}|${row.flat}|${row.layer_id}`;
                      const isOpen = selectedRowKey === rowKey;
                      const pct = Number(row.wkdpct || 0);

                      return (
                        <div
                          key={row.layer_id}
                          className="border-b border-slate-800 py-2.5 last:border-b-0"
                        >
                          <button
                            type="button"
                            onClick={() => openLayerDetails(row)}
                            className="w-full text-left"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-slate-100">
                                  {row.layer_name}
                                </p>
                                <p className="mt-1 truncate text-[10px] text-slate-500">
                                  {[row.block, `Order ${row.layer_order || '-'}`]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </p>
                              </div>

                              <WkdPctBadge value={row.wkdpct} />
                            </div>

                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className={`h-full rounded-full ${
                                  pct >= 100
                                    ? 'bg-emerald-400'
                                    : pct > 0
                                      ? 'bg-amber-400'
                                      : 'bg-red-400'
                                }`}
                                style={{
                                  width: `${Math.min(100, Math.max(0, pct))}%`,
                                }}
                              />
                            </div>
                          </button>

                          {isOpen && (
                            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                              <LayerProgressDetailPanel
                                loading={detailLoading}
                                rows={detailRows}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}

          {grouped.length === 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-8 text-center">
              <p className="text-sm font-semibold text-slate-300">
                No layer progress found
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Try another application or search term.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Existing tablet and desktop controls remain unchanged. */}
      <div className="hidden rounded-2xl border border-slate-800 bg-slate-900 p-4 md:block">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
          Search Application / Flat / Layer
        </label>
        <input
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search example: FLAT-A, FA-0418, Touchup Putty"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-400"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Showing {filteredRows.length} of {rows.length} layer rows
        </p>
      </div>

      <div className="hidden grid-cols-1 gap-4 md:grid xl:grid-cols-[300px_1fr]">
        <aside className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <button
            type="button"
            onClick={selectAll}
            className={`mb-2 flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-bold ${
              selectedApplication === 'All'
                ? 'bg-slate-700 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            All
          </button>

          <div className="max-h-[72vh] overflow-auto pr-1">
            {applications.map((application) => {
              const isSelected = selectedApplication === application && !selectedFlat;
              const flats = flatsByApplication.get(application) || [];
              const isExpanded = Boolean(expandedApps[application]);

              return (
                <div key={application} className="mb-1">
                  <div
                    className={`flex items-center rounded-xl ${
                      isSelected ? 'bg-slate-700 text-white' : 'text-slate-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleApp(application)}
                      className="px-2 py-2 text-xs text-slate-400 hover:text-white"
                      title="Expand flats"
                    >
                      {isExpanded ? '▾' : '▸'}
                    </button>

                    <button
                      type="button"
                      onClick={() => selectApplication(application)}
                      className="flex-1 px-2 py-2 text-left text-sm font-semibold hover:text-white"
                    >
                      {application}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="ml-8 mt-1 space-y-1">
                      {flats.map((flat) => (
                        <button
                          key={`${application}-${flat}`}
                          type="button"
                          onClick={() => selectFlat(application, flat)}
                          className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm ${
                            selectedApplication === application && selectedFlat === flat
                              ? 'bg-cyan-500/15 text-cyan-300'
                              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {flat}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <main className="rounded-2xl border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 px-4 py-3">
            <div className="text-sm font-bold text-slate-200">
              {selectedApplication === 'All'
                ? 'All Applications'
                : selectedFlat
                  ? `${selectedApplication} / ${selectedFlat}`
                  : selectedApplication}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {filteredRows.length} layer rows
            </div>
          </div>

          <div className="max-h-[72vh] overflow-auto">
            <table className="w-full min-w-[850px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="border-b border-slate-800 px-4 py-3">Block</th>
                  <th className="border-b border-slate-800 px-4 py-3">Application</th>
                  <th className="border-b border-slate-800 px-4 py-3">Flat</th>
                  <th className="border-b border-slate-800 px-4 py-3">Layer</th>
                  <th className="border-b border-slate-800 px-4 py-3">WkdPct</th>
                </tr>
              </thead>

              <tbody>
                {grouped.map((group) => (
                  <Fragment key={group.key}>
                    <tr className="bg-slate-950/70">
                      <td
                        colSpan={5}
                        className="border-b border-slate-800 px-4 py-2 text-sm font-bold text-cyan-300"
                      >
                        {group.flat}
                      </td>
                    </tr>

                    {group.rows.map((row) => {
                      const rowKey = `${row.application}|${row.flat}|${row.layer_id}`;
                      const isOpen = selectedRowKey === rowKey;

                      return (
                        <Fragment key={row.layer_id}>
                          <tr
                            onClick={() => openLayerDetails(row)}
                            className={`cursor-pointer border-b border-slate-800/80 hover:bg-slate-800/60 ${
                              isOpen ? 'bg-slate-800/50' : ''
                            }`}
                          >
                            <td className="px-4 py-3">{row.block || '-'}</td>
                            <td className="px-4 py-3">{row.application}</td>
                            <td className="px-4 py-3 font-mono text-cyan-400">
                              {row.flat}
                            </td>
                            <td className="px-4 py-3 font-semibold">{row.layer_name}</td>
                            <td className="px-4 py-3">
                              <WkdPctBadge value={row.wkdpct} />
                            </td>
                          </tr>

                          {isOpen && (
                            <tr>
                              <td colSpan={5} className="border-b border-slate-800 bg-slate-950/70 p-4">
                                <LayerProgressDetailPanel
                                  loading={detailLoading}
                                  rows={detailRows}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}

                {grouped.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-sm text-slate-500">
                      No layer rows found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}

function LayerProgressDetailPanel({
  loading,
  rows,
}: {
  loading: boolean;
  rows: LayerProgressDetailRow[];
}) {
  if (loading) {
    return <div className="text-sm text-slate-500">Loading layer details...</div>;
  }

  if (rows.length === 0) {
    return <div className="text-sm text-slate-500">Nothing reported and no rollover rows for this flat-layer.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-bold text-slate-200">
        Backend reported work + rollover rows
      </div>

      {/* Phone detail cards avoid horizontal scrolling. */}
      <div className="space-y-2 md:hidden">
        {rows.map((row) => {
          const hourBased = isHourBasedLayerName(row.layer);

          return (
            <article
              key={`${row.source_type}-${row.id}`}
              className="rounded-lg border border-slate-800 bg-slate-900 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-100">
                    {row.layer}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-slate-500">
                    {shortDate(row.date)} · {row.id}
                  </p>
                </div>

                {row.source_type === 'Rollover' ? (
                  <StatusPill tone="amber">Rollover</StatusPill>
                ) : (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[9px] font-bold text-emerald-300">
                    {row.work_status || row.assignment || 'Reported'}
                  </span>
                )}
              </div>

              {!hourBased && (
                <p className="mt-2 break-words text-[10px] leading-4 text-slate-400">
                  {row.walls || 'Walls not mapped'}
                </p>
              )}

              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3">
                <div>
                  <p className="text-[8px] uppercase tracking-wide text-slate-600">Area</p>
                  <p className="mt-0.5 font-mono text-[10px] font-semibold text-slate-200">
                    {hourBased ? '-' : formatNumber(row.area)}
                  </p>
                </div>
                <div>
                  <p className="text-[8px] uppercase tracking-wide text-slate-600">Hours</p>
                  <p className="mt-0.5 font-mono text-[10px] font-semibold text-slate-200">
                    {row.hours == null ? '-' : formatNumber(row.hours)}
                  </p>
                </div>
                <div>
                  <p className="text-[8px] uppercase tracking-wide text-slate-600">Painters</p>
                  <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-200">
                    {row.painters || '-'}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 md:block">
        <table className="w-full min-w-[1050px] border-collapse text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="border-b border-slate-800 p-3">ID</th>
              <th className="border-b border-slate-800 p-3">Date</th>
              <th className="border-b border-slate-800 p-3">Application</th>
              <th className="border-b border-slate-800 p-3">Flat</th>
              <th className="border-b border-slate-800 p-3">Layer</th>
              <th className="border-b border-slate-800 p-3">Walls</th>
              <th className="border-b border-slate-800 p-3">Area</th>
              <th className="border-b border-slate-800 p-3">Painters</th>
              <th className="border-b border-slate-800 p-3">Hours</th>
              <th className="border-b border-slate-800 p-3">Work Status</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const hourBased = isHourBasedLayerName(row.layer);

              return (
                <tr key={`${row.source_type}-${row.id}`} className="border-b border-slate-800/80">
                  <td className="p-3 font-mono text-xs text-cyan-300">{row.id}</td>
                  <td className="p-3">{shortDate(row.date)}</td>
                  <td className="p-3">{row.application}</td>
                  <td className="p-3">{row.flat}</td>
                  <td className="p-3">{row.layer}</td>
                  <td className="p-3">{hourBased ? '-' : row.walls || '-'}</td>
                  <td className="p-3 font-mono">{hourBased ? '-' : formatNumber(row.area)}</td>
                  <td className="p-3">{row.painters || '-'}</td>
                  <td className="p-3 font-mono">{row.hours == null ? '-' : formatNumber(row.hours)}</td>
                  <td className="p-3">
                    {row.source_type === 'Rollover' ? (
                      <StatusPill tone="amber">Rollover</StatusPill>
                    ) : (
                      row.work_status || row.assignment || '-'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function WkdPctBadge({ value }: { value: number }) {
  const pct = Number(value || 0);
  const tone =
    pct >= 100
      ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
      : pct > 0
        ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
        : 'text-red-300 bg-red-500/10 border-red-500/30';

  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${tone}`}>
      {formatNumber(pct)}%
    </span>
  );
}

function flatSortValue(flat: string) {
  const digits = String(flat || '').replace(/\D/g, '');
  const number = Number(digits);

  return Number.isFinite(number) ? number : 999999;
}

function compareLayerProgressRows(
  a: AssignmentLayerProgressRow,
  b: AssignmentLayerProgressRow,
) {
  return (
    a.application.localeCompare(b.application) ||
    Number(a.flat_sort || 999999) - Number(b.flat_sort || 999999) ||
    a.flat.localeCompare(b.flat) ||
    Number(a.no_order_flag || 0) - Number(b.no_order_flag || 0) ||
    Number(a.layer_order || 999) - Number(b.layer_order || 999) ||
    a.layer_name.localeCompare(b.layer_name)
  );
}


function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="font-display text-2xl font-bold">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-3 font-display text-2xl font-bold">{value}</p>
      {sub && <p className="mt-2 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function CapacityUsageBar({
  label,
  available,
  assigned,
  balance,
  usedPct,
  barPct,
}: {
  label: string;
  available: number;
  assigned: number;
  balance: number;
  usedPct: number;
  barPct: number;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-[auto_minmax(180px,1fr)] md:items-center">
      <div className="flex shrink-0 items-center gap-5 [&_p:first-child]:text-[10px] [&_p:first-child]:font-semibold [&_p:first-child]:uppercase [&_p:first-child]:tracking-wide [&_p:first-child]:text-slate-500 [&_p:last-child]:mt-0.5 [&_p:last-child]:text-lg [&_p:last-child]:after:ml-1 [&_p:last-child]:after:text-xs [&_p:last-child]:after:font-semibold [&_p:last-child]:after:content-['h']">
        <CapacityNumber label={`${label} available`} value={available} />
        <CapacityNumber label="Assigned" value={assigned} />
        <CapacityNumber
          label="Balance"
          value={balance}
          tone={balance < 0 ? 'red' : 'green'}
        />
      </div>

      <div className="min-w-[180px]">
        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full transition-all ${
              balance < 0
                ? 'bg-red-500'
                : 'bg-gradient-to-r from-emerald-400 to-amber-400'
            }`}
            style={{ width: `${barPct}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {formatNumber(usedPct)}% capacity used
        </p>
      </div>
    </div>
  );
}

function CapacityNumber({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'red' | 'green';
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-slate-200">{label}</p>
      <p
        className={`font-display text-2xl font-bold ${
          tone === 'red'
            ? 'text-red-400'
            : tone === 'green'
              ? 'text-emerald-400'
              : 'text-white'
        }`}
      >
        {formatNumber(value)}
      </p>
    </div>
  );
}

function Alert({
  tone,
  children,
}: {
  tone: 'red' | 'green';
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 text-sm ${
        tone === 'red'
          ? 'border-red-500/40 bg-red-500/10 text-red-200'
          : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
      }`}
    >
      {children}
    </div>
  );
}

function SectionPill({ section }: { section: string }) {
  const color = SECTION_COLORS[section] || 'bg-slate-400';

  return (
    <span className="inline-flex items-center gap-2 text-xs font-bold">
      <span className={`h-2 w-2 rounded-sm ${color}`} />
      {section}
    </span>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: 'green' | 'amber' | 'red';
  children: ReactNode;
}) {
  const cls =
    tone === 'green'
      ? 'bg-emerald-500/20 text-emerald-300'
      : tone === 'amber'
        ? 'bg-amber-500/20 text-amber-300'
        : 'bg-red-500/20 text-red-300';

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>
      {children}
    </span>
  );
}

function SimpleTable({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: Array<Array<ReactNode>>;
  empty: string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column} className="border-b border-slate-800 p-3">
                {column}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-slate-800/80">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="p-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}

          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="p-6 text-sm text-slate-500">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  disabled = false,
  helperText,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<string | { value: string; label: string }>;
  disabled?: boolean;
  helperText?: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const normalizedOptions = useMemo(
    () =>
      options
        .filter(Boolean)
        .map((option) =>
          typeof option === 'string'
            ? { value: option, label: option }
            : option,
        ),
    [options],
  );

  const selectedLabel =
    normalizedOptions.find((option) => option.value === value)?.label ||
    `Select ${label}`;

  useEffect(() => {
    if (!mobileOpen || typeof document === 'undefined') return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  function chooseMobileOption(nextValue: string) {
    onChange(nextValue);
    setMobileOpen(false);
  }

  return (
    <div className="min-w-0">
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </label>

      {/* Phone: do not use the browser-native select popup. It ignores the
          form width and can extend outside the emulated phone viewport. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setMobileOpen(true);
        }}
        className={`flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-left text-xs text-slate-100 outline-none transition focus:border-amber-400 md:hidden ${
          disabled ? 'cursor-not-allowed opacity-60' : ''
        }`}
        aria-haspopup="dialog"
        aria-expanded={mobileOpen}
      >
        <span className={`truncate ${value ? '' : 'text-slate-500'}`}>
          {selectedLabel}
        </span>
        <span className="shrink-0 text-[10px] text-slate-500" aria-hidden="true">
          ▼
        </span>
      </button>

      {/* Desktop keeps the existing native select and existing behaviour. */}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`hidden w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-amber-400 md:block ${
          disabled ? 'cursor-not-allowed opacity-60' : ''
        }`}
      >
        <option value="">Select {label}</option>
        {normalizedOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {helperText && (
        <p className="mt-1 text-[10px] text-slate-500 md:text-[11px]">
          {helperText}
        </p>
      )}

      {mobileOpen && !disabled && (
        <div
          className="fixed inset-0 z-[150] flex items-end bg-black/70 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={`Select ${label}`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setMobileOpen(false);
            }
          }}
        >
          <div className="max-h-[72dvh] w-full overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-950 shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-800 px-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Select
                </p>
                <h4 className="truncate text-sm font-bold text-slate-100">
                  {label}
                </h4>
              </div>

              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-lg text-slate-300"
                aria-label={`Close ${label} options`}
              >
                ×
              </button>
            </div>

            <div className="max-h-[calc(72dvh-3.5rem)] overflow-y-auto overscroll-contain p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => chooseMobileOption('')}
                className={`flex h-10 w-full items-center rounded-lg px-3 text-left text-xs font-semibold transition ${
                  !value
                    ? 'bg-cyan-400 text-slate-950'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                Select {label}
              </button>

              {normalizedOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => chooseMobileOption(option.value)}
                  className={`mt-1 flex h-10 w-full items-center rounded-lg px-3 text-left text-xs font-semibold transition ${
                    value === option.value
                      ? 'bg-cyan-400 text-slate-950'
                      : 'text-slate-100 hover:bg-slate-800'
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CompactPainterDropdown({
  items,
  selected,
  onChange,
  disabled = false,
}: {
  items: string[];
  selected: string[];
  onChange: (items: string[]) => void;
  disabled?: boolean;
}) {
  const [searchText, setSearchText] = useState('');
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const uniqueItems = useMemo(
    () =>
      Array.from(new Set(items.filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    [items],
  );

  const visibleItems = useMemo(() => {
    const query = norm(searchText);

    if (!query) return uniqueItems;

    return uniqueItems.filter((item) => norm(item).includes(query));
  }, [searchText, uniqueItems]);

  function closeDropdown() {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
    setSearchText('');
  }

  function toggle(item: string) {
    const nextItems = selected.includes(item)
      ? selected.filter((current) => current !== item)
      : [...selected, item];

    // Keep the dropdown open while the PM selects/deselects multiple painters.
    // It will close only when the user clicks outside or closes the <details>
    // summary manually.
    onChange(nextItems);
  }

  useEffect(() => {
    function handleOutsidePointer(event: MouseEvent | TouchEvent) {
      const details = detailsRef.current;

      if (!details?.open) return;

      const target = event.target;

      if (target instanceof Node && !details.contains(target)) {
        closeDropdown();
      }
    }

    document.addEventListener('mousedown', handleOutsidePointer);
    document.addEventListener('touchstart', handleOutsidePointer);

    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer);
      document.removeEventListener('touchstart', handleOutsidePointer);
    };
  }, []);

  useEffect(() => {
  const details = detailsRef.current;

  if (!details) return;

  function handleDetailsToggle() {
    if (!detailsRef.current?.open) {
      setSearchText('');
    }
  }

  details.addEventListener('toggle', handleDetailsToggle);

  return () => {
    details.removeEventListener('toggle', handleDetailsToggle);
  };
}, []);

  return (
    <details
      ref={detailsRef}
      className={`rounded-lg border border-slate-700 bg-slate-950 ${
        disabled ? 'pointer-events-none opacity-60' : ''
      }`}
    >
      <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 text-[10px] font-semibold text-slate-200 md:text-xs">
        <span
          className="min-w-0 flex-1 truncate"
          title={selected.length > 0 ? selected.join(', ') : undefined}
        >
          {selected.length === 0 ? 'Select painters' : selected.join(', ')}
        </span>
        <span className="shrink-0 text-slate-500">▼</span>
      </summary>

      <div className="border-t border-slate-800 p-2">
        <input
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search painter"
          className="mb-2 h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-[10px] text-slate-100 outline-none focus:border-amber-400 md:text-xs"
        />

        <div className="max-h-36 space-y-1 overflow-auto">
          {visibleItems.map((item) => (
            <label
              key={item}
              className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-[10px] text-slate-200 hover:bg-slate-800 md:text-xs"
            >
              <input
                type="checkbox"
                checked={selected.includes(item)}
                onChange={() => toggle(item)}
                className="mt-0.5"
              />
              <span className="break-words">{item}</span>
            </label>
          ))}

          {visibleItems.length === 0 && (
            <p className="px-1 py-2 text-[10px] text-slate-500">
              No matching painters
            </p>
          )}
        </div>

        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onChange([]);
              closeDropdown();
            }}
            className="mt-2 text-[10px] font-bold text-cyan-300 hover:text-cyan-200"
          >
            Clear painters
          </button>
        )}
      </div>
    </details>
  );
}


function MultiPicker({
  title,
  items,
  selected,
  onChange,
  showSelectAll = false,
  showClearAll = false,
  showSearch = false,
  searchPlaceholder = 'Search...',
  mobileCompact = false,
  mobileListHeight = 'default',
  showSelectedCount = false,
}: {
  title: string;
  items: string[];
  selected: string[];
  onChange: (items: string[]) => void;
  showSelectAll?: boolean;
  showClearAll?: boolean;
  showSearch?: boolean;
  searchPlaceholder?: string;
  mobileCompact?: boolean;
  mobileListHeight?: 'default' | 'walls' | 'painters';
  showSelectedCount?: boolean;
}) {
  const [searchText, setSearchText] = useState('');

  const uniqueItems = useMemo(
    () => Array.from(new Set(items.filter(Boolean))),
    [items],
  );

  const visibleItems = useMemo(() => {
    const query = norm(searchText);

    if (!query) return uniqueItems;

    // Match the AppSheet-style behavior requested:
    // typing "C" shows only wall names STARTING with C.
    return uniqueItems.filter((item) => norm(item).startsWith(query));
  }, [searchText, uniqueItems]);

  function toggle(item: string) {
    onChange(
      selected.includes(item)
        ? selected.filter((current) => current !== item)
        : [...selected, item],
    );
  }

  function selectAllVisible() {
    // Select only what is currently displayed by the search filter.
    // Keep already selected values from outside the current search.
    onChange(Array.from(new Set([...selected, ...visibleItems])));
  }

  function clearAll() {
    onChange([]);
  }

  const mobileHeightClass =
    mobileListHeight === 'walls'
      ? 'max-h-36 md:max-h-56'
      : mobileListHeight === 'painters'
        ? 'max-h-24 md:max-h-56'
        : 'max-h-56';

  return (
    <div
      className={`rounded-xl border border-slate-800 bg-slate-950 ${
        mobileCompact ? 'p-2.5 md:p-3' : 'p-3'
      }`}
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-2 ${
          mobileCompact ? 'mb-1.5 md:mb-2' : 'mb-2'
        }`}
      >
        <p
          className={`font-bold uppercase tracking-wide text-slate-500 ${
            mobileCompact ? 'text-[9px] md:text-xs' : 'text-xs'
          }`}
        >
          {title}
          {showSelectedCount && (
            <span className="ml-1">
              ({selected.length} selected)
            </span>
          )}
        </p>

        <div className="flex flex-wrap gap-2">
          {showSelectAll && visibleItems.length > 0 && (
            <button
              type="button"
              onClick={selectAllVisible}
              className={`rounded-md border border-slate-700 px-2 py-1 font-bold text-slate-300 hover:bg-slate-800 ${
                mobileCompact
                  ? 'hidden text-[9px] md:inline-flex md:text-[11px]'
                  : 'text-[11px]'
              }`}
            >
              Select All Displayed
            </button>
          )}

          {showClearAll && selected.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className={`rounded-md border border-slate-700 px-2 py-1 font-bold text-slate-300 hover:bg-slate-800 ${
                mobileCompact ? 'text-[9px] md:text-[11px]' : 'text-[11px]'
              }`}
            >
              <span className="md:hidden">
                {mobileCompact ? 'Clear' : 'Clear All'}
              </span>
              <span className="hidden md:inline">Clear All</span>
            </button>
          )}
        </div>
      </div>

      {showSearch && (
        <div className={mobileCompact ? 'mb-2 md:mb-3' : 'mb-3'}>
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={searchPlaceholder}
            className={`w-full rounded-lg border border-slate-700 bg-slate-900 text-slate-100 outline-none focus:border-amber-400 ${
              mobileCompact
                ? 'h-8 px-2.5 text-[10px] md:h-auto md:px-3 md:py-2 md:text-sm'
                : 'px-3 py-2 text-sm'
            }`}
          />
          <p
            className={`mt-1 text-[11px] text-slate-500 ${
              mobileCompact ? 'hidden md:block' : ''
            }`}
          >
            Showing {visibleItems.length} of {uniqueItems.length} options
          </p>
        </div>
      )}

      <div className={`${mobileHeightClass} space-y-1 overflow-auto`}>
        {visibleItems.map((item) => (
          <label
            key={item}
            className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-slate-800 ${
              mobileCompact ? 'py-1 text-[10px] md:py-1.5 md:text-sm' : 'py-1.5 text-sm'
            }`}
          >
            <input
              type="checkbox"
              checked={selected.includes(item)}
              onChange={() => toggle(item)}
            />
            {item}
          </label>
        ))}

        {visibleItems.length === 0 && (
          <p className="text-xs text-slate-500">No matching options</p>
        )}
      </div>
    </div>
  );
}


function painterDisplay(painter: AssignmentPainter) {
  const display = String((painter as any).painter_display || '').trim();

  if (display) return display;

  const name = String((painter as any).painter_name || '').trim();
  const id = String((painter as any).painter_id || '').trim();

  if (!name && !id) return '';

  return id ? `${name}(${id})` : name;
}

function tabButton(active: boolean) {
  return `shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold ${
    active
      ? 'bg-slate-700 text-white'
      : 'border border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800'
  }`;
}

function normalizeSectionRows(rows: AssignmentDemandRow[], section: string) {
  return rows.map((row) => ({
    ...row,
    section: row.section || section,
  }));
}

function groupDemandRows(
  rows: Array<AssignmentDemandRow | WorkDemandItem>,
  demandWalls: WorkDemandWallSnapshot[] = [],
) {
  const map = new Map<string, GroupedDemandRow>();
  const wallsByDemandId = buildDemandWallSnapshotMap(demandWalls);

  rows.forEach((row: any) => {
    const section = row.section || '';
    const block = row.block || null;
    const application = row.application || '';
    const flat = row.flat || '';
    const layerId = row.layer_id || '';
    const layerName = row.layer_name || '';
    const surfaceType = row.surface_type || null;

    const key = [
      section,
      block || '',
      application,
      flat,
      layerId,
      layerName,
      surfaceType || '',
    ].join('|');

    const hourBased =
      Boolean(row.is_hour_based) || isHourBasedLayerName(layerName);

    const snapshotWalls = !hourBased && row.demand_id
      ? wallsByDemandId.get(row.demand_id) || []
      : [];

    const wallNames = hourBased
      ? []
      : snapshotWalls.length > 0
        ? snapshotWalls.map((wall) => wall.wall_name).filter(Boolean)
        : row.wall_names
          ? splitList(row.wall_names)
          : row.wall_name
            ? [row.wall_name]
            : [];

    const productivity = hourBased ? 1 : Number(row.productivity_per_hour || 0);
    const wallDetails = hourBased
      ? []
      : snapshotWalls.length > 0
        ? buildWallDetailsFromSnapshots(snapshotWalls, productivity)
        : buildWallDetails(
            wallNames,
            row,
            Number(row.remaining_area || row.wall_area || 0),
            Number(row.required_hours || 0),
            productivity,
          );

    const area = Number(
      hourBased
        ? row.remaining_hours ?? row.required_hours ?? row.remaining_area ?? 0
        : wallDetails.length > 0
          ? wallDetails.reduce((sum, wall) => sum + Number(wall.area || 0), 0)
          : row.remaining_area || row.wall_area || 0,
    );
    const requiredHours = Number(
      hourBased
        ? row.required_hours ?? row.remaining_hours ?? area
        : wallDetails.length > 0
          ? wallDetails.reduce((sum, wall) => sum + Number(wall.hours || 0), 0)
          : row.required_hours || (productivity > 0 ? area / productivity : 0),
    );

    const normalizedWallDetails = hourBased
      ? [
          {
            wall_name: '__HOUR_BASED__',
            area,
            hours: requiredHours,
          },
        ]
      : wallDetails;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        key,
        demand_id: row.demand_id,
        source_id: row.source_id,
        section,
        priority_rank: Number(row.priority_rank || 999),
        block,
        application,
        flat,
        layer_id: layerId,
        layer_name: layerName,
        surface_type: surfaceType,
        wall_names: wallNames,
        wall_details: normalizedWallDetails,
        remaining_area: area,
        machine_or_manual: row.machine_or_manual ?? defaultWorkModeForLayer(layerName),
        productivity_per_hour: productivity,
        required_hours: requiredHours,
        oldest_date: row.oldest_date || null,
        is_hour_based: hourBased,
        total_hours: row.total_hours ?? null,
        reported_hours: row.reported_hours ?? null,
        remaining_hours: row.remaining_hours ?? (hourBased ? area : null),
      });
      return;
    }

    existing.wall_names = Array.from(
      new Set([...existing.wall_names, ...wallNames]),
    );
    existing.wall_details = mergeWallDetails(
      existing.wall_details,
      normalizedWallDetails,
    );
    existing.is_hour_based = existing.is_hour_based || hourBased;

    if (existing.is_hour_based) {
      existing.remaining_area = Math.max(
        Number(existing.remaining_area || 0),
        area,
      );
      existing.required_hours = Math.max(
        Number(existing.required_hours || 0),
        requiredHours,
      );
      existing.remaining_hours = Math.max(
        Number(existing.remaining_hours || 0),
        Number(row.remaining_hours ?? area ?? 0),
      );
    } else {
      const mergedArea = existing.wall_details.reduce(
        (sum, wall) => sum + Number(wall.area || 0),
        0,
      );
      const mergedHours = existing.wall_details.reduce(
        (sum, wall) => sum + Number(wall.hours || 0),
        0,
      );

      existing.remaining_area = mergedArea;
      existing.required_hours = mergedHours;
    }

    existing.total_hours = existing.total_hours ?? row.total_hours ?? null;
    existing.reported_hours = existing.reported_hours ?? row.reported_hours ?? null;
  });

  return Array.from(map.values()).sort((a, b) => {
    if (a.priority_rank !== b.priority_rank) {
      return a.priority_rank - b.priority_rank;
    }

    return `${a.application}-${a.flat}-${a.layer_name}`.localeCompare(
      `${b.application}-${b.flat}-${b.layer_name}`,
    );
  });
}

function buildDemandWallSnapshotMap(demandWalls: WorkDemandWallSnapshot[]) {
  const map = new Map<string, WorkDemandWallSnapshot[]>();

  demandWalls.forEach((wall) => {
    if (!wall?.demand_id || !wall?.wall_name) return;

    const list = map.get(wall.demand_id) || [];
    list.push(wall);
    map.set(wall.demand_id, list);
  });

  map.forEach((list) => {
    list.sort((a, b) => String(a.wall_name).localeCompare(String(b.wall_name)));
  });

  return map;
}

function buildWallDetailsFromSnapshots(
  snapshotWalls: WorkDemandWallSnapshot[],
  productivity: number,
): DemandWallDetail[] {
  return snapshotWalls
    .map((wall) => {
      const area = Number(
        wall.remaining_area ??
          wall.wall_area ??
          wall.assigned_area ??
          0,
      );

      return {
        wall_name: wall.wall_name,
        area,
        hours: productivity > 0 ? area / productivity : 0,
      };
    })
    .filter((wall) => Boolean(wall.wall_name) && Number(wall.area || 0) > 0);
}

function buildWallDetails(
  wallNames: string[],
  row: any,
  totalArea: number,
  totalHours: number,
  productivity: number,
): DemandWallDetail[] {
  if (wallNames.length === 0) return [];

  if (row.wall_name && wallNames.length === 1) {
    const area = Number(row.remaining_area || row.wall_area || totalArea || 0);
    return [
      {
        wall_name: row.wall_name,
        area,
        hours: productivity > 0 ? area / productivity : totalHours,
      },
    ];
  }

  const perWallArea = wallNames.length > 0 ? totalArea / wallNames.length : 0;
  const perWallHours = wallNames.length > 0 ? totalHours / wallNames.length : 0;

  return wallNames.map((wallName) => ({
    wall_name: wallName,
    area: perWallArea,
    hours: productivity > 0 ? perWallArea / productivity : perWallHours,
  }));
}

function mergeWallDetails(
  current: DemandWallDetail[],
  incoming: DemandWallDetail[],
) {
  const map = new Map<string, DemandWallDetail>();

  current.forEach((wall) => {
    map.set(norm(wall.wall_name), { ...wall });
  });

  incoming.forEach((wall) => {
    const key = norm(wall.wall_name);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, { ...wall });
      return;
    }

    existing.area = Math.max(
      Number(existing.area || 0),
      Number(wall.area || 0),
    );
    existing.hours = Math.max(
      Number(existing.hours || 0),
      Number(wall.hours || 0),
    );
  });

  return Array.from(map.values());
}

function selectedWallNamesForRecommendations(
  recommendations: RecommendedAssignment[],
  walls: RecommendedAssignmentWall[],
) {
  const recommendationIds = new Set(
    recommendations.map((row) => row.recommendation_id),
  );

  const selected = new Set<string>();

  walls.forEach((wall: any) => {
    if (!recommendationIds.has(wall.recommendation_id)) return;
    if (isRemovedStatus(wall.wall_assignment_status)) return;
    if (!wall.wall_name) return;

    selected.add(norm(wall.wall_name));
  });

  return selected;
}

function ExpandableWallNames({ wallNames }: { wallNames: string[] }) {
  const [expanded, setExpanded] = useState(false);

  if (wallNames.length === 0) return <span>-</span>;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800"
      >
        {expanded ? 'Hide' : 'Show'} {wallNames.length} walls
      </button>

      {expanded && (
        <div className="mt-2 max-w-md text-xs leading-5 text-slate-400">
          {wallNames.join(', ')}
        </div>
      )}
    </div>
  );
}

function wallNamesForRecommendation(
  recommendationId: string,
  walls: RecommendedAssignmentWall[],
) {
  return walls
    .filter(
      (wall) =>
        wall.recommendation_id === recommendationId &&
        !isRemovedStatus(wall.wall_assignment_status),
    )
    .map((wall) => String(wall.wall_name || '').trim())
    .filter(Boolean);
}

function wallNamesForRecommendedRow(
  row: RecommendedAssignment,
  recommendationWalls: RecommendedAssignmentWall[],
  demandWalls: WorkDemandWallSnapshot[],
) {
  const fromRecommendationWalls = wallNamesForRecommendation(
    row.recommendation_id,
    recommendationWalls,
  );

  if (fromRecommendationWalls.length > 0) {
    return uniqueNormalizedList(fromRecommendationWalls);
  }

  const demandId = String((row as any).demand_id || '').trim();

  const fromDemandSnapshot = splitList(
    String((row as any).demand_wall_names || ''),
  ).filter((wallName) => wallName && wallName !== '__HOUR_BASED__');

  if (fromDemandSnapshot.length > 0) {
    return uniqueNormalizedList(fromDemandSnapshot);
  }

  if (!demandId) {
    return [];
  }

  return uniqueNormalizedList(
    demandWalls
      .filter((wall) => String(wall.demand_id || '').trim() === demandId)
      .map((wall) => String(wall.wall_name || '').trim())
      .filter((wallName) => wallName && wallName !== '__HOUR_BASED__'),
  );
}

function hasActiveRecommendation(
  demandId: string,
  recommendations: RecommendedAssignment[],
) {
  return recommendations.some((row) => row.demand_id === demandId);
}

function recommendationDemandLogicalKey(row: any) {
  return [
    norm(row?.application),
    norm(row?.flat),
    norm(row?.layer_id || row?.layer_name),
    norm(row?.layer_name),
    norm(row?.surface_type),
  ].join('|');
}

function recommendationMatchesDemandRow(
  recommendation: RecommendedAssignment,
  demand: GroupedDemandRow,
) {
  if (
    recommendation.demand_id &&
    demand.demand_id &&
    String(recommendation.demand_id) === String(demand.demand_id)
  ) {
    return true;
  }

  return (
    recommendationDemandLogicalKey(recommendation) ===
    recommendationDemandLogicalKey(demand)
  );
}

function dedupeRecommendedAssignments(rows: RecommendedAssignment[]) {
  const map = new Map<string, RecommendedAssignment>();

  rows.forEach((row) => {
    const key = [
      recommendationDemandLogicalKey(row),
      norm(row.recommendation_reason || row.assignment_type || ''),
    ].join('|');

    const existing = map.get(key);

    if (!existing) {
      map.set(key, row);
      return;
    }

    const existingDate = Date.parse(String((existing as any).created_at || ''));
    const rowDate = Date.parse(String((row as any).created_at || ''));

    if (Number.isFinite(rowDate) && (!Number.isFinite(existingDate) || rowDate > existingDate)) {
      map.set(key, row);
    }
  });

  return Array.from(map.values());
}

function isPainterCategory(category: unknown) {
  const value = norm(category);
  return value === 'PAINTER' || value === 'PAINTERS';
}

function isHelperCategory(category: unknown) {
  const value = norm(category);
  return value === 'HELPER' || value === 'HELPERS';
}

function isHelperOnlyWorkLayerName(layerName: unknown) {
  return ['CLEANING', 'HELPING', 'MATERIAL SHIFTING'].includes(norm(layerName));
}

function isTouchupPainterFirstLayerName(layerName: unknown) {
  return [
    'TOUCHUP PUTTY',
    'TOUCHUP PUTTY 1',
    'TOUCHUP PUTTY 2',
    'TOUCHUP SANDING',
    'TOUCHUP SANDING 1',
    'TOUCHUP SANDING 2',
  ].includes(norm(layerName));
}

function isHourBasedLayerName(layerName: unknown) {
  return isHelperOnlyWorkLayerName(layerName);
}

function isHourBasedRow(row: any) {
  return Boolean(row?.is_hour_based) || isHourBasedLayerName(row?.layer_name || row?.work_layer || row?.layer);
}

function isAutoRemovedRecommendation(row: any) {
  if (!isRemovedStatus(row?.recommendation_status)) return false;

  const reason = norm(row?.override_reason || row?.reason || row?.change_reason || '');

  return (
    reason.includes('AUTO REMOVED') ||
    reason.includes('EXCEEDS AVAILABLE') ||
    reason.includes('CAPACITY') ||
    reason.includes('PRODUCTIVITY IS MISSING') ||
    reason.includes('MISSING PRODUCTIVITY')
  );
}

function isManualRemovedRecommendation(row: any) {
  if (!isRemovedStatus(row?.recommendation_status)) return false;

  // Auto-capacity removals are not user removals. They should be displayed as
  // normal available demand with Add + Add Partial.
  if (isAutoRemovedRecommendation(row)) return false;

  const reason = norm(row?.override_reason || row?.reason || row?.change_reason || '');

  return (
    reason.includes('REMOVED FROM RECOMMENDATION WORKSPACE') ||
    reason.includes('MANUAL REMOVE') ||
    reason.includes('USER REMOVED') ||
    reason.includes('REMOVED BY USER') ||
    reason === ''
  );
}

function isRemovedStatus(status?: string | null) {
  return ['REMOVED', 'CANCELLED'].includes(norm(status));
}

function splitList(value: string) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function norm(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function roundToTwo(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatNumber(value: unknown) {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) return '0';

  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
  }).format(number);
}

function shortDate(value?: string | null) {
  if (!value) return '-';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function shortDateTime(value?: string | null) {
  if (!value) return '-';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toDateInput(value: string) {
  if (!value) return todayDateInput();

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return todayDateInput();

  return date.toISOString().slice(0, 10);
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowDateInput() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong';
}


async function fetchAssignmentRecommendationScopeLocal(
  token: string,
  projectId: string,
  runId: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/assignment/runs/${runId}/recommendation-scope`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<AssignmentRecommendationScope>;
}

async function updateAssignmentRecommendationScopeLocal(
  token: string,
  projectId: string,
  runId: string,
  payload: UpdateAssignmentRecommendationScopePayload,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/assignment/runs/${runId}/recommendation-scope`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<AssignmentRecommendationScope>;
}

async function fetchDemandWallsForDemandLocal(
  token: string,
  projectId: string,
  demandId: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/assignment/demand/${demandId}/walls`,
    {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    let message = 'Failed to fetch demand wall details.';

    try {
      const body = await response.json();
      message = body?.message || message;
    } catch {
      // keep default message
    }

    throw new Error(message);
  }

  return response.json() as Promise<WorkDemandWallSnapshot[]>;
}

async function fetchDemandWallsLocal(
  token: string,
  projectId: string,
  runId: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/assignment/runs/${runId}/demand-walls`,
    {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    let message = 'Failed to fetch work demand wall details.';

    try {
      const body = await response.json();
      message = body?.message || message;
    } catch {
      // keep default message
    }

    throw new Error(message);
  }

  return response.json() as Promise<WorkDemandWallSnapshot[]>;
}

async function fetchLayerProgressRowsLocal(token: string, projectId: string) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/assignment/layer-progress`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    let message = 'Failed to fetch layer progress rows.';

    try {
      const body = await response.json();
      message = body?.message || message;
    } catch {
      // keep default message
    }

    throw new Error(message);
  }

  return response.json() as Promise<AssignmentLayerProgressRow[]>;
}

async function fetchLayerProgressDetailsLocal(
  token: string,
  projectId: string,
  row: AssignmentLayerProgressRow,
) {
  const params = new URLSearchParams({
    application: row.application,
    flat: row.flat,
    layerId: row.layer_id,
    layerName: row.layer_name,
  });

  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/assignment/layer-progress/details?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    let message = 'Failed to fetch layer progress details.';

    try {
      const body = await response.json();
      message = body?.message || message;
    } catch {
      // keep default message
    }

    throw new Error(message);
  }

  const body = await response.json();

  if (Array.isArray(body)) {
    return normalizeLayerProgressDetails(body);
  }

  const reportedRows = Array.isArray(body.reportedRows) ? body.reportedRows : [];
  const rolloverRows = Array.isArray(body.rolloverRows) ? body.rolloverRows : [];

  return normalizeLayerProgressDetails([...rolloverRows, ...reportedRows]);
}

function normalizeLayerProgressDetails(rows: any[]) {
  return rows.map((row) => ({
    ...row,
    date: row.date ?? row.work_date ?? null,
    work_status:
      row.work_status ??
      (row.source_type === 'Rollover' ? 'Rollover' : row.assignment) ??
      '-',
  })) as LayerProgressDetailRow[];
}

async function fetchReportedBackendRowsLocal(
  token: string,
  projectId: string,
  workDate: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/assignment/reporting/reported?workDate=${encodeURIComponent(
      workDate,
    )}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    let message = 'Failed to fetch reported backend rows.';

    try {
      const body = await response.json();
      message = body?.message || message;
    } catch {
      // keep default message
    }

    throw new Error(message);
  }

  return response.json() as Promise<ReportedBackendRow[]>;
}

async function updateReportedBackendRowLocal(
  token: string,
  projectId: string,
  backendId: string,
  payload: UpdateReportedBackendRowPayload,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/assignment/reporting/backend/${backendId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    let message = 'Failed to update reported backend row.';

    try {
      const body = await response.json();
      message = Array.isArray(body?.message)
        ? body.message.join(', ')
        : body?.message || message;
    } catch {
      // keep default message
    }

    throw new Error(message);
  }

  return response.json() as Promise<ReportedBackendRow>;
}


async function fetchAssignmentViewForDateLocal(
  token: string,
  projectId: string,
  viewName: string,
  assignmentDate: string,
) {
  const searchParams = new URLSearchParams();

  if (assignmentDate) {
    searchParams.set('assignmentDate', assignmentDate);
  }

  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : '';

  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/assignment/views/${viewName}${suffix}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    let message = `Failed to fetch ${viewName} assignment view.`;

    try {
      const body = await response.json();
      message = body?.message || message;
    } catch {
      // keep default message
    }

    throw new Error(message);
  }

  return response.json() as Promise<AssignmentDemandRow[]>;
}

async function fetchPendingAssignedRowsByDateLocal(
  token: string,
  projectId: string,
  assignmentDate: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/assignment/reporting/pending-assigned?assignmentDate=${encodeURIComponent(
      assignmentDate,
    )}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    let message = 'Failed to fetch pending assigned rows.';

    try {
      const body = await response.json();
      message = body?.message || message;
    } catch {
      // keep default message
    }

    throw new Error(message);
  }

  return response.json() as Promise<TodayAssignedReportingRow[]>;
}

async function fetchAssignedHistoryRowsLocal(
  token: string,
  projectId: string,
  assignmentDate: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/assignment/reporting/assigned?assignmentDate=${encodeURIComponent(
      assignmentDate,
    )}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    let message = 'Failed to fetch assigned rows.';

    try {
      const body = await response.json();
      message = body?.message || message;
    } catch {
      // keep default message
    }

    throw new Error(message);
  }

  return response.json() as Promise<AssignedHistoryRow[]>;
}