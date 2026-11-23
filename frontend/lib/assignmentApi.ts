const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

async function handleResponse(response: Response) {
  const text = await response.text();

  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = Array.isArray(data?.message)
      ? data.message.join(', ')
      : data?.message || data || 'Request failed';

    throw new Error(message);
  }

  return data;
}

function authHeaders(token: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function buildQuery(params: Record<string, string | number | null | undefined>) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      searchParams.set(key, String(value));
    }
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

function assignmentBase(projectId: string) {
  return `${API_BASE_URL}/projects/${projectId}/assignment`;
}

export type WorkMode = 'Machine' | 'Manual' | 'Both';

export type AssignmentHealth = {
  backend_rows: number;
  layer_rows: number;
  surface_rows: number;
  productivity_rows: number;
  painter_rows: number;
  live_demand_rows: number;
  assignment_run_rows: number;
  work_demand_item_rows: number;
  work_demand_wall_rows: number;
};

export type AssignmentCapacity = {
  project_id?: string | null;
  availability_date: string;
  site: string;
  available_painter_count: number;
  available_hours: number;
  capacity_source: string;
  painter_count?: number | null;
  painter_available_hours?: number | null;
  helper_count?: number | null;
  helper_available_hours?: number | null;
  total_worker_count?: number | null;
  total_available_hours?: number | null;
};

export type AssignmentDropdownBlock = {
  project_id?: string | null;
  block: string;
};

export type AssignmentDropdownApplication = {
  project_id?: string | null;
  block: string;
  application: string;
};

export type AssignmentDropdownFlat = {
  project_id?: string | null;
  block: string;
  application: string;
  flat: string;
};

export type AssignmentLayerOption = {
  project_id?: string | null;
  block: string | null;
  application: string;
  flat: string;
  layer_id: string;
  layer_name: string;
  layer_order: number;
  billable?: boolean | null;
  wkdpct: number;
  is_hour_based?: boolean | null;
  total_hours?: number | null;
  reported_hours?: number | null;
  remaining_hours?: number | null;
};

export type AssignmentWallOption = {
  project_id?: string | null;
  block: string | null;
  application: string;
  flat: string;
  layer_id: string;
  layer_name: string;
  layer_order: number;
  surface_type: string | null;
  wall_name: string;
  wall_area: number;
  already_done_area: number;
  pending_area: number;
  is_assigned_today: boolean;
  assigned_today_assignment_id: string | null;
  assigned_today_area: number;
};

export type AssignmentPainter = {
  project_id?: string | null;
  current_project_id?: string | null;
  painter_id: string;
  row_id?: string | null;
  painter_name: string;
  painter_display?: string | null;
  current_site: string | null;
  category: string | null;
  daily_wage: number;
  status: string | null;
};

export type TodayPainterAttendanceRow = {
  person_id: string;
  painter_name: string;
  member_code: string | null;
  clock_in_time: string;
  clock_in_time_display: string;
  clock_out_time: string | null;
  clock_out_time_display: string | null;
  currently_on_site: boolean;
};

export type TodayPainterAttendance = {
  project_id: string;
  site_name: string;
  attendance_date: string;
  timezone: string;
  present_painter_count: number;
  currently_on_site_count: number;
  painters: TodayPainterAttendanceRow[];
};

export type AssignmentProductivityOption = {
  project_id?: string | null;
  application: string;
  layer_name: string;
  machine_or_manual: WorkMode | string;
  productivity_per_hour: number;
};

export type AssignmentMaterialSuggestion = {
  material_id: string;
  project_id: string;
  application: string;
  layer_name: string;
  material_name: string;
  coverage: number;
  unit_cost?: number | null;
  material_per_sqft?: number | null;
};


