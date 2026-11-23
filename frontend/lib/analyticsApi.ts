const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

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

export type FilterRelationOption = {
  block: string;
  application: string;
  flat: string;
  workLayer: string;
};

export type BlockApplicationRelation = {
  block: string;
  application: string;
};

export type ApplicationFlatRelation = {
  block: string;
  application: string;
  flat: string;
};

export type ApplicationLayerRelation = {
  block: string;
  application: string;
  workLayer: string;
};

export type AnalyticsSection =
  | 'executive'
  | 'flats'
  | 'trend'
  | 'flat-detail'
  | 'targets'
  | 'timeline'
  | 'pl'
  | 'productivity'
  | 'cost'
  | 'budget'
  | 'all';

export type AnalyticsOptions = {
  applications: string[];
  blocks: string[];
  flats: string[];
  workLayers: string[];
  filterRelations?: FilterRelationOption[];
  blockApplicationRelations?: BlockApplicationRelation[];
  applicationFlatRelations?: ApplicationFlatRelation[];
  applicationLayerRelations?: ApplicationLayerRelation[];
  profitability: string[];
  billing: string[];
};

export type ExecutiveSummaryFilters = {
  application?: string;
  flat?: string;
  block?: string;
  workLayer?: string;
  from?: string;
  to?: string;
  profitability?: string;
  billing?: string;
  search?: string;
};

export type TargetLabourMetrics = {
  bookedDays: number;
  targetDays: number;
  vsTarget: number;
  targetUsePct: number;
};

export type ApplicationSummaryRow = TargetLabourMetrics & {
  application: string;
  flats: number;
  entries: number;
  targetPerFlat: number;
  targetBooked: number;
  actualBooked: number;
  bookedVsTarget: number;
  bookedTargetUsePct: number;
  untargetedDays: number;
  untargetedLayers: number;
  targetedLabourRate: number;
  labourValueGap: number;
  labourDays: number;
  area: number;
  labour: number;
  material: number;
  revenue: number;
  netProfit: number;
  margin: number;
  productivity: number;
  profitPerSqft: number;
};

export type FlatDetailRow = TargetLabourMetrics & {
  workDate: string;
  materialNames?: string;
  workLayer: string;
  layerOrder: number;
  isBillable: boolean;
  area: number;
  labourDays: number;
  entries: number;
  labour: number;
  material: number;
  revenue: number;
  profit: number;
  margin: number;
  productivity: number;
};

export type FlatSummaryRow = TargetLabourMetrics & {
  application: string;
  flatId: string;
  targetPerFlat: number;
  targetBooked: number;
  actualBooked: number;
  bookedVsTarget: number;
  bookedTargetUsePct: number;
  untargetedDays: number;
  untargetedLayers: number;
  targetedLabourRate: number;
  labourValueGap: number;
  bookedLayers: number;
  entries: number;
  entryCount: number;
  totalLayers: number;
  labourDays: number;
  area: number;
  labour: number;
  material: number;
  revenue: number;
  netProfit: number;
  margin: number;
  productivity: number;
  profitPerSqft: number;
  details: FlatDetailRow[];
};

export type DailyProfitTrendRow = TargetLabourMetrics & {
  workDate: string;
  profit: number;
  labourDays: number;
  revenue: number;
  labour: number;
  material: number;
};

export type DateTimelineEntryRow = TargetLabourMetrics & {
  flatId: string;
  materialNames: string;
  workLayer: string;
  layerOrder: number;
  isBillable: boolean;
  area: number;
  labourDays: number;
  entries: number;
  labour: number;
  material: number;
  materialUsed: number;
  revenue: number;
  profit: number;
  productivity: number;
};

export type DateTimelineApplicationRow = TargetLabourMetrics & {
  application: string;
  flats: number;
  layers: number;
  area: number;
  labourDays: number;
  entryCount: number;
  labour: number;
  material: number;
  materialUsed: number;
  revenue: number;
  profit: number;
  productivity: number;
  entries: DateTimelineEntryRow[];
};

