/** Pure BOQ calculations. All money is in INR, area in sqft, productivity in sqft/labour-day. */
export interface LayerInput {
  project_id: string;
  layer_id: string;
  application: string;
  work_layer: string;
  surface: 'Ceiling' | 'Wall' | 'Both';
  area: number | string;
  billable: boolean;
  area_percentage: number | string;
  productivity: number | string | null;
  per_labor_cost: number | string | null;
  material_id: string | null;
  material_source_project_id: string | null;
  material_name: string | null;
  material_rate: number | string | null;
  material_coverage: number | string | null;
  revenue_amount: number | string;
  source: 'import' | 'manual';
  remark?: string | null;
  sort_order: number | string;
}
export interface ApplicationInput {
  application: string;
  consumables_cost: number | string;
}
export type PricingField = 'margin' | 'rate' | 'revenue' | 'profit';

const num = (n: number | string | null | undefined) => n == null ? 0 : Number(n);
const round = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export function calculateLayer(row: LayerInput) {
  const area = num(row.area);
  const percentage = num(row.area_percentage);
  const effectiveArea = round(area * percentage / 100);
  const productivity = num(row.productivity);
  const perLaborCost = num(row.per_labor_cost);
  const labourDays = productivity > 0 ? effectiveArea / productivity : 0;
  const labourHours = labourDays * 8;
  const labourCost = labourDays * perLaborCost;
  const coverage = num(row.material_coverage);
  const materialRequired = coverage > 0 ? effectiveArea / coverage : 0;
  const materialCost = materialRequired * num(row.material_rate);
  const totalCost = labourCost + materialCost;
  const revenue = row.billable ? num(row.revenue_amount) : 0;
  const profit = revenue - totalCost;
  const clientRate = row.billable && effectiveArea > 0 ? revenue / effectiveArea : null;
  const profitMargin = row.billable && revenue > 0 ? profit / revenue * 100 : null;
  const missingInputs: string[] = [];
  if (effectiveArea > 0 && productivity <= 0) missingInputs.push('Productivity');
  if (effectiveArea > 0 && row.per_labor_cost == null) missingInputs.push('Per Labour Cost');
  if (effectiveArea > 0 && !row.material_name) missingInputs.push('Material');
  if (effectiveArea > 0 && row.material_name && coverage <= 0) missingInputs.push('Material Coverage');
  if (effectiveArea > 0 && row.material_name && row.material_rate == null) missingInputs.push('Material Rate');
  return {
    ...row,
    area, area_percentage: percentage, productivity: row.productivity == null ? null : productivity,
    per_labor_cost: row.per_labor_cost == null ? null : perLaborCost,
    material_rate: row.material_rate == null ? null : num(row.material_rate),
    material_coverage: row.material_coverage == null ? null : coverage,
    sort_order: num(row.sort_order), revenue_amount: num(row.revenue_amount),
    effectiveArea: round(effectiveArea), labourHours: round(labourHours), labourDays: round(labourDays),
    labourCost: round(labourCost), materialRequired: round(materialRequired),
    materialCost: round(materialCost), totalCost: round(totalCost),
    clientRate: clientRate == null ? null : round(clientRate),
    revenue: round(revenue), profit: round(profit),
    profitMargin: profitMargin == null ? null : round(profitMargin), missingInputs,
  };
}

export type ComputedLayer = ReturnType<typeof calculateLayer>;