export type AssignmentDemandRow = {
  project_id?: string | null;
  source_id: string;
  source_wall_id?: string;
  section: string;
  priority_rank: number;
  block: string | null;
  application: string;
  flat: string;
  layer_id: string;
  layer_name: string;
  surface_type: string | null;
  layer_order?: number | null;
  billable?: boolean | null;
  wall_name?: string;
  wall_area?: number;
  wall_count?: number;
  wall_names?: string;
  remaining_area: number;
  machine_or_manual?: WorkMode | string | null;
  productivity_mode_rule?: string | null;
  productivity_per_hour?: number | null;
  required_hours?: number | null;
  oldest_date?: string | null;
  source_table?: string | null;
  reason?: string | null;
  eligibility_status?: string | null;
  risk_reason?: string | null;
  is_hour_based?: boolean | null;
  total_hours?: number | null;
  reported_hours?: number | null;
  remaining_hours?: number | null;
};

export type AssignmentRun = {
  project_id?: string | null;
  run_id: string;
  site: string;
  assignment_date: string;
  generated_at: string;
  generated_by: string | null;
  status: string;
  total_available_hours: number;
  total_demand_hours: number;
  total_recommended_hours: number;
  idle_hours: number;
  over_assigned_hours: number;
  notes: string | null;
};

export type WorkDemandItem = AssignmentDemandRow & {
  demand_id: string;
  run_id: string;
  wall_count: number;
  wall_names: string;
  demand_status: string;
  created_at: string;
};

export type WorkDemandWall = {
  project_id?: string | null;
  demand_wall_id: string;
  demand_id: string;
  source_wall_id?: string | null;
  wall_name: string;
  wall_area: number;
  remaining_area: number;
  source_table?: string | null;
  source_id?: string | null;
  demand_wall_status?: string | null;
};

export type RecommendedAssignment = {
  project_id?: string | null;
  recommendation_id: string;
  run_id: string;
  demand_id: string | null;
  block: string | null;
  application: string;
  flat: string;
  layer_id: string;
  layer_name: string;
  surface_type: string | null;
  assigned_area: number;
  required_hours: number;
  assignment_type: string | null;
  recommendation_reason: string | null;
  warning_status: string | null;
  machine_or_manual: WorkMode | string | null;
  selected_productivity_per_hour: number;
  productivity_mode_rule: string | null;
  painter_count: number;
  assigned_painter_ids: string[] | null;
  assigned_painter_names: string[] | null;
  recommendation_status: string;
  is_manual_edit: boolean;
  override_reason: string | null;
  created_by: string | null;
  created_at: string;
  edited_by: string | null;
  edited_at: string | null;
};

export type RecommendedAssignmentWall = {
  project_id?: string | null;
  recommendation_wall_id: string;
  recommendation_id: string;
  demand_wall_id: string | null;
  wall_name: string;
  wall_area: number;
  assigned_area: number;
  remaining_area_after_assignment: number;
  wall_assignment_status: string;
};

export type FinalAssignment = {
  project_id?: string | null;
  assignment_id: string;
  run_id: string | null;
  recommendation_id: string | null;
  assignment_date: string;
  block: string | null;
  application: string;
  flat: string;
  layer_id: string;
  layer_name: string;
  surface_type: string | null;
  assigned_area: number;
  expected_hours: number;
  machine_or_manual: WorkMode | string | null;
  painter_count: number;
  assigned_painter_ids: string[] | null;
  assigned_painter_names: string[] | null;
  status: string;
  published_at: string;
  published_by: string | null;
  created_at: string;
};

export type FinalAssignmentWall = {
  project_id?: string | null;
  final_assignment_wall_id: string;
  assignment_id: string;
  wall_name: string;
  wall_area: number;
  assigned_area: number;
  reported_area: number;
  remaining_area: number;
  wall_status: string;
};

export type TodayAssignedReportingRow = {
  project_id?: string | null;
  run_id?: string | null;
  recommendation_id?: string | null;
  assignment_id: string;
  assignment_date: string;
  block: string | null;
  application: string;
  flat: string;
  layer_id: string;
  layer_name: string;
  surface_type: string | null;
  assigned_wall_names: string | null;
  pending_wall_names: string | null;
  assigned_area: number;
  reported_area: number;
  pending_area: number;
  productivity_per_hour: number;
  hours_for_one_painter: number;
  machine_or_manual: WorkMode | string | null;
  painter_count: number;
  assigned_painter_ids: string[] | null;
  assigned_painter_names: string[] | null;
  reporting_status: string;
  reporting_painter_names?: string[] | null;
  reporting_working_hours?: number | null;
  reporting_hours_mode?: 'recommended' | 'manual' | null;
  material_name?: string | null;
  material_coverage?: number | null;
  material_used_l_kg?: number | null;
};