export type DateTimelineRow = TargetLabourMetrics & {
  workDate: string;
  flats: number;
  layers: number;
  area: number;
  labourDays: number;
  entryCount: number;
  labour: number;
  material: number;
  materialUsed: number;
  revenue: number;
  profit: number;
  productivity: number;
  applications: DateTimelineApplicationRow[];
};

export type CostStructureSummary = {
  areaBearingEntries: number;
  area: number;
  revenuePerSqft: number;
  labourPerSqft: number;
  materialPerSqft: number;
  totalCostPerSqft: number;
  profitPerSqft: number;
  nonBillableCost: number;
};

export type CostDistributionByApplicationRow = TargetLabourMetrics & {
  application: string;
  labour: number;
  material: number;
  profit: number;
  costAboveRevenue: number;
  revenue: number;
  reportedLabourDays: number;
  entries: number;
};

export type CostDrillDownLayerRow = TargetLabourMetrics & {
  application: string;
  flatId: string;
  workLayer: string;
  layerOrder: number;
  isBillable: boolean;
  entries: number;
  area: number;
  labourDays: number;
  labour: number;
  material: number;
  revenue: number;
  profit: number;
  labourPerSqft: number;
  materialPerSqft: number;
  costPerSqft: number;
  revenuePerSqft: number;
  profitPerSqft: number;
};

export type CostGroupedRow = TargetLabourMetrics & {
  workLayer: string;
  layerOrder: number;
  entries: number;
  flats: number;
  area: number;
  labourDays: number;
  labour: number;
  material: number;
  revenue: number;
  profit: number;
  totalCost: number;
  percentOfRevenue: number;
};

export type CostAnalysisResponse = {
  structure: CostStructureSummary;
  distributionByApplication: CostDistributionByApplicationRow[];
  drillDownRows: CostDrillDownLayerRow[];
  nonBillableOperationalWork: CostGroupedRow[];
  activitiesWithoutMeasurableArea: CostGroupedRow[];
};

export type BudgetCostControlApplicationRow = {
  application: string;
  flats: number;
  budgetArea: number;
  progressPct: number;
  expectedProgressPct: number;
  // Backward-compatible alias used by older UI code. Same as progressPct.
  progress: number;
  budgetCost: number;
  expectedCost: number;
  actualCost: number;
  variance: number;
  varPct: number;
  budgetDays: number;
  expectedDays: number;
  actualDays: number;
  budgetMaterial: number;
  expectedMaterial: number;
  actualMaterial: number;
  entries: number;
  status: string;
};

export type BudgetCostControlFlatLayerRow = {
  application: string;
  flatId: string;
  block: string;
  workLayer: string;
  layerOrder: number;
  isBillable: boolean;
  budgetArea: number;
  layerProgressPct: number;
  flatProgressPct: number;
  expectedProgressPct: number;
  // Backward-compatible aliases used by older UI code.
  // progress = layerProgressPct, flatProgress = flatProgressPct.
  progress: number;
  flatProgress: number;
  isRunningFlat: boolean;
  materialNames: string;
  budgetMaterialQty: number;
  budgetMaterial: number;
  budgetDays: number;
  budgetLabour: number;
  budgetCost: number;
  expectedMaterialQty: number;
  expectedMaterial: number;
  expectedDays: number;
  expectedLabour: number;
  expectedCost: number;
  actualMaterial: number;
  actualLabour: number;
  actualCost: number;
  actualDays: number;
  actualArea: number;
  actualMaterialQty: number;
  budgetRevenue: number;
  expectedRevenue: number;
  actualRevenue: number;
  materialCoverage: number;
  materialRatePerUnit: number;
  entries: number;
  variance: number;
  varPct: number;
  status: string;
};

export type BudgetTrendRow = {
  workDate: string;
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
};

