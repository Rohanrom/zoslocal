const ROOT = `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000'}/pre-contract-boq`;
export type CommercialField = 'margin' | 'rate' | 'revenue' | 'profit';
export type BoqSurface = 'Ceiling'|'Wall'|'Both';
export type BoqProjectListItem = {
  projectId:string; projectName:string; createdAt:string; updatedAt:string;
  layerCount:number;applicationCount:number;
};
export type BoqMaterial = {
  materialId:string;sourceProjectId:string;materialName:string;
  application:string|null;workLayer:string|null;coverage:number|null;rate:number|null;
};
export type BoqLayer = {
  project_id:string;layer_id:string;application:string;work_layer:string;surface:BoqSurface;
  area:number;billable:boolean;area_percentage:number;productivity:number|null;
  per_labor_cost:number|null;material_id:string|null;material_source_project_id:string|null;
  material_name:string|null;material_rate:number|null;material_coverage:number|null;
  revenue_amount:number;source:'import'|'manual';sort_order:number;remark:string|null;
  effectiveArea:number;labourHours:number;labourDays:number;labourCost:number;
  materialRequired:number;materialCost:number;totalCost:number;clientRate:number|null;
  revenue:number;profit:number;profitMargin:number|null;missingInputs:string[];
};
export type BoqApplication = {
  application:string;consumablesCost:number;effectiveWorkArea:number;labourHours:number;
  labourDays:number;labourCost:number;materialCost:number;
  totalCost:number;revenue:number;profit:number;profitMargin:number|null;
  clientRate:number|null;billableArea:number;layerCount:number;incompleteLayerCount:number;
  layers:BoqLayer[];
};
export type BoqProject = {
  projectId:string;projectName:string;createdAt:string;updatedAt:string;
  applications:BoqApplication[];
  summary:{totalCost:number;revenue:number;profit:number;profitMargin:number|null;
    applicationCount:number;layerCount:number;incompleteLayerCount:number;};
};
export type BoqScenarioChanges = {
  application:string|null;
  labourRatePercent:number;
  materialRatePercent:number;
  productivityPercent:number;
  clientRatePercent:number;
};
export type BoqLayerAnalysisChange = {
  layerId:string;
  expectedProductivity:number|null;
  expectedRevenueAmount:number;
  productivity?:number;
  clientRate?:number;
};
export type LayerForm = {
  application:string;workLayer:string;surface:BoqSurface;area:number;billable:boolean;
  areaPercentage:number;productivity:number|null;perLaborCost:number|null;remark?:string|null;
};
async function req<T>(token:string,path:string,init:RequestInit={}):Promise<T> {
  const response=await fetch(`${ROOT}${path}`,{
    ...init, headers:{Authorization:`Bearer ${token}`,...(!(init.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...init.headers},
    cache:'no-store',
  });
  const data:unknown=await response.json().catch(()=>({}));
  if(!response.ok){
    const body=data as {message?:string|string[]};
    throw new Error(Array.isArray(body.message)?body.message.join(', '):body.message||`Request failed (${response.status})`);
  }
  return data as T;
}
const enc = encodeURIComponent;
export const preContractBoqApi = {
  list:(t:string)=>req<BoqProjectListItem[]>(t,'/projects'),
  create:(t:string,projectName:string)=>req<{projectId:string;projectName:string}>(t,'/projects',{method:'POST',body:JSON.stringify({projectName})}),
  delete:(t:string,id:string)=>req<{deleted:boolean}>(t,`/projects/${enc(id)}`,{method:'DELETE'}),
  get:(t:string,id:string)=>req<BoqProject>(t,`/projects/${enc(id)}`),
  materials:(t:string)=>req<BoqMaterial[]>(t,'/materials'),
  import:(t:string,id:string,file:File)=>{
    const body=new FormData();body.append('file',file);
    return req<{imported:number;replacedImported:number;manualLayersPreserved:boolean}>(t,`/projects/${enc(id)}/import`,{method:'POST',body});
  },
  addLayer:(t:string,id:string,row:LayerForm)=>req<{layerId:string}>(t,`/projects/${enc(id)}/layers`,{method:'POST',body:JSON.stringify(row)}),
  updateLayer:(t:string,id:string,layerId:string,data:Record<string,unknown>)=>req<{updated:boolean}>(t,`/projects/${enc(id)}/layers/${enc(layerId)}`,{method:'PATCH',body:JSON.stringify(data)}),
  deleteLayer:(t:string,id:string,layerId:string)=>req<{deleted:boolean}>(t,`/projects/${enc(id)}/layers/${enc(layerId)}`,{method:'DELETE'}),
  setLayerPricing:(t:string,id:string,layerId:string,field:CommercialField,value:number)=>req<{updated:boolean}>(t,`/projects/${enc(id)}/layers/${enc(layerId)}/pricing`,{method:'PATCH',body:JSON.stringify({field,value})}),
  consumables:(t:string,id:string,app:string,cost:number)=>req<{updated:boolean}>(t,`/projects/${enc(id)}/applications/${enc(app)}/consumables`,{method:'PATCH',body:JSON.stringify({cost})}),
  setAppPricing:(t:string,id:string,app:string,field:CommercialField,value:number)=>req<{updated:boolean}>(t,`/projects/${enc(id)}/applications/${enc(app)}/pricing`,{method:'PATCH',body:JSON.stringify({field,value})}),
  bulkMaterials:(t:string,id:string,materialId:string,applications:string[],workLayers:string[])=>
    req<{updatedLayerCount:number;materialName:string}>(t,`/projects/${enc(id)}/materials/bulk`,{
      method:'PATCH',body:JSON.stringify({materialId,applications,workLayers}),
    }),
  applyLayerAnalysis:(t:string,id:string,changes:BoqLayerAnalysisChange[])=>
    req<{updatedLayerCount:number}>(t,`/projects/${enc(id)}/analysis/layers`,{
      method:'PATCH',body:JSON.stringify({changes}),
    }),
  applyScenario:(t:string,id:string,changes:BoqScenarioChanges)=>
    req<{updatedLayerCount:number;application:string}>(t,`/projects/${enc(id)}/scenario/apply`,{
      method:'POST',body:JSON.stringify(changes),
    }),
};