export type SubmitReportingPayload = {
  block: string;
  application: string;
  flat: string;
  layerId: string;
  wallNames: string[];
  painterNames?: string[];
  machineOrManual: string;
  workingHours?: number;
  pendingArea?: number;
  workDate?: string;
  assignmentId?: string | null;
  materialName?: string | null;
  materialUsedLKg?: number;
  remark?: string | null;
};

export type AssignmentChangeLog = {
  project_id?: string | null;
  change_id?: string;
  id?: string;
  run_id?: string | null;
  recommendation_id?: string | null;
  assignment_id?: string | null;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  changed_by: string | null;
  changed_at: string;
  approval_required: boolean;
};

export type PlannedVsDoneRow = {
  project_id?: string | null;
  assignment_date?: string;
  assignment_id?: string;
  block?: string | null;
  application: string;
  flat: string;
  layer_id?: string;
  layer_name: string;
  surface_type?: string | null;
  assigned_area?: number;
  actual_area_done?: number;
  done_area?: number;
  reported_area?: number;
  remaining_area?: number;
  completion_percent?: number;
  completion_pct?: number;
  outcome_status?: string;
  status?: string;
};

export type CreateAssignmentRunResponse = {
  runId: string;
  run: AssignmentRun;
  demandItems: WorkDemandItem[];
  demandWalls: WorkDemandWall[];
};

export type GenerateRecommendationsResponse = {
  run: AssignmentRun;
  recommendations: RecommendedAssignment[];
  recommendationWalls: RecommendedAssignmentWall[];
};

export type FinalizeRunResponse = {
  run: AssignmentRun;
  finalAssignments: FinalAssignment[];
  finalAssignmentWalls: FinalAssignmentWall[];
};

export type RecommendationMutationResponse = {
  recommendations: RecommendedAssignment[];
  recommendationWalls: RecommendedAssignmentWall[];
  changeLog?: AssignmentChangeLog[];
};


export async function fetchAssignmentHealth(token: string, projectId: string) {
  const response = await fetch(`${assignmentBase(projectId)}/health`, {
    headers: authHeaders(token),
  });

  return handleResponse(response) as Promise<AssignmentHealth>;
}

export async function fetchAssignmentCapacity(
  token: string,
  projectId: string,
  assignmentDate: string,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/capacity${buildQuery({ assignmentDate })}`,
    {
      cache: 'no-store',
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<AssignmentCapacity>;
}

export async function fetchAssignmentBlocks(token: string, projectId: string) {
  const response = await fetch(`${assignmentBase(projectId)}/dropdowns/blocks`, {
    headers: authHeaders(token),
  });

  return handleResponse(response) as Promise<AssignmentDropdownBlock[]>;
}

export async function fetchAssignmentApplications(
  token: string,
  projectId: string,
  block?: string,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/dropdowns/applications${buildQuery({ block })}`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<AssignmentDropdownApplication[]>;
}

export async function fetchAssignmentFlats(
  token: string,
  projectId: string,
  params?: { block?: string; application?: string },
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/dropdowns/flats${buildQuery(params || {})}`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<AssignmentDropdownFlat[]>;
}

export async function fetchAssignmentLayers(
  token: string,
  projectId: string,
  params?: { application?: string; flat?: string },
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/dropdowns/layers${buildQuery(params || {})}`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<AssignmentLayerOption[]>;
}

