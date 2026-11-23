import type { BoqApplication, BoqLayer, BoqMaterial, BoqProject, CommercialField } from './preContractBoqApi';

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

// Keep these pure calculations synchronized with backend/src/pre-contract-boq/calculations.ts.
// They power immediate client-side previews; the server remains authoritative for persistence.

function existingLayers(project: BoqProject): BoqLayer[] {
  return project.applications.flatMap(app => app.layers);
}

function recalculate(
  project: BoqProject,
  layers: BoqLayer[],
  applicationCosts: { application: string; consumables_cost: number }[],
): BoqProject {
  const derived = calculateProject(layers, applicationCosts);
  const applications: BoqApplication[] = derived.applications.map(app => ({
    ...app,
    layers: app.layers.map(layer => ({ ...layer, remark: layer.remark ?? null })),
  }));
  return { ...project, applications, summary: derived.summary };
}

/** Pure, instantaneous preview of a layer PATCH. Uses identical formulas to the backend. */
export function previewLayerChange(
  project: BoqProject,
  layerId: string,
  patch: Record<string, unknown>,
  materials: BoqMaterial[],
): BoqProject {
  let located = false;
  const layers = existingLayers(project).map(row => {
    if (row.layer_id !== layerId) return row;
    located = true;
    const updated: BoqLayer = { ...row };
    if ('application' in patch) updated.application = String(patch.application).trim();
    if ('workLayer' in patch) updated.work_layer = String(patch.workLayer).trim();
    if ('surface' in patch) updated.surface = patch.surface as BoqLayer['surface'];
    if ('area' in patch) updated.area = Number(patch.area);
    if ('billable' in patch) {
      updated.billable = Boolean(patch.billable);
      if (!updated.billable) updated.revenue_amount = 0;
    }
    if ('areaPercentage' in patch) updated.area_percentage = Number(patch.areaPercentage);
    if ('productivity' in patch) updated.productivity = patch.productivity === null ? null : Number(patch.productivity);
    if ('perLaborCost' in patch) updated.per_labor_cost = patch.perLaborCost === null ? null : Number(patch.perLaborCost);
    if ('remark' in patch) updated.remark = patch.remark === null ? null : String(patch.remark);
    if ('materialId' in patch) {
      const id = patch.materialId;
      if (id === null || id === '') {
        updated.material_id = null;
        updated.material_source_project_id = null;
        updated.material_name = null;
        updated.material_rate = null;
        updated.material_coverage = null;
      } else {
        const material = materials.find(item => item.materialId === id);
        if (!material) throw new Error('The selected material is not in the Material Master list. Reload and try again.');
        updated.material_id = material.materialId;
        updated.material_source_project_id = material.sourceProjectId;
        updated.material_name = material.materialName;
        updated.material_rate = material.rate;
        updated.material_coverage = material.coverage;
      }
    }
    return updated;
  });
  if (!located) throw new Error('BOQ layer could not be found. Reload and try again.');
  const applicationCosts = project.applications.map(app => ({
    application: app.application,
    consumables_cost: app.consumablesCost,
  }));
  for (const layer of layers) {
    if (!applicationCosts.some(app => app.application === layer.application)) {
      applicationCosts.push({ application: layer.application, consumables_cost: 0 });
    }
  }
  return recalculate(project, layers, applicationCosts);
}

export function previewLayerPricing(
  project: BoqProject, layerId: string, field: CommercialField, value: number,
): BoqProject {
  const layer = existingLayers(project).find(row => row.layer_id === layerId);
  if (!layer) throw new Error('BOQ layer could not be found.');
  if (!layer.billable) throw new Error('Only billable layers may have client pricing.');
  const revenue = targetRevenue(field, value, layer.totalCost, layer.effectiveArea);
  return recalculate(project, existingLayers(project).map(row => row.layer_id === layerId
    ? { ...row, revenue_amount: revenue }
    : row), project.applications.map(app => ({ application: app.application, consumables_cost: app.consumablesCost })));
}

export function previewApplicationPricing(
  project: BoqProject, application: string, field: CommercialField, value: number,
): BoqProject {
  const app = project.applications.find(row => row.application === application);
  if (!app) throw new Error('BOQ application could not be found.');
  const totalRevenue = targetRevenue(field, value, app.totalCost, app.billableArea);
  const assigned = new Map(distributeRevenue(app.layers, totalRevenue).map(item => [item.layerId, item.revenue]));
  const nextLayers = existingLayers(project).map(row => assigned.has(row.layer_id)
    ? { ...row, revenue_amount: assigned.get(row.layer_id)! }
    : row);
  return recalculate(project, nextLayers, project.applications.map(row => ({
    application: row.application, consumables_cost: row.consumablesCost,
  })));
}

export function previewConsumables(project: BoqProject, application: string, cost: number): BoqProject {
  return recalculate(project, existingLayers(project), project.applications.map(app => ({
    application: app.application,
    consumables_cost: app.application === application ? cost : app.consumablesCost,
  })));
}