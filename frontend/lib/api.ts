const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export type User = {
  userId: string;
  username: string;
  role: string;
  projectId?: string | null;
};

export type LoginResponse = {
  accessToken: string;
  user: User;
};

export type ProjectDirectoryProject = {
  projectId: string;
  projectName: string;
  projectCode: string;
  status: string;
  createdAt: string;
  setupStatus: string;
  counts: {
    layers: number;
    surfaces: number;
    flatAreas: number;
    boq: number;
    materials: number;
    productivity: number;
    costing: number;
    backend: number;
  };
  capabilities: {
    overview: boolean;
    projection: boolean;
    boq: boolean;
    actualProgress: boolean;
    assignment: boolean;
    billing: boolean;
  };
};

export async function fetchProjectsDirectory(token: string) {
  const response = await fetch(`${API_BASE_URL}/projects`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return handleResponse(response) as Promise<ProjectDirectoryProject[]>;
}

// Read-only, project-scoped Dimensions (indr.surface_number).
// PostgreSQL numeric values may arrive as JSON strings to preserve precision.
export type DimensionNumber = string | number | null;

export type DimensionRecord = {
  surface_id: string;
  row_id: string | null;
  project_id: string;
  block: string | null;
  application: string | null;
  base: string | null;
  wall: string | null;
  surface_type: string | null;
  total_area_sft: DimensionNumber;
  'length(+ve)': DimensionNumber;
  'width(+ve)': DimensionNumber;
  'height(+ve)': DimensionNumber;
  positive_area: DimensionNumber;
  'length(-ve)': DimensionNumber;
  'width(-ve)': DimensionNumber;
  'height(-ve)': DimensionNumber;
  negative_area: DimensionNumber;
  'length_2(-ve)': DimensionNumber;
  'width_2(-ve)': DimensionNumber;
  'height_2(-ve)': DimensionNumber;
  created_at: string | null;
  updated_at: string | null;
};

export type DimensionListResponse = {
  projectId: string;
  rows: DimensionRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type DimensionFiltersResponse = {
  blocks: string[];
  applications: string[];
  surfaceTypes: string[];
};

export async function fetchProjectDimensions(
  token: string,
  projectId: string,
  options: {
    page?: number;
    pageSize?: number;
    search?: string;
    block?: string;
    application?: string;
    surfaceType?: string;
    signal?: AbortSignal;
  } = {},
): Promise<DimensionListResponse> {
  const params = new URLSearchParams();
  params.set('page', String(options.page || 1));
  params.set('pageSize', String(options.pageSize || 50));
  if (options.search) params.set('search', options.search);
  if (options.block) params.set('block', options.block);
  if (options.application) params.set('application', options.application);
  if (options.surfaceType) params.set('surfaceType', options.surfaceType);

  const response = await fetch(
    `${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/dimensions?${params}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: options.signal,
    },
  );
  return handleResponse(response) as Promise<DimensionListResponse>;
}

export async function fetchProjectDimensionFilters(
  token: string,
  projectId: string,
  signal?: AbortSignal,
): Promise<DimensionFiltersResponse> {
  const response = await fetch(
    `${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/dimensions/filters`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    },
  );
  return handleResponse(response) as Promise<DimensionFiltersResponse>;
}

export type AdminUser = {
  userId: string;
  username: string;
  role: string;
  projectId: string | null;
  isActive: boolean;
  createdAt: string;
};

export type CreateAdminUserPayload = {
  username: string;
  password: string;
  role: 'admin' | 'manager' | 'viewer' | 'client';
  projectId?: string | null;
};

export type ClientOverviewRow = {
  projectId: string | null;
  layerId: string | null;
  flatId: string | null;
  block: string | null;
  application: string | null;
  flat: string | number | null;
  layerName: string | null;
  layerOrder: number;
  billable: boolean;
  totalArea: number;
  doneArea: number;
  wkdpct: number;
};

export type ClientBoqRow = {
  block: string | null;
  application: string | null;
  layer: string | null;
  area: number | null;
  clientRate: number | null;
};

export type ClientWorkApprovalOption = {
  block: string;
  application: string;
  floor: string;
  flat: string;
};

export type ClientWorkApprovalRecord = {
  block: string;
  application: string;
  floor: string;
  flat: string;
  source: 'flat' | 'floor';
  approvedBy: string;
  approvedAt: string;
};

export type ClientWorkApprovalState = {
  options: ClientWorkApprovalOption[];
  approvals: ClientWorkApprovalRecord[];
};

export type SubmitClientWorkApprovalItem = {
  block: string;
  application: string;
  flat: string;
  source: 'flat' | 'floor';
};

export type ProjectionLayer = {
  LayerID: string;
  Block: string | null;
  Application: string | null;
  Flat: string | null;
  LAYERName: string | null;
  ID?: string | null;
  Related_Backends?: string | null;

  Projection_Order?: number | null;
  Billable_Layer_Order?: number | null;
  Projection_Billable?: boolean | null;

  Selected_Work_Mode?: string | null;
  Matched_Productivity_Mode?: string | null;

  Projection_Total_Area: number;
  Projection_Done_Area: number;
  Remaining_Area: number;
  Work_Done_Pct: number;

  Completion_Percent?: number;

  Ideal_Sqft_Hr_Labour?: number;
  Productivity_Sqft_Per_Hour?: number;

  Labour_Hours_Required: number;
  Painter_Required: number;
  Painter_Count_Required?: number;

  Daily_Painters_Input?: number;
  Days_Required: number;

  Material_Name?: string | null;
  Material_Required?: number;
  Material_Cost?: number;

  Daily_Capacity?: number;
  Projection_Work_Mode?: string | null;
  Layer_Material_Key?: string | null;
  Projection_Material_Name?: string | null;
  Projection_Material_Coverage?: number | null;
  Projection_Material_Rate?: number;
};


export type IndrLayerProgressRow = {
  layer_id: string;
  flat_id: string;
  layer_name: string;
  block: string | null;
  application: string | null;
  flat: string | number | null;
  order: number | null;
  layer_order?: number | null;
  billable: boolean;
  wkdpct: number;
  total_area?: number;
  done_area?: number;
  project_id: string;
};

export type ProjectionFlat = {
  FlatID: string;
  ApplicationID: string | null;
  Application: string | null;
  Flat: string | null;

  Billable_Layer_Count: number;
  Completed_Billable_Layer_Count: number;

  Billable_Total_Area: number;
  Billable_Done_Area: number;
  Billable_Remaining_Area: number;

  Flat_Completion_Pct: number;

  Flat_Master_Projection_Total_Area: number;
};

export type BillingDataViewId =
  | 'billing-overall'
  | 'billing-pending'
  | 'billing-sent'
  | 'billing-billed'
  | 'billing-latest';

export type BillingViewId =
  | BillingDataViewId
  | 'billing-invoice'
  | 'billing-floor-layer'
  | 'billing-batch-view';

export type BillingRow = {
  id: string;
  application: string | null;
  flat: string | null;
  surfaceType: string | null;
  layerName: string | null;
  billed: boolean;
  billingNumber: string | null;
  billingDate: string | null;
  rate: number;
  billingArea: number;
  status: string | null;
  batchNo: number;
  workDonePct: number;
  isComplete: boolean;
  canBilled: boolean;
  batch: string | null;
};

export type BillingBatchViewColumn = {
  key: string;
  layerName: string;
  surface: 'Ceiling' | 'Wall';
};

export type BillingBatchViewCell = {
  area: number;
  batch: string | null;
};

export type BillingBatchViewRow = {
  flat: string;
  application: string | null;
  cells: Record<string, BillingBatchViewCell>;
};

export type BillingBatchViewResponse = {
  columns: BillingBatchViewColumn[];
  applications: string[];
  batches: string[];
  rows: BillingBatchViewRow[];
};

export type BillingInvoiceRow = {
  slNo: number;
  descriptionOfTheWork: string;
  surface: string;
  unit: string;
  rate: number;
  quantityPrevious: number;
  quantityCurrent: number;
  quantityCumulative: number;
  amountPrevious: number;
  amountCurrent: number;
  amountCumulative: number;
};

export type BillingFloorLayerSummary = {
  layerName: string;
  layerSort: number;
  rowCount: number;
};

export type BillingFloorLayerRow = {
  rowType: string | null;
  sectionTitle: string | null;
  floorLabel: string | null;
  floorNo: number;
  application: string | null;
  flat: string | null;
  description: string | null;
  layerName: string | null;
  layerSort: number;
  unit: string | null;
  nos: number;
  ceilingArea: number;
  ceilingBatch: string | null;
  ceilingBatchNo: number;
  ceilingBillingDate: string | null;
  ceilingBillingNumber: string | null;
  wallArea: number;
  wallBatch: string | null;
  wallBatchNo: number;
  wallBillingDate: string | null;
  wallBillingNumber: string | null;
  batchSummary: string | null;
  latestRowBatchNo: number;
  isLatestBatch: boolean;
  rowHighlight: string | null;
  totalArea: number;
};

export type BillingFloorLayerSection = {
  sectionTitle: string;
  rowType: string | null;
  floorNo: number;
  floorLabel: string | null;
  layerName: string | null;
  unit: string | null;
  hasLatestBatchRows: boolean;
  rows: BillingFloorLayerRow[];
  totals: {
    ceilingArea: number;
    wallArea: number;
    totalArea: number;
  };
};

export type BillingFloorLayerReport = {
  layerName: string | null;
  sectionCount: number;
  rowCount: number;
  sections: BillingFloorLayerSection[];
};

export type BoqCostingRow = {
  block: string | null;
  application: string | null;
  layer: string | null;
  area: number | null;
  materialName: string | null;
  clientRate: number | null;
  materialCost: number | null;
  totalAmount: number | null;
  expectedMaterialConsumption: number | null;
  expectedLabourHours: number | null;
  averageDailyWage: number | null;
  projectedProfit: number | null;
  currentStock: number | null;
};

async function handleResponse(response: Response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = Array.isArray(data?.message)
      ? data.message.join(', ')
      : data?.message || 'Request failed';

    throw new Error(message);
  }

  return data;
}

/* =========================================================
   AUTH APIs
========================================================= */

/**
 * Wakes the backend without waiting for an answer.
 *
 * On a host that puts an idle server to sleep (Render's free and starter
 * plans), the first request after a quiet period waits for the server to boot.
 * Calling this when the login page opens starts that boot while the user is
 * still typing, so the login request itself does not pay for it.
 */
export function wakeBackend(): void {
  try {
    void fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Never block or break the page over a warm-up request.
  }
}

export async function loginUser(username: string, password: string) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  return handleResponse(response) as Promise<LoginResponse>;
}

export async function fetchAdminUsers(token: string) {
  const response = await fetch(`${API_BASE_URL}/admin/users`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return handleResponse(response) as Promise<AdminUser[]>;
}

export async function createAdminUser(
  token: string,
  payload: CreateAdminUserPayload,
) {
  const response = await fetch(`${API_BASE_URL}/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return handleResponse(response) as Promise<{
    message: string;
    user: AdminUser;
  }>;
}

export async function fetchClientOverview(token: string) {
  const response = await fetch(`${API_BASE_URL}/client/overview`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return handleResponse(response) as Promise<ClientOverviewRow[]>;
}

export async function fetchClientBoq(token: string) {
  const response = await fetch(`${API_BASE_URL}/client/boq`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return handleResponse(response) as Promise<ClientBoqRow[]>;
}

export async function fetchClientWorkApproval(token: string) {
  const response = await fetch(`${API_BASE_URL}/client/work-approval`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return handleResponse(response) as Promise<ClientWorkApprovalState>;
}

export async function submitClientWorkApproval(
  token: string,
  approvals: SubmitClientWorkApprovalItem[],
) {
  const response = await fetch(`${API_BASE_URL}/client/work-approval`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ approvals }),
  });

  return handleResponse(response) as Promise<
    ClientWorkApprovalState & { message: string }
  >;
}

/* =========================================================
   PROJECTION APIs
========================================================= */


export async function fetchHomeLayerProgress(
  token: string,
  projectId: string,
) {
  const searchParams = new URLSearchParams({ projectId });

  const response = await fetch(
    `${API_BASE_URL}/projection/home-layer-progress?${searchParams.toString()}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return handleResponse(response) as Promise<IndrLayerProgressRow[]>;
}

export async function fetchProjectionLayers(
  token: string,
  params?: {
    projectId?: string;
    dailyPainters?: number;
    workMode?: string;
    limit?: number;
  },
) {
  const searchParams = new URLSearchParams();

  if (params?.projectId) {
    searchParams.set('projectId', params.projectId);
  }

  if (params?.dailyPainters) {
    searchParams.set('dailyPainters', String(params.dailyPainters));
  }

  if (params?.workMode) {
    searchParams.set('workMode', params.workMode);
  }

  if (params?.limit) {
    searchParams.set('limit', String(params.limit));
  }

  const queryString = searchParams.toString();

  const response = await fetch(
    `${API_BASE_URL}/projection/layers${queryString ? `?${queryString}` : ''}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return handleResponse(response) as Promise<ProjectionLayer[]>;
}

export async function fetchProjectionFlats(
  token: string,
  params?: {
    projectId?: string;
    limit?: number;
  },
) {
  const searchParams = new URLSearchParams();

  if (params?.projectId) {
    searchParams.set('projectId', params.projectId);
  }

  if (params?.limit) {
    searchParams.set('limit', String(params.limit));
  }

  const queryString = searchParams.toString();

  const response = await fetch(
    `${API_BASE_URL}/projection/flats${queryString ? `?${queryString}` : ''}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return handleResponse(response) as Promise<ProjectionFlat[]>;
}

export async function fetchFlatApplications(
  token: string,
  projectId?: string,
) {
  const flats = await fetchProjectionFlats(token, {
    projectId,
    limit: 5000,
  });

  return Array.from(
    new Set(
      flats
        .map((flat) => flat.Application)
        .filter((application): application is string => Boolean(application)),
    ),
  ).sort();
}

export async function createProjectionLayer(
  token: string,
  payload: Record<string, unknown>,
) {
  const response = await fetch(`${API_BASE_URL}/projection/layers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return handleResponse(response) as Promise<ProjectionLayer>;
}

export async function updateProjectionLayer(
  token: string,
  layerId: string,
  payload: Record<string, unknown>,
) {
  const response = await fetch(`${API_BASE_URL}/projection/layers/${layerId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return handleResponse(response) as Promise<ProjectionLayer>;
}

/* =========================================================
   BILLING APIs
========================================================= */

function getBillingPath(view: BillingDataViewId) {
  switch (view) {
    case 'billing-overall':
      return 'overall';

    case 'billing-pending':
      return 'pending';

    case 'billing-sent':
      return 'sent-for-approval';

    case 'billing-billed':
      return 'already-billed';

    case 'billing-latest':
      return 'latest';
  }
}

export async function fetchBillingRows(
  token: string,
  projectId: string,
  view: BillingDataViewId,
) {
  const path = getBillingPath(view);

  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/billing/${path}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return handleResponse(response) as Promise<BillingRow[]>;
}

export async function fetchBillingBatchView(
  token: string,
  projectId: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/billing/batch-view`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return handleResponse(response) as Promise<BillingBatchViewResponse>;
}

export async function fetchBillingInvoice(
  token: string,
  projectId: string,
  batchNo: number,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/billing/invoice?batchNo=${batchNo}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return handleResponse(response) as Promise<BillingInvoiceRow[]>;
}

export async function fetchBillingFloorLayerList(
  token: string,
  projectId: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/billing/floor-layer/layers`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return handleResponse(response) as Promise<BillingFloorLayerSummary[]>;
}

export async function fetchBillingFloorLayerReport(
  token: string,
  projectId: string,
  params?: {
    layerName?: string;
  },
) {
  const searchParams = new URLSearchParams();

  if (params?.layerName) {
    searchParams.set('layerName', params.layerName);
  }

  const queryString = searchParams.toString();

  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/billing/floor-layer/report${
      queryString ? `?${queryString}` : ''
    }`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return handleResponse(response) as Promise<BillingFloorLayerReport>;
}

/* =========================================================
   BOQ APIs
========================================================= */

export async function fetchBoqCosting(
  token: string,
  projectId: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/boq/costing`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return handleResponse(response) as Promise<BoqCostingRow[]>;
}
/** Read-only Work Order worksheet; separate from the existing Home costing API. */
export type WorkOrderWorksheetRow = {
  block: string | null;
  application: string | null;
  layer: string | null;
  area: number | null;
  flatCount: number | null;
  productivity: number | null;
  targetLabourDays: number | null;
  perLabourCost: number | null;
  labourCost: number | null;
  materialName: string | null;
  consumptionPct: number | null;
  materialCoverage: number | null;
  materialRatePerUnit: number | null;
  materialRequired: number | null;
  materialCostPerSft: number | null;
  materialCost: number | null;
  clientRate: number | null;
  revenue: number | null;
  margin: number | null;
};

export type WorkOrderWorksheetResponse = {
  projectId: string;
  source: 'project-costing' | 'legacy-boq-costing';
  areas: {
    application: string | null;
    block: string | null;
    area: number | null;
  }[];
  rows: WorkOrderWorksheetRow[];
};

export async function fetchWorkOrderWorksheet(token: string, projectId: string) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/boq/worksheet`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    },
  );
  return handleResponse(response) as Promise<WorkOrderWorksheetResponse>;
}

/* =========================================================
   ADMIN PROJECT SETUP APIs
========================================================= */

export type ProjectSetupProject = {
  projectId: string;
  projectName: string;
  createdAt: string;
};

export type ProjectSetupStatus = {
  projectId: string;
  layerCount: number;
  surfaceCount: number;
  flatAreaCount: number;
  boqCount: number;
  materialCount: number;
  productivityCount: number;
  costingCount: number;
};

export type ProjectSetupImportResult = {
  message: string;
  projectId: string;
  importedRows: number;
  boqRows?: number;
  materialRows?: number;
  productivityRows?: number;
  generatedRows?: number;
  flatAreaRows?: number;
};

export async function fetchProjectSetupProjects(token: string) {
  const response = await fetch(`${API_BASE_URL}/admin/project-setup/projects`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return handleResponse(response) as Promise<ProjectSetupProject[]>;
}

export async function createProjectSetupProject(
  token: string,
  payload: { projectId: string; projectName: string },
) {
  const response = await fetch(`${API_BASE_URL}/admin/project-setup/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return handleResponse(response) as Promise<ProjectSetupProject>;
}

export async function fetchProjectSetupStatus(
  token: string,
  projectId: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/admin/project-setup/projects/${encodeURIComponent(projectId)}/status`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return handleResponse(response) as Promise<ProjectSetupStatus>;
}

export async function importProjectSetupDataset(
  token: string,
  projectId: string,
  dataset: 'layers' | 'surfaces' | 'cost-boq',
  rows: Record<string, unknown>[],
) {
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([JSON.stringify(rows)], { type: 'application/json' }),
    `${dataset}.json`,
  );

  const response = await fetch(
    `${API_BASE_URL}/admin/project-setup/projects/${encodeURIComponent(projectId)}/import/${dataset}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    },
  );

  return handleResponse(response) as Promise<ProjectSetupImportResult>;
}