export async function fetchAssignmentWalls(
  token: string,
  projectId: string,
  params?: { application?: string; flat?: string; layerId?: string },
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/dropdowns/walls${buildQuery(params || {})}`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<AssignmentWallOption[]>;
}

export async function fetchAssignmentPainters(token: string, projectId: string) {
  const response = await fetch(
    `${assignmentBase(projectId)}/dropdowns/painters`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<AssignmentPainter[]>;
}

export async function fetchTodayPainterAttendance(
  token: string,
  projectId: string,
) {
  const response = await fetch(`${assignmentBase(projectId)}/attendance/today`, {
    headers: authHeaders(token),
    cache: 'no-store',
  });

  return handleResponse(response) as Promise<TodayPainterAttendance>;
}

export async function fetchAssignmentProductivityOptions(
  token: string,
  projectId: string,
  params?: { application?: string; layerName?: string },
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/dropdowns/productivity-options${buildQuery(
      params || {},
    )}`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<AssignmentProductivityOption[]>;
}

export async function fetchAssignmentMaterialSuggestion(
  token: string,
  projectId: string,
  params?: { application?: string; layerName?: string },
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/dropdowns/material-suggestion${buildQuery(
      params || {},
    )}`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<AssignmentMaterialSuggestion | null>;
}


export async function fetchAssignmentView(
  token: string,
  projectId: string,
  view:
    | 'rollover'
    | 'qc-rework'
    | 'ongoing'
    | 'new-layer'
    | 'live-demand'
    | 'layer-status',
) {
  const response = await fetch(`${assignmentBase(projectId)}/views/${view}`, {
    headers: authHeaders(token),
  });

  return handleResponse(response) as Promise<AssignmentDemandRow[]>;
}

export async function fetchPlannedVsDone(token: string, projectId: string) {
  const response = await fetch(
    `${assignmentBase(projectId)}/views/planned-vs-done`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<PlannedVsDoneRow[]>;
}

export async function fetchAssignmentRuns(token: string, projectId: string) {
  const response = await fetch(`${assignmentBase(projectId)}/runs`, {
    cache: 'no-store',
    headers: authHeaders(token),
  });

  return handleResponse(response) as Promise<AssignmentRun[]>;
}

export async function createAssignmentRun(
  token: string,
  projectId: string,
  payload: { assignmentDate: string; generatedBy?: string },
) {
  const response = await fetch(`${assignmentBase(projectId)}/runs`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });

  return handleResponse(response) as Promise<CreateAssignmentRunResponse>;
}

export async function fetchDemandItems(
  token: string,
  projectId: string,
  runId: string,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/runs/${runId}/demand-items`,
    {
      cache: 'no-store',
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<WorkDemandItem[]>;
}

export async function fetchDemandWalls(
  token: string,
  projectId: string,
  runId: string,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/runs/${runId}/demand-walls`,
    {
      cache: 'no-store',
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<WorkDemandWall[]>;
}

export async function updateDemandWorkMode(
  token: string,
  projectId: string,
  demandId: string,
  machineOrManual: WorkMode,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/demand/${demandId}/work-mode`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ machineOrManual }),
    },
  );

  return handleResponse(response) as Promise<WorkDemandItem[]>;
}

export type AssignmentFloorRestrictionBlock = {
  block: string;
  available_floors: number[];
  blocked_floors: number[];
  source?: 'run' | 'default' | 'unrestricted' | string;
};

export type AssignmentFloorRestrictionsResponse = {
  project_id: string;
  run_id?: string | null;
  blocks: AssignmentFloorRestrictionBlock[];
};

export type AssignmentFloorRestrictionPayload = {
  block: string;
  blockedFloors: number[];
};

export async function fetchAssignmentFloorRestrictions(
  token: string,
  projectId: string,
  runId?: string,
) {
  const params = new URLSearchParams();
  if (runId) params.set('runId', runId);

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(
    `${assignmentBase(projectId)}/floor-restrictions${suffix}`,
    { cache: 'no-store', headers: authHeaders(token) },
  );

  return handleResponse(response) as Promise<AssignmentFloorRestrictionsResponse>;
}

export type RecommendationModeOverridePayload = {
  application: string;
  layerName: string;
  machineOrManual: WorkMode;
};

export type GenerateRecommendationsPayload = {
  includeRollover?: boolean;
  modeOverrides?: RecommendationModeOverridePayload[];
  floorRestrictions?: AssignmentFloorRestrictionPayload[];
};