export type BudgetCostControlResponse = {
  applicationSummary: BudgetCostControlApplicationRow[];
  flatDrilldownRows: BudgetCostControlFlatLayerRow[];
  trendRows: BudgetTrendRow[];
};


export type TrendAnalysisCell = {
  month: string;
  application: string;
  block: string;
  flatId: string;
  workLayer: string;
  materialName: string;
  layerOrder: number;
  productivityArea: number;
  labourDays: number;
  coverageArea: number;
  materialUsed: number;
  targetProductivity: number;
  targetCoverage: number;
};

export type TrendAnalysisResponse = {
  availableMonths: string[];
  rows: TrendAnalysisCell[];
};

export type ExecutiveSummaryResponse = {
  recordCount: number;
  kpis: {
    applications: number;
    flatsWorked: number;
    totalArea: number;
    executedArea: number;
    clientValue: number;
    labourCost: number;
    materialCost: number;
    netProfit: number;
    profitMargin: number;
    productivity: number;
    labourDays: number;
    flatsInProfit: number;
    flatsInLoss: number;
    nonBillableOperationalWork: number;
    nonBillableEntries: number;
    flatsBelow50Productivity: number;
    flatsBelow60Productivity: number;
    flatsWithLayersToBook: number;
    targetBookedDays: number;
    actualBookedTargetedDays: number;
    bookedVsTarget: number;
    bookedTargetUsePct: number;
    untargetedDays: number;
    labourValueGap: number;
  };
  applicationSummary: ApplicationSummaryRow[];
  flatSummary: FlatSummaryRow[];
  dailyProfitTrend: DailyProfitTrendRow[];
  dateTimeline: DateTimelineRow[];
  trendAnalysis?: TrendAnalysisResponse;
  costAnalysis?: CostAnalysisResponse;
  budgetCostControl?: BudgetCostControlResponse;
};


export type AnalyticsReportRow = {
  id: string;
  projectId: string;
  block: string;
  application: string;
  flatId: string;
  workLayer: string;
  workDate: string;
  area: number;
  labourDays: number;
  labourCost: number;
  materialCost: number;
  revenue: number;
  profit: number;
  workStatus: string;
  materialName: string;
  materialUsed: number;
  isBillable: boolean;
  layerOrder: number;
  painterNames: string;
  workingHours: number;
  remark: string;
  reviewStatus: string;
  reviewComment: string;
  reviewedBy: string;
  reviewedAt: string | null;
  targetDays: number;
  targetProductivity: number;
  targetCoverage: number;
  materialRate: number;
  flatArea: number;
};

export type AnalyticsReportResponse = {
  recordCount: number;
  rows: AnalyticsReportRow[];
};


export type EntryReviewStatus = 'open' | 'approved' | 'rejected';

export type EntryReviewFilters = {
  dates?: string;
  painters?: string;
  workLayers?: string;
  workStatuses?: string;
  reviewStatus?: '' | 'open' | 'approved' | 'rejected' | 'commented';
};

export type EntryReviewRow = {
  id: string;
  projectId: string;
  block: string;
  application: string;
  flat: string;
  workLayer: string;
  workDate: string;
  wallNames: string;
  area: number;
  painterNames: string;
  painterCount: number;
  machineOrManual: string;
  workingHours: number;
  workStatus: string;
  materialName: string;
  materialUsed: number;
  remark: string;
  layerId: string;
  labourDays: number;
  productivity: number;
  coverage: number;
  targetProductivity: number;
  targetCoverage: number;
  productivityDeviationPct: number | null;
  coverageDeviationPct: number | null;
  labourCost: number;
  materialCost: number;
  layerOrder: number;
  reviewStatus: EntryReviewStatus;
  reviewComment: string;
  reviewedBy: string;
  reviewedAt: string | null;
};

