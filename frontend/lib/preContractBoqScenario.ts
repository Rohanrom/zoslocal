import { calculateProject as calculateProjectForPreview } from './preContractBoqLocal';
import type { BoqApplication, BoqLayer, BoqProject, BoqScenarioChanges } from './preContractBoqApi';

const round4 = (n:number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
export type PreviewApplication = Pick<BoqApplication,
 'application' | 'consumablesCost' | 'labourCost' | 'materialCost' | 'totalCost' | 'revenue' | 'profit' | 'profitMargin' | 'incompleteLayerCount'
>;
export type PreviewSummary = {
 applications: PreviewApplication[];
 totalCost:number;revenue:number;profit:number;profitMargin:number|null;
 labourCost:number;materialCost:number;consumablesCost:number;incompleteLayerCount:number;
};

/** Pure, local scenario preview. Sliders DO NOT write anything to the DB. */
export function simulateBoq(project:BoqProject, scenario:BoqScenarioChanges):PreviewSummary {
  const affects = (application:string) => !scenario.application || application === scenario.application;
  const factor = (percent:number) => 1+percent/100;
  const applications = project.applications.map((app):PreviewApplication=>{
    if (!affects(app.application)) return {
      application:app.application,consumablesCost:app.consumablesCost,
      labourCost:app.labourCost,materialCost:app.materialCost,totalCost:app.totalCost,
      revenue:app.revenue,profit:app.profit,profitMargin:app.profitMargin,
      incompleteLayerCount:app.incompleteLayerCount,
    };
    const pieces=app.layers.map((layer:BoqLayer)=>{
      // Match stored NUMERIC(18,4) precision before calculating costs.
      const productivity=layer.productivity==null?null:round4(layer.productivity*factor(scenario.productivityPercent));
      const perLabour=layer.per_labor_cost==null?null:round4(layer.per_labor_cost*factor(scenario.labourRatePercent));
      const matRate=layer.material_rate==null?null:round4(layer.material_rate*factor(scenario.materialRatePercent));
      const hours=productivity && productivity>0?layer.effectiveArea/productivity:0;
      return {
        labourCost:round4(hours*(perLabour||0)),
        materialCost:round4(layer.material_coverage&&layer.material_coverage>0?layer.effectiveArea/layer.material_coverage*(matRate||0):0),
        revenue:layer.billable?round4(layer.revenue_amount*factor(scenario.clientRatePercent)):0,
      };
    });
    const labourCost=round4(pieces.reduce((sum,p)=>sum+p.labourCost,0));
    const materialCost=round4(pieces.reduce((sum,p)=>sum+p.materialCost,0));
    const totalCost=round4(labourCost+materialCost+app.consumablesCost);
    const revenue=round4(pieces.reduce((sum,p)=>sum+p.revenue,0));
    const profit=round4(revenue-totalCost);
    return {application:app.application,consumablesCost:app.consumablesCost,labourCost,materialCost,totalCost,revenue,profit,
      profitMargin:revenue>0?round4(profit/revenue*100):null,incompleteLayerCount:app.incompleteLayerCount};
  });
  const labourCost=round4(applications.reduce((n,a)=>n+a.labourCost,0));
  const materialCost=round4(applications.reduce((n,a)=>n+a.materialCost,0));
  const consumablesCost=round4(applications.reduce((n,a)=>n+a.consumablesCost,0));
  const totalCost=round4(applications.reduce((n,a)=>n+a.totalCost,0));
  const revenue=round4(applications.reduce((n,a)=>n+a.revenue,0));
  const profit=round4(revenue-totalCost);
  return {applications,totalCost,revenue,profit,profitMargin:revenue>0?round4(profit/revenue*100):null,
    labourCost,materialCost,consumablesCost,
    incompleteLayerCount:applications.reduce((n,a)=>n+a.incompleteLayerCount,0)};
}
/**
 * Layer-specific Analysis preview. Rates and productivity are changed ONLY on
 * explicitly edited layers. Existing per-labour costs, material snapshots,
 * effective areas, billability and consumables remain unchanged.
 * No API calls or database writes are performed here.
 */
export type LayerScenarioOverride = {
  productivity?: number;
  clientRate?: number;
};

export function simulateLayerEdits(
  project: BoqProject,
  overrides: Record<string, LayerScenarioOverride>,
): PreviewSummary {
  const rawLayers = project.applications.flatMap(app => app.layers.map(layer => {
    const change = overrides[layer.layer_id];
    if (!change) return layer;
    const nextProductivity = change.productivity === undefined
      ? layer.productivity
      : round4(change.productivity);
    const nextRevenue = change.clientRate === undefined
      ? layer.revenue_amount
      : layer.billable
        ? round4(change.clientRate * layer.effectiveArea)
        : 0;
    return {
      ...layer,
      productivity: nextProductivity,
      revenue_amount: nextRevenue,
    };
  }));
  const apps = project.applications.map(app => ({
    application: app.application,
    consumables_cost: app.consumablesCost,
  }));
  const derived = calculateProjectForPreview(rawLayers, apps);
  const applications: PreviewApplication[] = derived.applications.map(app => ({
    application: app.application,
    consumablesCost: app.consumablesCost,
    labourCost: app.labourCost,
    materialCost: app.materialCost,
    totalCost: app.totalCost,
    revenue: app.revenue,
    profit: app.profit,
    profitMargin: app.profitMargin,
    incompleteLayerCount: app.incompleteLayerCount,
  }));
  return {
    applications,
    totalCost: derived.summary.totalCost,
    revenue: derived.summary.revenue,
    profit: derived.summary.profit,
    profitMargin: derived.summary.profitMargin,
    labourCost: round4(applications.reduce((s,a)=>s+a.labourCost,0)),
    materialCost: round4(applications.reduce((s,a)=>s+a.materialCost,0)),
    consumablesCost: round4(applications.reduce((s,a)=>s+a.consumablesCost,0)),
    incompleteLayerCount: derived.summary.incompleteLayerCount,
  };
}