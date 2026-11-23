'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { User } from '../../../lib/api';
import {
  BoqApplication, BoqLayer, BoqMaterial, BoqProject, CommercialField,
  LayerForm, preContractBoqApi,
} from '../../../lib/preContractBoqApi';
import BulkMaterialAssignment from './BulkMaterialAssignment';
import { groupBoqMaterialsByName, materialNameKey, materialSourceLabel, type BoqMaterialNameOption } from '../../../lib/boqMaterialOptions';
import {
  previewApplicationPricing, previewConsumables, previewLayerChange, previewLayerPricing,
} from '../../../lib/preContractBoqLocal';

const money = (v:number|null|undefined)=>v==null?'—':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(v);
const number = (v:number|null|undefined)=>v==null?'—':new Intl.NumberFormat('en-IN',{maximumFractionDigits:3}).format(v);
const margin = (v:number|null)=>v==null?'—':`${number(v)}%`;
/** Export all BOQ layers plus application totals, consumables and project total. */
function exportCostingCsv(project:BoqProject) {
  const columns=[
    'Row Type','Application','Work Layer','Surface','Area (sq ft)','Area Percentage',
    'Effective Area (sq ft)','Billable','Productivity (sq ft/labour day)',
    'Per Labour Cost (INR/day)','Labour Hours','Labour Days','Labour Cost (INR)',
    'Material','Material Source Project','Material Rate (INR/unit)',
    'Material Coverage (sq ft/unit)','Material Required (units)','Material Cost (INR)',
    'Consumables Cost (INR)','Total Cost (INR)','Profit Margin (%)',
    'Client Rate (INR/sq ft)','Revenue (INR)','Profit (INR)','Remark',
  ];
  type CsvRow=Record<string,string|number|boolean|null|undefined>;
  const rows:CsvRow[]=[];
  for (const app of project.applications) {
    rows.push({
      'Row Type':'Application Total','Application':app.application,
      'Effective Area (sq ft)':app.effectiveWorkArea,
      'Labour Hours':app.labourHours,'Labour Days':app.labourDays,
      'Labour Cost (INR)':app.labourCost,'Material Cost (INR)':app.materialCost,
      'Consumables Cost (INR)':app.consumablesCost,'Total Cost (INR)':app.totalCost,
      'Profit Margin (%)':app.profitMargin,'Client Rate (INR/sq ft)':app.clientRate,
      'Revenue (INR)':app.revenue,'Profit (INR)':app.profit,
    });
    for (const layer of app.layers) rows.push({
      'Row Type':'Layer','Application':layer.application,'Work Layer':layer.work_layer,
      'Surface':layer.surface,'Area (sq ft)':layer.area,
      'Area Percentage':layer.area_percentage,'Effective Area (sq ft)':layer.effectiveArea,
      'Billable':layer.billable?'Yes':'No',
      'Productivity (sq ft/labour day)':layer.productivity,
      'Per Labour Cost (INR/day)':layer.per_labor_cost,
      'Labour Hours':layer.labourHours,'Labour Days':layer.labourDays,
      'Labour Cost (INR)':layer.labourCost,'Material':layer.material_name,
      'Material Source Project':layer.material_source_project_id,
      'Material Rate (INR/unit)':layer.material_rate,
      'Material Coverage (sq ft/unit)':layer.material_coverage,
      'Material Required (units)':layer.materialRequired,
      'Material Cost (INR)':layer.materialCost,'Total Cost (INR)':layer.totalCost,
      'Profit Margin (%)':layer.profitMargin,'Client Rate (INR/sq ft)':layer.clientRate,
      'Revenue (INR)':layer.revenue,'Profit (INR)':layer.profit,'Remark':layer.remark,
    });
    rows.push({
      'Row Type':'Consumables','Application':app.application,
      'Work Layer':'Consumables','Consumables Cost (INR)':app.consumablesCost,
      'Total Cost (INR)':app.consumablesCost,
    });
  }
  rows.push({
    'Row Type':'Project Total','Application':project.projectName,
    'Total Cost (INR)':project.summary.totalCost,
    'Profit Margin (%)':project.summary.profitMargin,
    'Revenue (INR)':project.summary.revenue,
    'Profit (INR)':project.summary.profit,
  });
  const csvCell=(value:unknown):string=>{
    const raw=value==null?'':String(value);
    // Protect against formula injection from uploaded names and remarks.
    const safe=typeof value==='string'&&/^\s*[=+\-@]/.test(raw)?`'${raw}`:raw;
    return `"${safe.replace(/"/g,'""')}"`;
  };
  const csv='\uFEFF'+[
    columns.map(csvCell).join(','),
    ...rows.map(row=>columns.map(key=>csvCell(row[key])).join(',')),
  ].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  const anchor=document.createElement('a');
  const slug=project.projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'project';
  anchor.href=url;
  anchor.download=`pre-contract-boq-${slug}-costing-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  URL.revokeObjectURL(url);
}

const EMPTY_FORM:LayerForm={application:'',workLayer:'',surface:'Wall',area:0,billable:false,areaPercentage:100,productivity:null,perLaborCost:null};

type EditNumberProps = {
  value:number|null; editable:boolean; onSave:(value:number|null)=>Promise<void>;
  allowEmpty?:boolean; percent?:boolean; money?:boolean; label:string;
};
function EditNumber({value,editable,onSave,allowEmpty=false,percent=false,money:currency=false,label}:EditNumberProps){
  const [draft,setDraft]=useState(value==null?'':String(value));
  const [saving,setSaving]=useState(false);
  const [focused,setFocused]=useState(false);
  const cancelSave=useRef(false);
  useEffect(()=>{if(!focused)setDraft(value==null?'':String(value));},[value,focused]);
  async function save(){
    if(cancelSave.current){cancelSave.current=false;setFocused(false);return;}
    const text=draft.trim();
    const newValue=text===''&&allowEmpty?null:Number(text);
    if((text===''&&!allowEmpty)||(newValue!==null&&!Number.isFinite(newValue))){setDraft(value==null?'':String(value));setFocused(false);return;}
    if(newValue===value){setFocused(false);return;}
    setSaving(true);
    try{await onSave(newValue);}
    catch{setDraft(value==null?'':String(value));}
    finally{setSaving(false);setFocused(false);}
  }
  if(!editable)return <span className="whitespace-nowrap font-mono text-xs text-slate-300">{currency?money(value):percent?margin(value):number(value)}</span>;
  return <div className="relative flex items-center gap-1">
    {currency&&<span className="text-xs text-slate-500">₹</span>}
    <input aria-label={label} type="number" step="any" value={draft} disabled={saving}
      onFocus={()=>{cancelSave.current=false;setFocused(true);}} onChange={e=>setDraft(e.target.value)}
      onBlur={()=>{void save();}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){cancelSave.current=true;setDraft(value==null?'':String(value));e.currentTarget.blur();}}}
      className="w-24 min-w-0 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-right font-mono text-xs text-slate-100 focus:border-cyan-400 focus:outline-none disabled:opacity-60"/>
    {percent&&<span className="text-xs text-slate-500">%</span>}
  </div>;
}

export default function BoqAnalysisPage(){
  const router=useRouter();
  const params=useParams<{projectId:string}>();
  const id=params.projectId;
  const [token,setToken]=useState('');
  const [admin,setAdmin]=useState(false);
  const [project,setProject]=useState<BoqProject|null>(null);
  const [materials,setMaterials]=useState<BoqMaterial[]>([]);
  const materialNames=useMemo(()=>groupBoqMaterialsByName(materials),[materials]);
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState<LayerForm>({...EMPTY_FORM});
  const uploadRef=useRef<HTMLInputElement>(null);
  const [search,setSearch]=useState('');
  const [showBulk,setShowBulk]=useState(false);
  // Keep the latest optimistic project in a ref so rapid edits never use stale state.
  const projectRef = useRef<BoqProject|null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const queuedCountRef = useRef(0);
  const hadSaveFailureRef = useRef(false);
  const [pendingEdits,setPendingEdits] = useState(0);

  const acceptServerProject=useCallback((data:BoqProject)=>{
    projectRef.current=data;
    setProject(data);
  },[]);

  const fetchData=useCallback(async(t:string)=>{
    const data=await preContractBoqApi.get(t,id);
    acceptServerProject(data);
  },[id,acceptServerProject]);

  useEffect(()=>{
    const t=localStorage.getItem('zos_access_token');const raw=localStorage.getItem('zos_user');
    if(!t){router.replace('/');return;}
    let user:User|null=null;
    try{user=raw?JSON.parse(raw) as User:null;}catch{/* invalid */}
    if(!user||!['admin','viewer'].includes(user.role.toLowerCase())){router.replace('/projects');return;}
    setAdmin(user.role.toLowerCase()==='admin');setToken(t);
    let live=true;
    Promise.allSettled([preContractBoqApi.get(t,id),preContractBoqApi.materials(t)])
      .then(([projectResult,materialResult])=>{
        if(!live)return;
        if(projectResult.status==='fulfilled')acceptServerProject(projectResult.value);
        else setError(projectResult.reason instanceof Error?projectResult.reason.message:'Failed to load estimate');
        if(materialResult.status==='fulfilled')setMaterials(materialResult.value);
        else setError(current=>[current,'Material Master lookup unavailable: '+String(materialResult.reason)].filter(Boolean).join(' · '));
      })
      .finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[id,router,acceptServerProject]);

  // Fast path for cell edits: update the UI and all rollups immediately, then persist
  // sequentially. No full-project GET is performed after a successful field edit.
  function editAndSave(
    preview:(current:BoqProject)=>BoqProject,
    persist:()=>Promise<unknown>,
  ):Promise<void> {
    if(busy||!admin)return Promise.reject(new Error('Editing is not available right now'));
    try {
      const current=projectRef.current;
      if(!current)throw new Error('BOQ project is not loaded');
      const next=preview(current);
      projectRef.current=next;
      setProject(next);
      setError('');
    } catch(e) {
      setError(e instanceof Error?e.message:'Invalid change');
      return Promise.reject(e);
    }

    queuedCountRef.current++;
    setPendingEdits(queuedCountRef.current);
    const task=writeQueueRef.current.then(async()=>{await persist();});
    // A failed save must not block subsequent queued edits.
    writeQueueRef.current=task.catch(()=>undefined);
    return task.catch(e=>{
      hadSaveFailureRef.current=true;
      setError(`Saving failed: ${e instanceof Error?e.message:'Unknown server error'}. The table will resync with saved data.`);
      throw e;
    }).finally(async()=>{
      queuedCountRef.current--;
      setPendingEdits(queuedCountRef.current);
      // Only fetch the canonical state on an actual write failure, never routinely.
      if(queuedCountRef.current===0&&hadSaveFailureRef.current){
        hadSaveFailureRef.current=false;
        try {
          const fresh=await preContractBoqApi.get(token,id);
          if(queuedCountRef.current===0)acceptServerProject(fresh);
        } catch {
          setError('Unable to reconcile failed edits. Reload this BOQ before making more changes.');
        }
      }
    });
  }

  // Structural operations (CSV import, add/delete, bulk) still reload the snapshot.
  async function mutate(action:()=>Promise<unknown>,message?:string){
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      await writeQueueRef.current;
      await action();
      await fetchData(token);
      if(message)setNotice(message);
    }
    catch(e){setError(e instanceof Error?e.message:'Unable to save change');throw e;}
    finally{setBusy(false);}
  }
  async function importFile(file:File){
    if(!admin)return;
    const accepted=window.confirm('Replace ALL previously imported layer rows in this BOQ project with the new CSV? Manually added layers and application consumables will be preserved. Imported material selections and prices will be reset; unique matching row remarks are preserved.');
    if(!accepted)return;
    await mutate(async()=>{
      const result=await preContractBoqApi.import(token,id,file);
      setNotice(`${result.imported} rows imported; ${result.replacedImported} previous imported rows replaced. Manual rows and consumables preserved.`);
    });
  }
  function changeLayer(layer:BoqLayer,update:Record<string,unknown>):Promise<void>{
    return editAndSave(
      project=>previewLayerChange(project,layer.layer_id,update,materials),
      ()=>preContractBoqApi.updateLayer(token,id,layer.layer_id,update),
    );
  }
  async function deleteLayer(layer:BoqLayer){
    if(!window.confirm(`Delete layer "${layer.work_layer}" (${layer.application} / ${layer.surface})?`))return;
    await mutate(()=>preContractBoqApi.deleteLayer(token,id,layer.layer_id),'Layer deleted');
  }
  async function addLayer(e:React.FormEvent){
    e.preventDefault();await mutate(()=>preContractBoqApi.addLayer(token,id,form),'Manual layer added');
    setShowAdd(false);setForm({...EMPTY_FORM});
  }
  function priceLayer(layer:BoqLayer,field:CommercialField,value:number):Promise<void>{
    return editAndSave(
      project=>previewLayerPricing(project,layer.layer_id,field,value),
      ()=>preContractBoqApi.setLayerPricing(token,id,layer.layer_id,field,value),
    );
  }
  function priceApp(app:BoqApplication,field:CommercialField,value:number):Promise<void>{
    setNotice('Application pricing will overwrite the individual billable-layer prices.');
    return editAndSave(
      project=>previewApplicationPricing(project,app.application,field,value),
      ()=>preContractBoqApi.setAppPricing(token,id,app.application,field,value),
    );
  }
  function saveConsumables(application:string,cost:number):Promise<void>{
    return editAndSave(
      project=>previewConsumables(project,application,cost),
      ()=>preContractBoqApi.consumables(token,id,application,cost),
    );
  }
  async function bulkAssign(materialId:string,applications:string[],workLayers:string[]){
    await mutate(async()=>{
      const result=await preContractBoqApi.bulkMaterials(token,id,materialId,applications,workLayers);
      setNotice(`${result.updatedLayerCount} matching layer(s) updated with ${result.materialName}.`);
    });
    setShowBulk(false);
  }
  const filtered=useMemo(()=>project?.applications.filter(a=>a.application.toLowerCase().includes(search.toLowerCase())||a.layers.some(l=>l.work_layer.toLowerCase().includes(search.toLowerCase())))||[],[project,search]);
  const names=useMemo(()=>[...new Set(project?.applications.map(a=>a.application)||[])], [project]);

  if(loading)return <main className="min-h-screen bg-slate-950 p-10 text-slate-300">Loading BOQ estimate...</main>;
  return <main className="min-h-screen bg-slate-950 px-3 pb-6 text-white sm:px-6">
    <div className="mx-auto max-w-[1900px] space-y-5">
      {/* Pinned project heading, actions and BOQ page switcher across scrolling. */}
      <div className="sticky top-0 z-40 -mx-3 border-b border-slate-800 bg-slate-950/95 px-3 pb-3 pt-3 shadow-lg backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><button onClick={()=>router.push('/pre-contract-boq')} className="mb-3 text-sm text-cyan-300 hover:underline">← Saved BOQ Projects</button>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">{project?.projectName||'Pre-Contract BOQ'}</h1>
          <p className="mt-1 font-mono text-xs text-slate-500">{id} · Independent commercial estimate</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!project||busy||pendingEdits>0}
            onClick={()=>{const current=projectRef.current;if(current)exportCostingCsv(current);}}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-cyan-500 disabled:opacity-40">
            Export CSV
          </button>
        {admin&&<div className="flex flex-wrap items-center gap-2">
          <input ref={uploadRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e=>{const f=e.currentTarget.files?.[0];e.currentTarget.value='';if(f)void importFile(f).catch(()=>{});}}/>
          <button disabled={busy} onClick={()=>setShowBulk(v=>!v)} className="rounded-lg border border-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50">Bulk Material Assignment</button>
          <button disabled={busy} onClick={()=>uploadRef.current?.click()} className="rounded-lg border border-cyan-500 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-50">Import / Replace CSV</button>
          <button disabled={busy} onClick={()=>{setForm({...EMPTY_FORM,application:names[0]||''});setShowAdd(v=>!v);}} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50">+ Add Layer</button>
        </div>}
        </div>
      </div>
      <nav aria-label="BOQ project pages" className="mt-3 flex flex-wrap gap-2">
        <span aria-current="page" className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">1 · BOQ Costing</span>
        <button type="button" onClick={()=>router.push(`/pre-contract-boq/${encodeURIComponent(id)}/analysis`)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-cyan-500 hover:text-cyan-300">2 · BOQ Analysis</button>
      </nav>
      </div>
      {showBulk&&project&&admin&&<BulkMaterialAssignment
        applications={project.applications} materials={materialNames} busy={busy}
        onApply={bulkAssign} onClose={()=>setShowBulk(false)}
      />}
      {pendingEdits>0&&<div role="status" aria-live="polite" className="rounded-lg border border-cyan-700/40 bg-cyan-950/25 p-2 text-xs text-cyan-200">Saving {pendingEdits} change{pendingEdits===1?'':'s'} in the background. You can keep editing.</div>}
      {error&&<div role="alert" className="rounded-lg border border-red-500/40 bg-red-950/50 p-3 text-sm text-red-200">{error}</div>}
      {notice&&<div role="status" className="rounded-lg border border-teal-500/30 bg-teal-950/30 p-3 text-sm text-teal-200">{notice}</div>}
      {!admin&&<div className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-400">Viewer access: estimates are read-only. Only admins can import, edit and delete.</div>}
      {project && project.summary.incompleteLayerCount>0 && <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-sm text-amber-200">
        Estimate incomplete: {project.summary.incompleteLayerCount} layer(s) are missing productivity, labour cost or material inputs. Displayed totals are preliminary and may understate execution cost. Select materials and complete the missing fields before using proposed margins to negotiate.
      </div>}
      {project&&<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {([
          ['Total Cost',money(project.summary.totalCost)],
          ['Expected Revenue',money(project.summary.revenue)],
          ['Expected Profit',money(project.summary.profit)],
          ['Achieved Margin',margin(project.summary.profitMargin)],
          ['Incomplete Layers',`${project.summary.incompleteLayerCount} / ${project.summary.layerCount}`],
        ] as [string,string][]).map(([label,value])=><div key={label} className="rounded-xl border border-slate-700 bg-slate-900 p-3"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 break-words font-mono text-lg font-semibold text-cyan-200">{value}</p></div>)}
      </div>}
      {showAdd&&admin&&<form onSubmit={e=>{void addLayer(e).catch(()=>{});}} className="rounded-xl border border-cyan-700 bg-slate-900 p-4">
        <h2 className="mb-3 font-semibold">Add manual layer</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-slate-400">Application<input required list="boq-apps" value={form.application} onChange={e=>setForm(p=>({...p,application:e.target.value}))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-white"/><datalist id="boq-apps">{names.map(n=><option value={n} key={n}/>)}</datalist></label>
          <label className="text-xs text-slate-400">Work Layer<input required value={form.workLayer} onChange={e=>setForm(p=>({...p,workLayer:e.target.value}))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-white"/></label>
          <label className="text-xs text-slate-400">Surface<select value={form.surface} onChange={e=>setForm(p=>({...p,surface:e.target.value as LayerForm['surface']}))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-white"><option>Wall</option><option>Ceiling</option><option>Both</option></select></label>
          <label className="text-xs text-slate-400">Area (sq ft)<input required type="number" min="0" step="any" value={form.area} onChange={e=>setForm(p=>({...p,area:Number(e.target.value)}))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-white"/></label>
          <label className="text-xs text-slate-400">Area Percentage<input required type="number" min="0" max="100" step="any" value={form.areaPercentage} onChange={e=>setForm(p=>({...p,areaPercentage:Number(e.target.value)}))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-white"/></label>
          <label className="text-xs text-slate-400">Productivity (sq ft / labour day)<input type="number" min="0" step="any" value={form.productivity??''} onChange={e=>setForm(p=>({...p,productivity:e.target.value?Number(e.target.value):null}))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-white"/></label>
          <label className="text-xs text-slate-400">Per Labour Cost (₹ / day)<input type="number" min="0" step="any" value={form.perLaborCost??''} onChange={e=>setForm(p=>({...p,perLaborCost:e.target.value?Number(e.target.value):null}))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-white"/></label>
          <label className="text-xs text-slate-400">Remark (optional)<textarea rows={2} maxLength={1000} value={form.remark||''} onChange={e=>setForm(p=>({...p,remark:e.target.value}))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-white"/></label>
          <label className="flex items-center gap-3 self-end rounded-lg border border-slate-700 p-2 text-sm"><input type="checkbox" checked={form.billable} onChange={e=>setForm(p=>({...p,billable:e.target.checked}))}/> Billable</label>
        </div>
        <div className="mt-4 flex gap-2"><button type="submit" disabled={busy} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Save Layer</button><button type="button" onClick={()=>setShowAdd(false)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm">Cancel</button></div>
      </form>}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900 p-3">
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter by application / layer" className="w-72 max-w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"/>
        <p className="text-xs text-slate-400">Application pricing overwrites all billable layers. Layer pricing changes roll up without touching other layers. Labour: 8 hours/day.</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[2630px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-slate-950 text-left text-[11px] uppercase tracking-wider text-slate-400">
              <tr>{[
                'Application / Layer','Surface','Area (sq ft)','Area %','Effective Area',
                'Billable','Productivity / day','Labour Cost / day','Labour Hours','Labour Days',
                'Labour Cost','Material (all sites)','Material Rate','Material Coverage',
                'Material Required','Material Cost','Total Cost','Profit Margin %',
                'Client Rate','Revenue','Profit','Remark','Actions',
              ].map(h=><th key={h} className="whitespace-nowrap border-b border-slate-700 px-3 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(app=><ApplicationRows key={app.application} app={app} expanded={Boolean(expanded[app.application])} toggle={()=>setExpanded(p=>({...p,[app.application]:!p[app.application]}))}
                editable={admin&&!busy} materials={materialNames} changeLayer={changeLayer} deleteLayer={deleteLayer} priceLayer={priceLayer} priceApp={priceApp}
                saveConsumables={cost=>saveConsumables(app.application,cost)}/>) }
              {filtered.length===0&&<tr><td colSpan={23} className="p-8 text-center text-slate-400">No applications yet. Import the supplied CSV or add your first layer.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-slate-500">Revenue and client rates use effective area (including touchup if manually marked billable). Missing productivity or material is highlighted; missing values are never presented as verified zero-cost estimates. The project margin is calculated from application totals and is not editable.</p>
    </div>
  </main>;
}

const cell='border-b border-slate-800 px-3 py-2 align-middle';
const pricingFields:{id:CommercialField;format:'margin'|'money'}[]=[
  {id:'margin',format:'margin'},{id:'rate',format:'money'},{id:'revenue',format:'money'},{id:'profit',format:'money'},
];
function PricingCells({values,editable,onSave,prefix}: {
  values:{profitMargin:number|null;clientRate:number|null;revenue:number;profit:number};
  editable:boolean;onSave:(field:CommercialField,value:number)=>Promise<void>;prefix:string;
}){
  return <>{pricingFields.map(p=><td key={p.id} className={cell}>
    <EditNumber label={`${prefix} ${p.id}`} value={p.id==='margin'?values.profitMargin:p.id==='rate'?values.clientRate:values[p.id]}
      editable={editable} percent={p.format==='margin'} money={p.format==='money'}
      onSave={v=>v==null?Promise.reject(new Error('Required')):onSave(p.id,v)}/>
  </td>)}</>;
}
function ApplicationRows({app,expanded,toggle,editable,materials,changeLayer,deleteLayer,priceLayer,priceApp,saveConsumables}:{
  app:BoqApplication;expanded:boolean;toggle:()=>void;editable:boolean;materials:BoqMaterialNameOption[];
  changeLayer:(layer:BoqLayer,data:Record<string,unknown>)=>Promise<void>;
  deleteLayer:(layer:BoqLayer)=>Promise<void>;
  priceLayer:(layer:BoqLayer,field:CommercialField,value:number)=>Promise<void>;
  priceApp:(app:BoqApplication,field:CommercialField,value:number)=>Promise<void>;
  saveConsumables:(cost:number)=>Promise<void>;
}){
  return <>
    <tr className="bg-slate-800/80 font-semibold text-cyan-100">
      <td className={`${cell} sticky left-0 z-[1] bg-slate-800 px-4`}><button onClick={toggle} className="flex items-center gap-2 whitespace-nowrap text-left"><span className="text-cyan-400">{expanded?'▼':'▶'}</span> {app.application}<span className="font-normal text-xs text-slate-400">({app.layerCount} layers)</span></button></td>
      <td className={cell}>—</td><td className={cell} title="The original project area repeats across layers and cannot be summed without double counting">—</td><td className={cell}>—</td><td className={cell} title="Sum of actual effective work across all layers; not unique physical site area">{number(app.effectiveWorkArea)}</td><td className={cell}>—</td><td className={cell}>—</td><td className={cell}>—</td><td className={cell}>{number(app.labourHours)}</td><td className={cell}>{number(app.labourDays)}</td>
      <td className={cell}>{money(app.labourCost)}</td>
      <td className={cell}>—</td><td className={cell}>—</td><td className={cell}>—</td><td className={cell} title="Cannot add different material units (kg, litres, etc.) into one quantity">—</td><td className={cell}>{money(app.materialCost)}</td><td className={cell}>{money(app.totalCost)}</td>
      <PricingCells prefix={app.application} values={app} editable={editable&&app.layers.some(l=>l.billable)} onSave={(f,v)=>priceApp(app,f,v)}/>
      <td className={cell}>—</td>
      <td className={cell}><span className="text-xs font-normal text-slate-400">{app.incompleteLayerCount>0?`${app.incompleteLayerCount} incomplete`: 'Calculated'}</span></td>
    </tr>
    {expanded&&<>
      {app.layers.map(layer=><tr key={layer.layer_id} className="bg-slate-900/70 text-slate-200 hover:bg-slate-800/40">
        <td className={`${cell} sticky left-0 z-[1] bg-slate-900`}><div className="flex min-w-52 flex-col gap-1 pl-5">
          <EditableText value={layer.work_layer} enabled={editable} onSave={v=>changeLayer(layer,{workLayer:v})} label="Work Layer"/>
          <EditableText value={layer.application} enabled={editable} onSave={v=>changeLayer(layer,{application:v})} label="Application"/>
          {layer.missingInputs.length>0&&<span className="text-[10px] text-amber-300" title={layer.missingInputs.join(', ')}>Missing: {layer.missingInputs.join(', ')}</span>}
        </div></td>
        <td className={cell}>{editable?<select aria-label="Surface" value={layer.surface} onChange={e=>{void changeLayer(layer,{surface:e.target.value}).catch(()=>{});}} className="rounded border border-slate-700 bg-slate-950 p-2 text-xs"><option>Ceiling</option><option>Wall</option><option>Both</option></select>:layer.surface}</td>
        <td className={cell}><EditNumber label="Area" value={layer.area} editable={editable} onSave={v=>changeLayer(layer,{area:v})}/></td>
        <td className={cell}><EditNumber label="Area Percentage" value={layer.area_percentage} editable={editable} percent onSave={v=>changeLayer(layer,{areaPercentage:v})}/></td>
        <td className={cell}>{number(layer.effectiveArea)}</td>
        <td className={cell}><input aria-label={`Billable ${layer.work_layer}`} type="checkbox" checked={layer.billable} disabled={!editable} onChange={e=>{void changeLayer(layer,{billable:e.target.checked}).catch(()=>{});}} className="h-4 w-4 accent-cyan-500"/></td>
        <td className={cell}><EditNumber label="Productivity" value={layer.productivity} editable={editable} allowEmpty onSave={v=>changeLayer(layer,{productivity:v})}/></td>
        <td className={cell}><EditNumber label="Per Labor Cost" value={layer.per_labor_cost} editable={editable} allowEmpty money onSave={v=>changeLayer(layer,{perLaborCost:v})}/></td>
        <td className={cell}>{number(layer.labourHours)}</td><td className={cell}>{number(layer.labourDays)}</td><td className={cell}>{money(layer.labourCost)}</td>
        <td className={cell}>
          <MaterialPicker
            key={layer.layer_id}
            editable={editable}
            materials={materials}
            selectedId={layer.material_id}
            selectedName={layer.material_name}
            selectedSource={layer.material_source_project_id}
            onSelect={materialId=>changeLayer(layer,{materialId})}
          />
        </td>
        <td className={cell}>{money(layer.material_rate)}</td><td className={cell}>{number(layer.material_coverage)}</td><td className={cell}>{number(layer.materialRequired)}</td><td className={cell}>{money(layer.materialCost)}</td><td className={cell}>{money(layer.totalCost)}</td>
        <PricingCells prefix={layer.work_layer} values={layer} editable={editable&&layer.billable} onSave={(f,v)=>priceLayer(layer,f,v)}/>
        <td className={cell}><RemarkCell value={layer.remark} editable={editable} onSave={v=>changeLayer(layer,{remark:v})}/></td>
        <td className={cell}>{editable?<button onClick={()=>{void deleteLayer(layer).catch(()=>{});}} className="rounded border border-red-700/40 px-2 py-1.5 text-xs text-red-300 hover:bg-red-900/20">Delete</button>:<span className="text-xs text-slate-500">{layer.source}</span>}</td>
      </tr>)}
      <tr className="bg-slate-950/70 text-slate-300"><td className={`${cell} sticky left-0 z-[1] bg-slate-950 pl-8 font-semibold`}>Consumables</td><td colSpan={15} className={cell}><span className="text-xs text-slate-500">Application tools and consumables · cost only · no labour, material, or revenue fields</span></td>
        <td className={cell}><EditNumber label={`${app.application} consumables cost`} value={app.consumablesCost} editable={editable} money onSave={v=>saveConsumables(v||0)}/></td>
        <td colSpan={6} className={cell}><span className="text-xs text-slate-500">Included in application cost and recovered from billable layer pricing</span></td>
      </tr>
    </>}
  </>;
}
function RemarkCell({value,editable,onSave}:{value:string|null;editable:boolean;onSave:(v:string|null)=>Promise<void>}){
  const [draft,setDraft]=useState(value||'');
  const [focused,setFocused]=useState(false);
  useEffect(()=>{if(!focused)setDraft(value||'');},[value,focused]);
  if(!editable)return <span className="block max-w-64 whitespace-pre-wrap break-words text-xs text-slate-300">{value||'—'}</span>;
  return <textarea aria-label="Layer remark" rows={2} maxLength={1000} value={draft}
    onFocus={()=>setFocused(true)}
    onChange={e=>setDraft(e.target.value)}
    onBlur={()=>{setFocused(false);if(draft!==(value||''))void onSave(draft.trim()||null).catch(()=>setDraft(value||''));}}
    onKeyDown={e=>{if(e.key==='Escape'){setDraft(value||'');e.currentTarget.blur();}}}
    placeholder="Add remark..."
    className="w-64 rounded border border-slate-700 bg-slate-950 p-2 text-xs text-white outline-none focus:border-cyan-500"/>;
}
function EditableText({value,enabled,onSave,label}: {value:string;enabled:boolean;onSave:(value:string)=>Promise<void>;label:string}){
  const [draft,setDraft]=useState(value);
  useEffect(()=>{setDraft(value);},[value]);
  if(!enabled)return <span className="text-xs">{value}</span>;
  return <input aria-label={label} value={draft} title={`Edit ${label}`} onChange={e=>setDraft(e.target.value)}
    onBlur={()=>{const v=draft.trim();if(v&&v!==value)void onSave(v).catch(()=>setDraft(value));else setDraft(value);}}
    onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){setDraft(value);e.currentTarget.blur();}}}
    className="w-56 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none focus:border-cyan-600 focus:bg-slate-950"/>;
}


/**
 * Unique material names in the primary dropdown.
 * Where two sites use different pricing for the same name, the user selects
 * the exact source separately so costing never silently picks a rate.
 * The options are mounted only while editing this row.
 */
function MaterialPicker({editable,materials,selectedId,selectedName,selectedSource,onSelect}:{
  editable:boolean;
  materials:BoqMaterialNameOption[];
  selectedId:string|null;
  selectedName:string|null;
  selectedSource:string|null;
  onSelect:(id:string|null)=>Promise<void>;
}){
  const [editing,setEditing]=useState(false);
  const [pending,setPending]=useState(false);
  const [activeNameKey,setActiveNameKey]=useState('');
  const activeGroup=materials.find(group=>group.key===activeNameKey);

  function startEdit(){
    setActiveNameKey(materialNameKey(selectedName));
    setEditing(true);
  }

  async function choose(id:string|null){
    // The original layer update API still receives a real Material Master UUID.
    setPending(true);
    setEditing(false);
    try{await onSelect(id);}
    catch{/* The parent reports save failures and restores authoritative values. */}
    finally{setPending(false);}
  }

  function chooseName(key:string){
    if(!key){void choose(null);return;}
    const group=materials.find(item=>item.key===key);
    if(!group)return;
    setActiveNameKey(key);
    // Preserve an existing selection on the same name; permit a source switch.
    if(materialNameKey(selectedName)===key && selectedId)return;
    if(!group.hasDifferentPricing){void choose(group.sources[0].materialId);}
    // Different rate/coverage: let user explicitly select the pricing source.
  }

  if(!editable)return <div className="min-w-56 text-xs text-slate-200">
    <p className="max-w-60 truncate" title={selectedName||''}>{selectedName||'—'}</p>
    {selectedSource&&<p className="mt-1 text-[10px] text-slate-500">From {selectedSource}</p>}
  </div>;
  return <div className="min-w-56 text-xs">
    {editing ? <div className="flex w-60 max-w-full flex-col gap-1.5">
      <select
        autoFocus
        aria-label="Choose unique material name"
        value={activeNameKey}
        disabled={pending}
        onChange={e=>chooseName(e.target.value)}
        className="w-full rounded border border-cyan-500 bg-slate-950 px-2 py-2 text-xs text-white outline-none disabled:opacity-60"
      >
        <option value="">Select material / clear selection</option>
        {materials.map(group=><option key={group.key} value={group.key}>{group.name}</option>)}
      </select>
      {activeGroup&&activeGroup.hasDifferentPricing&&<>
        <p className="text-[10px] text-amber-200">Different site rates / coverage. Choose a pricing source:</p>
        <select
          aria-label="Choose site material rate and coverage"
          value={activeGroup.sources.some(source=>source.materialId===selectedId)?selectedId??'':''}
          disabled={pending}
          onChange={e=>{if(e.target.value)void choose(e.target.value);}}
          className="w-full rounded border border-amber-600/50 bg-slate-950 px-2 py-2 text-xs text-white outline-none disabled:opacity-60"
        >
          <option value="">Select pricing source...</option>
          {activeGroup.sources.map(source=><option key={source.materialId} value={source.materialId}>{materialSourceLabel(source)}</option>)}
        </select>
      </>}
      <button type="button" onClick={()=>setEditing(false)} className="self-start text-[11px] text-slate-400 hover:text-white">Cancel</button>
    </div> : <button
      type="button"
      aria-label={`Material for ${selectedName||'layer'}`}
      aria-haspopup="listbox"
      disabled={pending}
      onClick={startEdit}
      className="w-60 max-w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-left text-slate-200 hover:border-cyan-500 disabled:opacity-60"
      title={selectedName||'Choose material from all sites'}
    ><span className="block truncate">{pending?'Saving…':selectedName||'Select material…'} ▾</span></button>}
    {selectedSource&&<p className="mt-1 text-[10px] text-slate-500">From {selectedSource}</p>}
  </div>;
}