export type EntryReviewPainterReportRow = {
  painter: string;
  entries: number;
  daysOnSite: number;
  workingHours: number;
  labourDays: number;
  area: number;
  productivity: number;
  sqftPerHour: number;
  labourCost: number;
  layers: number;
  flats: number;
  firstDate: string;
  lastDate: string;
  layerList: string[];
  applications: string[];
  topLayer: string;
  topShare: number;
  layerBreakdown: Array<{
    workLayer: string;
    area: number;
    labourDays: number;
    workingHours: number;
    entries: number;
    flats: number;
  }>;
  dayBreakdown: Array<{
    workDate: string;
    area: number;
    labourDays: number;
    workingHours: number;
    entries: number;
    flats: number;
    layers: number;
  }>;
};

export type EntryReviewResponse = {
  summary: {
    entriesInView: number;
    checked: number;
    approved: number;
    rejected: number;
    withComment: number;
    painters: number;
    workingHours: number;
    daysCovered: number;
  };
  options: {
    dates: string[];
    painters: string[];
    workLayers: string[];
    workStatuses: string[];
    reviewStatuses: string[];
  };
  rows: EntryReviewRow[];
  painterReport: EntryReviewPainterReportRow[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
};

export type UpdateEntryReviewPayload = {
  status?: EntryReviewStatus;
  comment?: string | null;
};

export type EntryReviewMutationResponse = {
  backendId: string;
  reviewStatus: EntryReviewStatus;
  reviewComment: string;
  reviewedBy: string;
  reviewedAt: string | null;
};

function buildQuery(params: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    const text = String(value || '').trim();
    if (text && text !== 'all') searchParams.set(key, text);
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export async function fetchAnalyticsOptions(token: string, projectId: string) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/analytics/options`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return handleResponse(response) as Promise<AnalyticsOptions>;
}

export async function fetchExecutiveSummary(
  token: string,
  projectId: string,
  filters: ExecutiveSummaryFilters,
  section: AnalyticsSection = 'all',
) {
  // Keep the existing working GET/CORS path.
  // Only the active Analytics section is calculated and returned.
  const params = new URLSearchParams();
  params.set('filters', JSON.stringify(filters || {}));
  params.set('section', section);
  params.set('_ts', String(Date.now()));

  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/analytics/executive-summary?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return handleResponse(response) as Promise<ExecutiveSummaryResponse>;
}


export async function fetchAnalyticsReport(
  token: string,
  projectId: string,
  filters: ExecutiveSummaryFilters,
) {
  const params = new URLSearchParams();
  params.set('filters', JSON.stringify(filters || {}));
  params.set('_ts', String(Date.now()));

  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/analytics/report?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return handleResponse(response) as Promise<AnalyticsReportResponse>;
}


export async function fetchEntryReview(
  token: string,
  projectId: string,
  filters: ExecutiveSummaryFilters,
  reviewFilters: EntryReviewFilters = {},
  limit = 400,
  offset = 0,
) {
  const params = new URLSearchParams();
  params.set('filters', JSON.stringify(filters || {}));
  params.set('reviewFilters', JSON.stringify(reviewFilters || {}));
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  params.set('_ts', String(Date.now()));

  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/analytics/entry-review?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return handleResponse(response) as Promise<EntryReviewResponse>;
}

export async function updateEntryReview(
  token: string,
  projectId: string,
  backendId: string,
  payload: UpdateEntryReviewPayload,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/analytics/entry-review/${encodeURIComponent(backendId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
    },
  );

  return handleResponse(response) as Promise<EntryReviewMutationResponse>;
}

export async function clearEntryReview(
  token: string,
  projectId: string,
  backendId: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/analytics/entry-review/${encodeURIComponent(backendId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return handleResponse(response) as Promise<EntryReviewMutationResponse>;
}

export async function refreshAnalytics(token: string, projectId: string) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${projectId}/analytics/refresh`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return handleResponse(response) as Promise<{
    success: boolean;
    message?: string;
    refreshedAt?: string;
    refreshed_at?: string;
  }>;
}