export async function generateAssignmentRecommendations(
  token: string,
  projectId: string,
  runId: string,
  payload: GenerateRecommendationsPayload = {},
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/runs/${runId}/recommendations/generate`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    },
  );

  return handleResponse(response) as Promise<GenerateRecommendationsResponse>;
}

export async function fetchRecommendations(
  token: string,
  projectId: string,
  runId: string,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/runs/${runId}/recommendations`,
    {
      cache: 'no-store',
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<RecommendedAssignment[]>;
}

export async function fetchRecommendationWalls(
  token: string,
  projectId: string,
  runId: string,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/runs/${runId}/recommendation-walls`,
    {
      cache: 'no-store',
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<RecommendedAssignmentWall[]>;
}

export async function updateRecommendationWorkMode(
  token: string,
  projectId: string,
  recommendationId: string,
  machineOrManual: WorkMode,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/recommendations/${recommendationId}/work-mode`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ machineOrManual }),
    },
  );

  return handleResponse(response) as Promise<RecommendedAssignment[]>;
}

export async function addFullDemandToRecommendation(
  token: string,
  projectId: string,
  demandId: string,
  payload: {
    runId: string;
    changedBy?: string;
    reason?: string;
  },
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/demand/${demandId}/add-full`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    },
  );

  return handleResponse(response) as Promise<RecommendationMutationResponse>;
}

export async function addPartialDemandToRecommendation(
  token: string,
  projectId: string,
  demandId: string,
  payload: {
    runId: string;
    assignedArea: number;
    wallNames?: string[];
    changedBy?: string;
    reason?: string;
  },
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/demand/${demandId}/add-partial`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    },
  );

  return handleResponse(response) as Promise<RecommendationMutationResponse>;
}

export async function removeRecommendationRow(
  token: string,
  projectId: string,
  recommendationId: string,
  payload: {
    changedBy?: string;
    reason?: string;
  },
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/recommendations/${recommendationId}/remove`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    },
  );

  return handleResponse(response) as Promise<RecommendationMutationResponse>;
}

export async function restoreRecommendationRow(
  token: string,
  projectId: string,
  recommendationId: string,
  payload: {
    changedBy?: string;
    reason?: string;
  },
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/recommendations/${recommendationId}/restore`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    },
  );

  return handleResponse(response) as Promise<RecommendationMutationResponse>;
}

export async function updateRecommendationPainters(
  token: string,
  projectId: string,
  recommendationId: string,
  payload: {
    painterNames: string[];
    painterIds?: string[];
    changedBy?: string;
    reason?: string;
  },
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/recommendations/${recommendationId}/painters`,
    {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    },
  );

  return handleResponse(response) as Promise<RecommendationMutationResponse>;
}

export async function finalizeAssignmentRun(
  token: string,
  projectId: string,
  runId: string,
  payload?: {
    finalizedBy?: string;
    overrideReason?: string;
  },
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/runs/${runId}/finalize`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload || {}),
    },
  );

  return handleResponse(response) as Promise<FinalizeRunResponse>;
}

export async function fetchFinalAssignments(
  token: string,
  projectId: string,
  runId: string,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/runs/${runId}/final-assignments`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<FinalAssignment[]>;
}

export async function fetchFinalAssignmentWalls(
  token: string,
  projectId: string,
  runId: string,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/runs/${runId}/final-assignment-walls`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<FinalAssignmentWall[]>;
}

export type DefaultReportingAssignmentDateResponse = {
  assignment_date: string | null;
};

export async function fetchDefaultReportingAssignmentDate(
  token: string,
  projectId: string,
): Promise<DefaultReportingAssignmentDateResponse> {
  const response = await fetch(
    `${assignmentBase(projectId)}/reporting/default-assignment-date`,
    {
      headers: authHeaders(token),
      cache: 'no-store',
    },
  );

  const result = await handleResponse(response);
  return result as DefaultReportingAssignmentDateResponse;
}

