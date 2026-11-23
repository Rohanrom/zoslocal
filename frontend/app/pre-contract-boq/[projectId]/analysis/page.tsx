'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { User } from '../../../../lib/api';
import {
  type BoqLayer,
  type BoqLayerAnalysisChange,
  type BoqProject,
  preContractBoqApi,
} from '../../../../lib/preContractBoqApi';
import {
  type LayerScenarioOverride,
  type PreviewApplication,
  simulateLayerEdits,
} from '../../../../lib/preContractBoqScenario';

type LayerDraft = { productivity?: number; clientRate?: number };
type LayerDrafts = Record<string, LayerDraft>;

const currency = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const percent = (n: number | null) =>
  n == null ? '—' : `${n.toFixed(2)}%`;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const same = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.000001;

/**
 * Narrow only the chart/report scope. All pending edits are kept in the separate
 * drafts map and remain project-wide until Apply, even while a filter is active.
 * Consumables belong to the APPLICATION, not to an individual layer.
 */
function selectAnalysisScope(
  project: BoqProject,
  applicationFilter: string,
  selectedLayerIds: string[],
): BoqProject {
  const selected = new Set(selectedLayerIds);
  const applications = project.applications
    .filter((app) => applicationFilter === 'All' || app.application === applicationFilter)
    .map((app) => ({
      ...app,
      layers: selected.size
        ? app.layers.filter((layer) => selected.has(layer.layer_id))
        : app.layers,
      // Consumables are application-wide, never assigned to individual layers.
      consumablesCost: selected.size ? 0 : app.consumablesCost,
    }))
    .filter((app) => selected.size === 0 || app.layers.length > 0);
  return { ...project, applications };
}

const percentageBounds = { min: -50, max: 100, step: 1 };