export function calculateProject(layers: LayerInput[], apps: ApplicationInput[]) {
  const byApp = new Map<string, ComputedLayer[]>();
  for (const app of apps) byApp.set(app.application, []);
  for (const layer of layers) {
    const bucket = byApp.get(layer.application) || [];
    bucket.push(calculateLayer(layer));
    byApp.set(layer.application, bucket);
  }
  const applications = [...byApp.entries()].map(([application, rows]) => {
    const appMeta = apps.find(a => a.application === application);
    const consumablesCost = num(appMeta?.consumables_cost);
    const effectiveWorkArea = rows.reduce((s, r) => s + r.effectiveArea, 0);
    const labourHours = rows.reduce((s, r) => s + r.labourHours, 0);
    const labourDays = rows.reduce((s, r) => s + r.labourDays, 0);
    const labourCost = rows.reduce((s, r) => s + r.labourCost, 0);
    const materialCost = rows.reduce((s, r) => s + r.materialCost, 0);
    const totalCost = labourCost + materialCost + consumablesCost;
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const profit = revenue - totalCost;
    const billableArea = rows.filter(r => r.billable).reduce((s,r) => s+r.effectiveArea,0);
    const missingInputs = rows.filter(r => r.missingInputs.length > 0).length;
    return {
      application, consumablesCost: round(consumablesCost),
      effectiveWorkArea: round(effectiveWorkArea), labourHours: round(labourHours),
      labourDays: round(labourDays), labourCost: round(labourCost),
      materialCost: round(materialCost), totalCost: round(totalCost), revenue: round(revenue),
      profit: round(profit), profitMargin: revenue > 0 ? round(profit / revenue * 100) : null,
      clientRate: billableArea > 0 ? round(revenue / billableArea) : null,
      billableArea: round(billableArea),
      layerCount: rows.length, incompleteLayerCount: missingInputs,
      layers: rows.sort((a,b) => num(a.sort_order)-num(b.sort_order)),
    };
  }).sort((a,b) => a.application.localeCompare(b.application));
  const cost = applications.reduce((s,a) => s+a.totalCost,0);
  const revenue = applications.reduce((s,a) => s+a.revenue,0);
  const profit = revenue-cost;
  return {
    applications,
    summary: {
      totalCost: round(cost), revenue: round(revenue), profit: round(profit),
      profitMargin: revenue > 0 ? round(profit/revenue*100) : null,
      applicationCount: applications.length, layerCount: layers.length,
      incompleteLayerCount: applications.reduce((s,a) => s+a.incompleteLayerCount,0),
    },
  };
}

/** Derive desired revenue from the last edited commercial field (no circular math). */
export function targetRevenue(
  field: PricingField,
  value: number,
  cost: number,
  billableArea: number,
): number {
  if (!Number.isFinite(value)) throw Error('Enter a valid finite number');
  let revenue: number;
  switch (field) {
    case 'margin':
      if (value >= 100) throw Error('Profit margin must be below 100%');
      revenue = cost / (1-value/100);
      break;
    case 'rate':
      if (value < 0) throw Error('Client rate must not be negative');
      if (billableArea <= 0) throw Error('No positive effective billable area for client rate');
      revenue = value*billableArea;
      break;
    case 'revenue':
      revenue = value;
      break;
    case 'profit':
      revenue = cost+value;
      break;
  }
  if (!Number.isFinite(revenue) || revenue < 0) throw Error('This value implies an invalid negative revenue');
  return round(revenue);
}

/** Proportional to *direct billable layer cost*; non-billable+consumables recovered via billable revenue. */
export function distributeRevenue(billableRows: ComputedLayer[], revenue: number) {
  const rows = billableRows.filter(r => r.billable);
  if (!rows.length) throw Error('No billable layers in the application');
  const costBasis = rows.reduce((s,r)=>s+r.totalCost,0);
  if (costBasis <= 0) throw Error('Billable layers must have positive direct cost before proportional pricing');
  if (revenue > 0 && rows.some(r=>r.effectiveArea<=0 && r.totalCost>0)) {
    throw Error('A billable layer has zero effective area; fix its area before allocating client rates');
  }
  let allocated = 0;
  return rows.map((r,i)=>{
    const share = i===rows.length-1 ? round(revenue - allocated) : round(revenue*r.totalCost/costBasis);
    allocated += share;
    return {layerId:r.layer_id, revenue: share};
  });
}