export async function fetchTodayAssignedReporting(
  token: string,
  projectId: string,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/reporting/today-assigned`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<TodayAssignedReportingRow[]>;
}

export async function submitAssignmentReporting(
  token: string,
  projectId: string,
  payload: SubmitReportingPayload,
) {
  const response = await fetch(`${assignmentBase(projectId)}/reporting/submit`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });

  return handleResponse(response) as Promise<Record<string, unknown>[]>;
}


export type BulkSubmitAssignedReportingItem = {
  assignmentId: string;
  block?: string;
  application: string;
  flat: string;
  layerId: string;
  layerName: string;
  wallNames?: string[];
  painterNames?: string[];
  machineOrManual?: string;
  workingHours?: number;
  pendingArea?: number;
  workDate?: string;
  materialName?: string | null;
  materialUsedLKg?: number;
  remark?: string | null;
};

export type BulkSubmitAssignedReportingPayload = {
  items: BulkSubmitAssignedReportingItem[];
  changedBy?: string;
};

export async function bulkSubmitAssignedReporting(
  token: string,
  projectId: string,
  payload: BulkSubmitAssignedReportingPayload,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/reporting/bulk-submit-assigned`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    },
  );

  return handleResponse(response) as Promise<ReportedBackendRow[]>;
}

export async function fetchAssignmentChangeLog(
  token: string,
  projectId: string,
  runId?: string,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/change-log${buildQuery({ runId })}`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<AssignmentChangeLog[]>;
} 
export type ReportedBackendRow = {
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
};

export async function fetchReportedBackendRows(
  token: string,
  projectId: string,
  workDate: string,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/reporting/reported${buildQuery({ workDate })}`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<ReportedBackendRow[]>;
}

export type UpdateReportedBackendRowPayload = {
  wallNames?: string[];
  painterNames?: string[];
  machineOrManual: string;
  workingHours?: number;
  materialName?: string | null;
  materialUsedLKg?: number;
  remark?: string | null;
  changedBy?: string;
};

export async function updateReportedBackendRow(
  token: string,
  projectId: string,
  backendId: string,
  payload: UpdateReportedBackendRowPayload,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/reporting/backend/${backendId}`,
    {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    },
  );

  return handleResponse(response) as Promise<ReportedBackendRow>;
}
export type AssignmentLayerProgressRow = {
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
  is_hour_based?: boolean | null;
  total_hours?: number | null;
  reported_hours?: number | null;
  remaining_hours?: number | null;
};

export async function fetchAssignmentLayerProgress(
  token: string,
  projectId: string,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/layer-progress`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<AssignmentLayerProgressRow[]>;
}

export type AssignmentRecommendationScopeLayer = {
  application: string;
  layer_name: string;
  layer_order?: number | null;
  is_allowed: boolean;
};

export type AssignmentRecommendationScopeApplication = {
  project_id: string;
  run_id: string;
  application: string;
  is_allowed: boolean;
  layers: AssignmentRecommendationScopeLayer[];
};

export type AssignmentRecommendationScope = {
  project_id: string;
  run_id: string;
  applications: AssignmentRecommendationScopeApplication[];
};

export type UpdateAssignmentRecommendationScopePayload = {
  applications?: {
    application: string;
    is_allowed: boolean;
  }[];
  layers?: {
    application: string;
    layer_name: string;
    is_allowed: boolean;
  }[];
};

export async function fetchAssignmentRecommendationScope(
  token: string,
  projectId: string,
  runId: string,
) {
  const response = await fetch(
    `${assignmentBase(projectId)}/runs/${runId}/recommendation-scope`,
    {
      headers: authHeaders(token),
    },
  );

  return handleResponse(response) as Promise<AssignmentRecommendationScope>;
}

export async function updateAssignmentRecommendationScope(
  token: string,
  projectId: string,
  runId: string,
  payload: UpdateAssignmentRecommendationScopePayload,
) {
  const url = `${assignmentBase(projectId)}/runs/${runId}/recommendation-scope`;

  let response = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });

  // Fallback for deployments where the controller was updated with POST support
  // but the PATCH route is not active yet.
  if (response.status === 404) {
    response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
  }

  return handleResponse(response) as Promise<AssignmentRecommendationScope>;
}