export default function BoqAnalysisPage() {
  const router = useRouter();
  const { projectId } = useParams<{ projectId: string }>();
  const [token, setToken] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [project, setProject] = useState<BoqProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [applicationFilter, setApplicationFilter] = useState('All');
  // Empty selection = whole BOQ/application summary. Non-empty = only checked rows.
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [layerSearch, setLayerSearch] = useState('');
  const [productivityShift, setProductivityShift] = useState(0);
  const [clientRateShift, setClientRateShift] = useState(0);
  const [drafts, setDrafts] = useState<LayerDrafts>({});

  useEffect(() => {
    const storedToken = localStorage.getItem('zos_access_token');
    if (!storedToken) {
      router.replace('/');
      return;
    }
    let user: User | null = null;
    try {
      const raw = localStorage.getItem('zos_user');
      user = raw ? JSON.parse(raw) as User : null;
    } catch {
      // Invalid local storage is treated as signed out.
    }
    if (!user || !['admin', 'viewer'].includes(String(user.role || '').toLowerCase())) {
      router.replace('/projects');
      return;
    }
    setIsAdmin(String(user.role || '').toLowerCase() === 'admin');
    setToken(storedToken);
    let alive = true;
    preContractBoqApi.get(storedToken, projectId)
      .then((data) => { if (alive) setProject(data); })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Unable to load BOQ Analysis');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, router]);

  const layers = useMemo(
    () => project?.applications.flatMap((app) => app.layers) ?? [],
    [project],
  );
  const byId = useMemo(
    () => new Map(layers.map((layer) => [layer.layer_id, layer])),
    [layers],
  );

  const layerOptions = useMemo(
    () => layers
      .filter((layer) => applicationFilter === 'All' || layer.application === applicationFilter)
      .sort((a, b) => a.application.localeCompare(b.application)
        || a.sort_order - b.sort_order
        || a.work_layer.localeCompare(b.work_layer)),
    [layers, applicationFilter],
  );
  const selectedIdSet = useMemo(() => new Set(selectedLayerIds), [selectedLayerIds]);
  const selectedLayers = useMemo(
    () => layerOptions.filter((layer) => selectedIdSet.has(layer.layer_id)),
    [layerOptions, selectedIdSet],
  );
  const searchableLayers = useMemo(() => {
    const query = layerSearch.trim().toLowerCase();
    return query
      ? layerOptions.filter((layer) =>
          `${layer.application} ${layer.work_layer} ${layer.surface}`.toLowerCase().includes(query))
      : layerOptions;
  }, [layerOptions, layerSearch]);

  function resetSliders() {
    setProductivityShift(0);
    setClientRateShift(0);
  }

  function toggleLayer(layerId: string) {
    setSelectedLayerIds((current) => current.includes(layerId)
      ? current.filter((id) => id !== layerId)
      : [...current, layerId]);
    resetSliders();
  }

  function setVisibleSelection(select: boolean) {
    const visible = new Set(searchableLayers.map((layer) => layer.layer_id));
    setSelectedLayerIds((current) => select
      ? Array.from(new Set([...current, ...visible]))
      : current.filter((id) => !visible.has(id)));
    resetSliders();
  }

  // Each draft changes exactly one physical row, identified by layer_id.
  // Other layers retain their saved productivity, rate, cost and revenue.
  const pending = useMemo(() => {
    const overrides: Record<string, LayerScenarioOverride> = {};
    const changes: BoqLayerAnalysisChange[] = [];
    for (const [layerId, draft] of Object.entries(drafts)) {
      const layer = byId.get(layerId);
      if (!layer) continue;
      const override: LayerScenarioOverride = {};
      const change: BoqLayerAnalysisChange = {
        layerId,
        expectedProductivity: layer.productivity,
        expectedRevenueAmount: layer.revenue_amount,
      };
      if (draft.productivity !== undefined && !same(layer.productivity, draft.productivity)) {
        override.productivity = draft.productivity;
        change.productivity = draft.productivity;
      }
      if (draft.clientRate !== undefined && !same(layer.clientRate, draft.clientRate)) {
        override.clientRate = draft.clientRate;
        change.clientRate = draft.clientRate;
      }
      if (change.productivity !== undefined || change.clientRate !== undefined) {
        overrides[layerId] = override;
        changes.push(change);
      }
    }
    return { overrides, changes };
  }, [drafts, byId]);

  const scopedProject = useMemo(
    () => project ? selectAnalysisScope(project, applicationFilter, selectedLayerIds) : null,
    [project, applicationFilter, selectedLayerIds],
  );
  // Filters affect *both* the saved baseline and the preview: KPIs, pie,
  // application bars and profitability bars always describe the SAME scope.
  const saved = useMemo(
    () => scopedProject ? simulateLayerEdits(scopedProject, {}) : null,
    [scopedProject],
  );
  const preview = useMemo(
    () => scopedProject ? simulateLayerEdits(scopedProject, pending.overrides) : null,
    [scopedProject, pending.overrides],
  );

  // A percentage shift is relative to EACH saved layer value, not a shared
  // absolute rate or productivity. Non-billable/zero-area/zero-base rows are
  // left untouched for client-rate changes.
  function updateGroupShift(field: keyof LayerDraft, shift: number) {
    if (saving || !isAdmin || selectedLayers.length === 0) return;
    if (field === 'productivity') setProductivityShift(shift);
    else setClientRateShift(shift);

    setDrafts((previous) => {
      const updated = { ...previous };
      for (const layer of selectedLayers) {
        const original = field === 'productivity' ? layer.productivity : layer.clientRate;
        if (original == null || original <= 0) continue;
        if (field === 'clientRate' && (!layer.billable || layer.effectiveArea <= 0)) continue;
        const adjusted = round4(original * (1 + shift / 100));
        if (!Number.isFinite(adjusted) || (field === 'productivity' && adjusted <= 0) || adjusted > 1e13) continue;
        const draft = { ...(updated[layer.layer_id] ?? {}) };
        if (same(original, adjusted)) delete draft[field];
        else draft[field] = adjusted;
        if (Object.keys(draft).length) updated[layer.layer_id] = draft;
        else delete updated[layer.layer_id];
      }
      return updated;
    });
    setNotice('');
  }

  function resetSelectedLayers() {
    const selected = new Set(selectedLayerIds);
    setDrafts((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => !selected.has(id)),
    ));
    resetSliders();
  }

  function navigate(path: string) {
    if (pending.changes.length &&
      !window.confirm('Leave BOQ Analysis and discard your unsaved preview?')) return;
    router.push(path);
  }

  async function applyChanges() {
    if (!isAdmin || !project || saving || pending.changes.length === 0) return;
    const count = pending.changes.length;
    const warning = preview?.incompleteLayerCount
      ? `\nWarning: ${preview.incompleteLayerCount} layer(s) in the current view have incomplete costing inputs.`
      : '';
    if (!window.confirm(
      `Apply productivity/client-rate changes to ${count} layer(s) in this BOQ project?\n\n` +
      `This includes pending edits outside the current filter.\n` +
      `Labour cost/day, material pricing and Consumables remain unchanged.${warning}`,
    )) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await preContractBoqApi.applyLayerAnalysis(token, projectId, pending.changes);
      const fresh = await preContractBoqApi.get(token, projectId);
      setProject(fresh);
      setDrafts({});
      resetSliders();
      setNotice(`${result.updatedLayerCount} layer(s) saved. Charts now reflect the saved BOQ.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save Analysis changes');
    } finally {
      setSaving(false);
    }
  }

  const scopedLabel = selectedLayers.length
    ? `${selectedLayers.length} selected layer${selectedLayers.length === 1 ? '' : 's'}`
    : applicationFilter === 'All' ? 'All applications · All layers'
      : `${applicationFilter} · All layers`;
  const isLayerScope = selectedLayers.length > 0;
  const productivityEligible = selectedLayers.filter((layer) =>
    layer.productivity != null && layer.productivity > 0);
  const rateEligible = selectedLayers.filter((layer) =>
    layer.billable && layer.effectiveArea > 0 && layer.clientRate != null && layer.clientRate > 0);
  const selectedPendingCount = selectedLayers.filter((layer) =>
    pending.changes.some((change) => change.layerId === layer.layer_id)).length;

  if (loading) {
    return <main className="min-h-screen bg-slate-950 p-8 text-slate-300">Loading BOQ Analysis...</main>;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 pb-6 text-white sm:px-6">
      <div className="mx-auto max-w-[1500px] space-y-5">
        {/* Pinned together: project identity, back action and BOQ page tabs. */}
        <div className="sticky top-0 z-40 -mx-4 border-b border-slate-800 bg-slate-950/95 px-4 pb-3 pt-3 shadow-lg backdrop-blur sm:-mx-6 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <button type="button" onClick={() => navigate('/pre-contract-boq')}
              className="mb-2 text-sm text-cyan-300 hover:underline">← Saved BOQ Projects</button>
            <h1 className="text-2xl font-bold">{project?.projectName || 'Pre-Contract BOQ'} · Analysis</h1>
            <p className="mt-1 text-xs text-slate-400">Visual commercial simulation · {projectId}</p>
          </div>
          <button type="button" onClick={() => navigate(`/pre-contract-boq/${encodeURIComponent(projectId)}`)}
            className="rounded border border-slate-700 px-3 py-2 text-sm hover:border-cyan-500">Back to Costing</button>
        </header>

        <nav aria-label="BOQ project pages" className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate(`/pre-contract-boq/${encodeURIComponent(projectId)}`)}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:text-cyan-300">1 · BOQ Costing</button>
          <span aria-current="page" className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">2 · BOQ Analysis</span>
        </nav>
        </div>

        {error && <div role="alert" className="rounded border border-red-600/50 bg-red-950/40 p-3 text-sm text-red-200">{error}</div>}
        {notice && <div role="status" className="rounded border border-emerald-600/40 bg-emerald-950/30 p-3 text-sm text-emerald-200">{notice}</div>}
        {project && project.applications.length === 0 &&
          <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
            No applications yet. Open BOQ Costing to import or add layers.
          </div>}

        {project && project.applications.length > 0 && preview && saved && (
          <>
            <section className="rounded-xl border border-slate-700 bg-slate-900 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Analysis scope</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    These filters control all KPIs, pie charts and bar charts below.
                  </p>
                </div>
                <span className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400">
                  {isLayerScope ? `${selectedLayers.length} selected layers` : applicationFilter === 'All' ? 'Whole BOQ' : 'One application'}
                </span>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,270px)_minmax(0,1fr)]">
                <label className="space-y-1.5 text-sm">
                  <span className="text-xs font-medium text-slate-300">Application</span>
                  <select aria-label="Filter analysis by application" value={applicationFilter}
                    onChange={(event) => {
                      setApplicationFilter(event.target.value);
                      setSelectedLayerIds([]);
                      setLayerSearch('');
                      resetSliders();
                    }}
                    className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-cyan-400 focus:outline-none">
                    <option value="All">All applications</option>
                    {project.applications.map((app) =>
                      <option value={app.application} key={app.application}>{app.application}</option>)}
                  </select>
                  <p className="text-[11px] text-slate-400">Filters charts and available layer choices.</p>
                </label>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-300">Layers to analyse / adjust (multiple selection)</span>
                    <span className="text-xs text-cyan-300">{selectedLayers.length} selected</span>
                  </div>
                  <input type="search" value={layerSearch} onChange={(event) => setLayerSearch(event.target.value)}
                    placeholder="Find a layer, application or surface" aria-label="Search available layers"
                    className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm focus:border-cyan-400 focus:outline-none"/>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setVisibleSelection(true)} disabled={!searchableLayers.length}
                      className="rounded border border-slate-600 px-2.5 py-1 text-xs text-cyan-200 hover:border-cyan-500 disabled:opacity-40">
                      Select all matching
                    </button>
                    <button type="button" onClick={() => setVisibleSelection(false)} disabled={!selectedLayers.length}
                      className="rounded border border-slate-600 px-2.5 py-1 text-xs hover:border-cyan-500 disabled:opacity-40">
                      Clear matching
                    </button>
                    <button type="button" onClick={() => {setSelectedLayerIds([]);resetSliders();}}
                      className="rounded border border-slate-600 px-2.5 py-1 text-xs hover:border-cyan-500">
                      Summary view (all layers)
                    </button>
                  </div>
                  <div role="group" aria-label="Select multiple BOQ layers" className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-2 sm:grid-cols-2">
                    {searchableLayers.map((layer) => (
                      <label key={layer.layer_id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-800">
                        <input type="checkbox" checked={selectedIdSet.has(layer.layer_id)}
                          onChange={() => toggleLayer(layer.layer_id)} className="h-4 w-4 accent-cyan-400"/>
                        <span className="min-w-0 truncate" title={`${layer.application} · ${layer.work_layer} · ${layer.surface}`}>
                          {layer.application} · {layer.work_layer} · {layer.surface}
                        </span>
                      </label>
                    ))}
                    {!searchableLayers.length && <p className="p-2 text-xs text-slate-400">No layers found.</p>}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs text-cyan-300">Viewing: {scopedLabel}</p>
              {isLayerScope &&
                <p className="mt-1 text-xs text-slate-400">
                  Selected-layer charts exclude application Consumables. Clear the selection to view full application costs, including Consumables.
                </p>}
            </section>

            <section className="rounded-xl border border-slate-700 bg-slate-900 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">What-if simulation</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Check one or more layers above, then adjust the percentages. Each layer keeps its own starting rate and productivity. Nothing is saved until Apply Changes.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-slate-700 px-3 py-2 text-xs text-cyan-200">
                    {pending.changes.length} pending layer edit(s)
                  </span>
                  <button type="button" disabled={saving || pending.changes.length === 0}
                    onClick={() => { setDrafts({}); resetSliders(); setNotice(''); }}
                    className="rounded-md border border-slate-600 px-3 py-2 text-xs hover:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">
                    Discard Preview
                  </button>
                  {isAdmin && <button type="button" onClick={applyChanges}
                    disabled={saving || pending.changes.length === 0}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">
                    {saving ? 'Saving...' : 'Apply Changes'}
                  </button>}
                </div>
              </div>

              {!selectedLayers.length ? (
                <div className="mt-4 rounded-lg border border-dashed border-slate-700 bg-slate-950/50 p-5 text-sm text-slate-400">
                  Select one or more layer checkboxes above to enable the sliders. Without a selection, KPIs and charts show the full application/project summary.
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-950/70 p-3">
                    <div>
                      <p className="font-semibold text-white">{selectedLayers.length} selected layer{selectedLayers.length === 1 ? '' : 's'}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {productivityEligible.length} with baseline productivity · {rateEligible.length} billable layers with existing client rates · {selectedPendingCount} selected layer(s) with staged changes
                      </p>
                    </div>
                    <button type="button" onClick={resetSelectedLayers} disabled={saving || selectedPendingCount === 0}
                      className="rounded border border-slate-600 px-3 py-2 text-xs hover:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">
                      Reset selected layers
                    </button>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <PercentageSlider
                      label="Labour productivity" shift={productivityShift}
                      disabled={!isAdmin || saving || !productivityEligible.length}
                      onChange={(value) => updateGroupShift('productivity', value)}
                      detail={`Change productivity relative to EACH selected layer’s saved value (${productivityEligible.length}/${selectedLayers.length} eligible). Higher productivity reduces labour cost.`}
                    />
                    <PercentageSlider
                      label="Proposed client rate" shift={clientRateShift}
                      disabled={!isAdmin || saving || !rateEligible.length}
                      onChange={(value) => updateGroupShift('clientRate', value)}
                      detail={`Change each selected billable layer’s existing rate (${rateEligible.length}/${selectedLayers.length} eligible). Non-billable or zero-rate layers are not repriced.`}
                    />
                  </div>
                  <p className="text-xs text-slate-400">
                    A +10% shift means each selected layer’s own saved value × 1.10; values are not made identical. Material pricing, labour cost/day, billability and effective area remain fixed. Staged changes outside the selection stay intact.
                  </p>
                </div>
              )}
              {!isAdmin && <p className="mt-3 text-xs text-amber-200">Viewer mode: simulations are read-only. Only admins can apply changes.</p>}
            </section>

            {preview.incompleteLayerCount > 0 &&
              <p className="rounded-lg border border-amber-600/40 bg-amber-950/30 p-3 text-xs text-amber-200">
                {preview.incompleteLayerCount} layer(s) in this analysis scope have incomplete costing inputs. Estimates may be understated.
              </p>}

            <section aria-label="Filtered analysis KPIs" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Estimated Cost" value={currency(preview.totalCost)} delta={preview.totalCost - saved.totalCost}/>
              <Kpi label="Proposed Revenue" value={currency(preview.revenue)} delta={preview.revenue - saved.revenue}/>
              <Kpi label="Projected Profit" value={currency(preview.profit)} delta={preview.profit - saved.profit}/>
              <Kpi label="Achieved Margin" value={percent(preview.profitMargin)}
                delta={preview.profitMargin == null || saved.profitMargin == null
                  ? null : preview.profitMargin - saved.profitMargin} percentagePoints/>
            </section>
            <p className="-mt-2 text-xs text-slate-400">KPI scope: {scopedLabel}. Changes vs the saved values for this same scope.</p>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border border-slate-700 bg-slate-900 p-4">
                <h2 className="text-base font-semibold">Cost composition</h2>
                <p className="mb-4 mt-1 text-xs text-slate-400">Labour, material and Consumables for: {scopedLabel}</p>
                <CostPie labour={preview.labourCost} material={preview.materialCost} consumables={preview.consumablesCost}/>
              </section>
              <section className="rounded-xl border border-slate-700 bg-slate-900 p-4">
                <h2 className="text-base font-semibold">Cost vs Revenue</h2>
                <p className="mb-4 mt-1 text-xs text-slate-400">
                  {isLayerScope ? `${selectedLayers.length} selected layers grouped by application` : applicationFilter === 'All'
                    ? 'Each application in this BOQ' : 'Selected application only'}
                </p>
                <ApplicationBars
                  applications={preview.applications}
                />
              </section>
            </div>
            <section className="rounded-xl border border-slate-700 bg-slate-900 p-4">
              <div className="mb-4">
                <h2 className="text-base font-semibold">{isLayerScope ? 'Profitability of selected layers by application' : 'Profitability by application'}</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Visual profit comparison for {scopedLabel.toLowerCase()}. No duplicate editing table.
                </p>
              </div>
              <ProfitBars applications={preview.applications}/>
            </section>
            <p className="text-xs text-slate-500">
              Analysis is separate from the editable BOQ Costing sheet. The saved Work Order, Assignment and Billing modules are unaffected. Apply saves only the staged layer productivity and billable client rates.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function PercentageSlider({ label, shift, disabled, detail, onChange }: {
  label: string;
  shift: number;
  disabled: boolean;
  detail: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-1 text-[11px] text-slate-400">Relative adjustment for selected layers</p>
        </div>
        <span className="font-mono text-lg font-semibold text-cyan-300">
          {shift > 0 ? '+' : ''}{shift}%
        </span>
      </div>
      <input type="range" min={percentageBounds.min} max={percentageBounds.max}
        step={percentageBounds.step} value={shift} disabled={disabled}
        aria-label={`${label} percentage adjustment`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-4 w-full cursor-pointer accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"/>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>-50%</span><span>Saved baseline · 0%</span><span>+100%</span>
      </div>
      <p className="mt-3 text-[11px] text-slate-400">{detail}</p>
    </div>
  );
}

function Kpi({ label, value, delta, percentagePoints = false }: {
  label: string;
  value: string;
  delta: number | null;
  percentagePoints?: boolean;
}) {
  const difference = delta == null ? '—'
    : percentagePoints ? `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pp`
      : `${delta >= 0 ? '+' : ''}${currency(delta)}`;
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-2 break-words text-lg font-bold text-cyan-200">{value}</p>
      <p className="mt-2 text-[11px] text-slate-400">vs saved: {difference}</p>
    </div>
  );
}

function CostPie({ labour, material, consumables }: {
  labour: number; material: number; consumables: number;
}) {
  const values = [
    { name: 'Labour', value: labour, color: '#22d3ee' },
    { name: 'Materials', value: material, color: '#a78bfa' },
    { name: 'Consumables', value: consumables, color: '#fbbf24' },
  ];
  const total = labour + material + consumables;
  let progress = 0;
  const gradientParts = values.map((item) => {
    const from = progress;
    progress += total > 0 ? item.value / total * 100 : 0;
    return `${item.color} ${from}% ${progress}%`;
  });
  const gradient = total > 0
    ? `conic-gradient(${gradientParts.join(', ')})`
    : 'conic-gradient(#334155 0% 100%)';
  return (
    <div className="flex flex-wrap items-center justify-center gap-8">
      <div role="img" aria-label={values.map((item) => `${item.name} ${currency(item.value)}`).join(', ')}
        className="relative h-48 w-48 shrink-0 rounded-full" style={{ background: gradient }}>
        <div className="absolute inset-9 flex flex-col items-center justify-center rounded-full bg-slate-900 text-center">
          <span className="text-[11px] text-slate-400">Total Cost</span>
          <span className="text-sm font-bold">{currency(total)}</span>
        </div>
      </div>
      <div className="space-y-3">
        {values.map((value) => (
          <div key={value.name} className="flex items-center gap-2 text-xs">
            <span className="h-3 w-3 rounded" style={{ background: value.color }}/>
            <span className="w-24 text-slate-300">{value.name}</span>
            <span className="font-mono">{total ? Math.round(value.value / total * 100) : 0}%</span>
            <span className="text-slate-400">{currency(value.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApplicationBars({ applications }: { applications: PreviewApplication[] }) {
  const maximum = Math.max(1, ...applications.flatMap((app) => [app.totalCost, app.revenue]));
  return (
    <div className="max-h-[360px] space-y-4 overflow-y-auto">
      <div className="flex gap-5 text-xs text-slate-400">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-cyan-400"/>Cost</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-emerald-400"/>Revenue</span>
      </div>
      {applications.map((app) => (
        <div key={app.application}>
          <p className="mb-1 truncate text-xs font-semibold text-slate-300" title={app.application}>{app.application}</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="h-3 flex-1 rounded bg-slate-800">
                <div className="h-3 rounded bg-cyan-400" style={{ width: `${app.totalCost / maximum * 100}%` }}/>
              </div>
              <span className="w-28 shrink-0 text-right font-mono text-[11px]">{currency(app.totalCost)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 flex-1 rounded bg-slate-800">
                <div className="h-3 rounded bg-emerald-400" style={{ width: `${app.revenue / maximum * 100}%` }}/>
              </div>
              <span className="w-28 shrink-0 text-right font-mono text-[11px]">{currency(app.revenue)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProfitBars({ applications }: { applications: PreviewApplication[] }) {
  const maxMagnitude = Math.max(1, ...applications.map((app) => Math.abs(app.profit)));
  return (
    <div className="max-h-[300px] space-y-4 overflow-y-auto">
      {applications.map((app) => (
        <div key={app.application}>
          <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-300">{app.application}</span>
            <span className={app.profit < 0 ? 'text-red-300' : 'text-emerald-300'}>
              {currency(app.profit)} · {percent(app.profitMargin)} margin
            </span>
          </div>
          <div className="h-3 rounded bg-slate-800">
            <div className={`h-3 rounded ${app.profit < 0 ? 'bg-red-400' : 'bg-emerald-400'}`}
              style={{ width: `${Math.abs(app.profit) / maxMagnitude * 100}%` }}/>
          </div>
        </div>
      ))}
    </div>
  );
}
