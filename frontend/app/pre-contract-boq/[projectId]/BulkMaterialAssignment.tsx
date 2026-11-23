'use client';

import { useMemo, useState } from 'react';
import type { BoqApplication, BoqMaterial } from '../../../lib/preContractBoqApi';
import { materialSourceLabel, type BoqMaterialNameOption } from '../../../lib/boqMaterialOptions';

type Props = {
  applications: BoqApplication[];
  materials: BoqMaterialNameOption[];
  busy: boolean;
  onApply: (materialId: string, applications: string[], workLayers: string[]) => Promise<void>;
  onClose: () => void;
};

/** Select an exact set of application + work layer names; surface rows are all included. */
export default function BulkMaterialAssignment({applications, materials, busy, onApply, onClose}: Props) {
  const [chosenMaterial, setChosenMaterial] = useState<BoqMaterial | null>(null);
  const [selectedNameKey, setSelectedNameKey] = useState('');
  const selectedGroup = materials.find(group => group.key === selectedNameKey);
  const [selectedApps, setSelectedApps] = useState<string[]>(applications.map(a => a.application));
  const allNames = useMemo(() => [...new Set(applications.flatMap(a => a.layers.map(l => l.work_layer)))].sort(), [applications]);
  const [selectedLayers, setSelectedLayers] = useState<string[]>([]);
  const [error, setError] = useState('');
  const targets = useMemo(() => applications.flatMap(app =>
    selectedApps.includes(app.application)
      ? app.layers.filter(l => selectedLayers.includes(l.work_layer))
      : []
  ), [applications, selectedApps, selectedLayers]);
  const toggle = (value: string, values: string[], update: (items: string[])=>void) =>
    update(values.includes(value) ? values.filter(v=>v!==value) : [...values,value]);

  async function apply() {
    if (!chosenMaterial || !targets.length || busy) return;
    if (!window.confirm(`Overwrite material selection on ${targets.length} matching BOQ row(s) with “${chosenMaterial.materialName}” from ${chosenMaterial.sourceProjectId}? Other rows will be unchanged.`)) return;
    setError('');
    try { await onApply(chosenMaterial.materialId, selectedApps, selectedLayers); }
    catch (e) {setError(e instanceof Error ? e.message : 'Unable to apply material');}
  }
  return <section className="rounded-xl border border-emerald-700/60 bg-slate-900 p-4" aria-label="Bulk material assignment">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-emerald-200">Bulk Material Assignment</h2>
        <p className="text-xs text-slate-400">One Material Master record → selected layer names → selected applications. Both Ceiling and Wall rows match automatically.</p></div>
      <button type="button" onClick={onClose} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300">Close</button>
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 p-3">
        <h3 className="mb-2 text-sm font-semibold">1. Material from any site</h3>
        {chosenMaterial ? <div className="mb-2 rounded border border-emerald-500/40 bg-emerald-950/30 p-2 text-xs">
          <p className="font-semibold text-emerald-200">{chosenMaterial.materialName}</p>
          <p className="text-slate-300">Site: {chosenMaterial.sourceProjectId}</p>
          <p className="text-slate-400">Rate: ₹{chosenMaterial.rate ?? '—'} · Coverage: {chosenMaterial.coverage ?? '—'}</p>
          <button type="button" onClick={()=>{setChosenMaterial(null);setSelectedNameKey('');}} className="mt-2 text-cyan-300 underline">Choose another</button>
        </div> : null}
        <select
          aria-label="Choose unique material name from Material Master"
          value={selectedNameKey}
          onChange={e => {
            const key=e.target.value;
            setSelectedNameKey(key);
            const group=materials.find(item=>item.key===key);
            // Only auto-pick when the name does not hide different price inputs.
            setChosenMaterial(group&&!group.hasDifferentPricing?group.sources[0]:null);
          }}
          disabled={busy}
          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-white outline-none focus:border-emerald-500 disabled:opacity-60"
        >
          <option value="">Select a material...</option>
          {materials.map(group => <option key={group.key} value={group.key}>{group.name}</option>)}
        </select>
        {selectedGroup?.hasDifferentPricing&&<div className="mt-2">
          <label className="mb-1 block text-[11px] text-amber-200" htmlFor="bulk-material-source">Choose rate and coverage source</label>
          <select
            id="bulk-material-source"
            aria-label="Choose source site material rate and coverage"
            value={chosenMaterial?.materialId ?? ''}
            onChange={e=>setChosenMaterial(selectedGroup.sources.find(source=>source.materialId===e.target.value)??null)}
            disabled={busy}
            className="w-full rounded border border-amber-600/50 bg-slate-900 px-2 py-2 text-xs text-white outline-none focus:border-amber-400 disabled:opacity-60"
          >
            <option value="">Select pricing source...</option>
            {selectedGroup.sources.map(source=><option key={source.materialId} value={source.materialId}>{materialSourceLabel(source)}</option>)}
          </select>
        </div>}
        <p className="mt-2 text-[11px] text-slate-500">Each material name appears once. If sites have different rates or coverage, choose the pricing source explicitly.</p>
      </div>
      <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 p-3">
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">2. Work layers</h3><button type="button" className="text-xs text-cyan-300" onClick={()=>setSelectedLayers(selectedLayers.length===allNames.length?[]:allNames)}>{selectedLayers.length===allNames.length?'Clear':'All'}</button></div>
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {allNames.map(name=><label key={name} className="flex items-start gap-2 text-xs text-slate-300"><input type="checkbox" checked={selectedLayers.includes(name)} onChange={()=>toggle(name,selectedLayers,setSelectedLayers)} className="mt-0.5 accent-emerald-500"/><span>{name}</span></label>)}
          {!allNames.length&&<p className="text-xs text-slate-500">No imported or manual layers available yet.</p>}
        </div>
      </div>
      <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 p-3">
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">3. Applications</h3><button type="button" className="text-xs text-cyan-300" onClick={()=>setSelectedApps(selectedApps.length===applications.length?[]:applications.map(a=>a.application))}>{selectedApps.length===applications.length?'Clear':'All'}</button></div>
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {applications.map(app=><label key={app.application} className="flex items-start gap-2 text-xs text-slate-300"><input type="checkbox" checked={selectedApps.includes(app.application)} onChange={()=>toggle(app.application,selectedApps,setSelectedApps)} className="mt-0.5 accent-emerald-500"/><span>{app.application} ({app.layerCount} layers)</span></label>)}
        </div>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-950 p-3">
      <p className="text-xs text-slate-300"><strong>{targets.length} exact matching layer rows</strong> across {selectedApps.length} selected applications. An individual layer can still be changed afterwards.</p>
      <button type="button" onClick={()=>{void apply();}} disabled={!chosenMaterial||!targets.length||busy} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{busy?'Applying...':`Apply to ${targets.length} rows`}</button>
    </div>
    {error && <p role="alert" className="mt-2 rounded bg-red-950/50 p-2 text-xs text-red-200">{error}</p>}
  </section>;
}