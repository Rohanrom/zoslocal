'use client';

import { useEffect, useMemo, useState } from 'react';
import { oemApi } from '../../../lib/oemApi';
import type { OemMasterData, OemMaterial, OemQuotation, OemQuotationSummary, QuotationInput } from '../../../lib/oemApi';

const field = 'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-400 disabled:opacity-60';
const money = (v: number) => Number.isFinite(v) ? `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : '—';
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
type DraftLine = { key: string; packId: string; price: string; coverage: string; remark: string };
let nextKey = 0;
const newLine = (): DraftLine => ({ key: `line-${++nextKey}`, packId: '', price: '', coverage: '', remark: '' });

export default function OemQuotationsPage() {
  const [token, setToken] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [master, setMaster] = useState<OemMasterData>({ brands: [], categories: [], projects: [] });
  const [materials, setMaterials] = useState<OemMaterial[]>([]);
  const [items, setItems] = useState<OemQuotationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [projectFilter, setProjectFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [audit, setAudit] = useState<OemQuotation | null>(null);
  const [projectId, setProjectId] = useState('');
  const [quotationDate, setQuotationDate] = useState(today());
  const [quoteLines, setQuoteLines] = useState<DraftLine[]>([newLine()]);
  const [addingProject, setAddingProject] = useState(false);
  const [newProject, setNewProject] = useState('');

  const allPacks = useMemo(() => materials.flatMap(m => m.packs.map(p => ({
    packId: p.packId, packSize: Number(p.packSize), unit: m.unit,
    label: `${m.brandName} · ${m.materialName} · ${p.packSize} ${m.unit}`,
    category: m.categoryName,
  }))), [materials]);
  const packMap = useMemo(() => new Map(allPacks.map(p => [p.packId, p])), [allPacks]);
  const selectedPacks = useMemo(() => new Set(quoteLines.map(l => l.packId).filter(Boolean)), [quoteLines]);

  async function refresh(t: string, targetPage = page, project = projectFilter) {
    const result = await oemApi.quotations(t, targetPage, project || undefined);
    setItems(result.items); setTotal(result.total);
  }
  useEffect(() => {
    const t = localStorage.getItem('zos_access_token') || '';
    let role = '';
    try { role = String(JSON.parse(localStorage.getItem('zos_user') || '{}').role || '').toLowerCase(); } catch { /* invalid user */ }
    setToken(t); setIsAdmin(role === 'admin');
    if (!t) return;
    let cancelled = false;
    Promise.all([oemApi.masterData(t), oemApi.materials(t), oemApi.quotations(t, 1)])
      .then(([m, mats, q]) => { if (!cancelled) { setMaster(m); setMaterials(mats); setItems(q.items); setTotal(q.total); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load OEM quotations'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  async function changeFilter(v: string) {
    setProjectFilter(v); setPage(1); setError('');
    try { await refresh(token, 1, v); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to filter quotations'); }
  }
  async function changePage(target: number) {
    setLoading(true); setError('');
    try { await refresh(token, target); setPage(target); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load page'); }
    finally { setLoading(false); }
  }
  function openNew() {
    setEditingId(null); setAudit(null); setProjectId(projectFilter || '');
    setQuotationDate(today()); setQuoteLines([newLine(), newLine(), newLine()]);
    setAddingProject(false); setNewProject(''); setError(''); setEditor(true);
  }
  async function openExisting(id: string) {
    setBusy(true); setError('');
    try {
      const q = await oemApi.quotation(token, id);
      setEditingId(q.quotationId); setAudit(q); setProjectId(q.projectId);
      setQuotationDate(q.quotationDate);
      setQuoteLines(q.lines.map(l => ({ key: newLine().key, packId: l.packId, price: String(l.packPrice), coverage: String(l.coverage), remark: l.remark || '' })));
      setAddingProject(false); setNewProject(''); setEditor(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to open quotation'); }
    finally { setBusy(false); }
  }
  function changeLine(key: string, fieldName: keyof DraftLine, value: string) {
    setQuoteLines(ls => ls.map(l => l.key === key ? { ...l, [fieldName]: value } : l));
  }
  async function registerProject() {
    if (!newProject.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const project = await oemApi.addProject(token, newProject.trim());
      const updated = await oemApi.masterData(token);
      setMaster(updated); setProjectId(project.projectId); setAddingProject(false); setNewProject('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to register OEM project'); }
    finally { setBusy(false); }
  }
  const completeLines = quoteLines.filter(l => l.packId && Number(l.price) > 0 && Number(l.coverage) > 0);
  const duplicatePack = new Set(quoteLines.map(l => l.packId).filter(Boolean)).size !== quoteLines.filter(l => l.packId).length;
  const hasPartial = quoteLines.some(l => (l.packId || l.price.trim() || l.coverage.trim() || l.remark.trim()) &&
    !(l.packId && Number(l.price) > 0 && Number(l.coverage) > 0));
  const canSave = Boolean(projectId && quotationDate && completeLines.length && !hasPartial && !duplicatePack && !busy &&
    completeLines.every(l => Number.isFinite(Number(l.price)) && Number.isFinite(Number(l.coverage))));
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!isAdmin || !canSave) return;
    const input: QuotationInput = {
      projectId, quotationDate,
      lines: completeLines.map(l => ({ packId: l.packId, packPrice: Number(l.price), coverage: Number(l.coverage), remark: l.remark })),
    };
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = editingId ? await oemApi.updateQuotation(token, editingId, input) : await oemApi.createQuotation(token, input);
      setNotice(`Quotation ${saved.quotationId} saved with ${saved.lines.length} material line(s).`);
      setEditor(false); setAudit(null);
      setPage(1); await refresh(token, 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save quotation'); }
    finally { setBusy(false); }
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-bold">Site Quotations</h2><p className="mt-1 text-sm text-slate-400">Each quotation belongs to one independent OEM project. Material pack price and per-unit coverage are recorded per line.</p></div>
      {isAdmin && <button onClick={openNew} className="rounded-lg bg-cyan-500 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-400">+ New Quotation</button>}
    </div>
    {error && <div role="alert" className="rounded-lg border border-red-700 bg-red-950/30 px-4 py-3 text-sm text-red-200">{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-emerald-700 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">{notice}</div>}
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
        <div><h3 className="font-semibold">Saved quotations</h3><p className="text-xs text-slate-400">{total} quotation(s)</p></div>
        <select value={projectFilter} onChange={e => void changeFilter(e.target.value)} className={`${field} max-w-sm`} aria-label="Filter by OEM project"><option value="">All OEM projects</option>{master.projects.map(p => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}</select>
      </div>
      {loading ? <p className="p-8 text-slate-400">Loading quotations...</p> : items.length === 0 ?
        <div className="p-10 text-center text-slate-400">No saved quotations for this selection.</div> :
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-3">Quotation ID</th><th className="p-3">Date</th><th className="p-3">OEM project</th><th className="p-3">Lines</th><th className="p-3">Last updated</th><th className="p-3">Updated by</th><th className="p-3"></th></tr></thead>
          <tbody>{items.map(item => <tr key={item.quotationId} className="border-t border-slate-800 hover:bg-slate-800/40"><td className="p-3 font-mono font-semibold text-cyan-300">{item.quotationId}</td><td className="p-3">{item.quotationDate}</td><td className="p-3">{item.projectName}</td><td className="p-3">{item.lineCount}</td><td className="p-3 text-slate-400">{new Date(item.updatedAt).toLocaleString('en-IN')}</td><td className="p-3 text-slate-400">{item.updatedBy || '—'}</td><td className="p-3 text-right"><button disabled={busy} onClick={() => void openExisting(item.quotationId)} className="rounded-lg border border-slate-600 px-3 py-2 text-xs hover:border-cyan-400">{isAdmin ? 'View / Edit' : 'View'}</button></td></tr>)}</tbody>
        </table></div>}
      <div className="flex items-center justify-end gap-3 border-t border-slate-800 p-3 text-sm"><button disabled={loading || page <= 1} onClick={() => void changePage(page-1)} className="rounded border border-slate-700 px-3 py-2 disabled:opacity-40">Previous</button><span>Page {page} of {Math.max(1, Math.ceil(total/25))}</span><button disabled={loading || page*25 >= total} onClick={() => void changePage(page+1)} className="rounded border border-slate-700 px-3 py-2 disabled:opacity-40">Next</button></div>
    </section>

    {editor && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 px-2 py-4 sm:px-6" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="oem-q-title" className="my-auto max-h-[96vh] w-full max-w-[1360px] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 px-5 py-4">
          <div><h3 id="oem-q-title" className="text-xl font-bold">{editingId ? `Quotation ${editingId}` : 'New Quotation'}</h3><p className="text-xs text-slate-400">{editingId ? 'Edit the saved quotation and its material lines' : 'Quotation ID is assigned automatically when saved (Q0001, Q0002, …)'}</p></div>
          <button disabled={busy} onClick={() => { setEditor(false); setError(''); }} className="rounded-lg border border-slate-700 px-4 py-2 text-sm">Close</button>
        </div>
        <form onSubmit={save} className="space-y-5 p-4 sm:p-6">
          {error && <div role="alert" className="rounded border border-red-700 bg-red-950/30 p-3 text-sm text-red-200">{error}</div>}
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2 text-sm"><span className="font-semibold">Quotation ID</span><div className="flex h-[42px] items-center font-mono text-cyan-300">{editingId || 'Assigned on save'}</div></label>
            <label className="space-y-2 text-sm"><span className="font-semibold">Date *</span><input required disabled={!isAdmin} type="date" className={field} value={quotationDate} onChange={e => setQuotationDate(e.target.value)} /></label>
            <div className="space-y-2 text-sm"><label className="font-semibold" htmlFor="oem-quote-project">OEM Project *</label>
              <select id="oem-quote-project" required disabled={!isAdmin} className={field} value={projectId} onChange={e => { if (e.target.value === '__new__') setAddingProject(true); else { setAddingProject(false); setProjectId(e.target.value); } }}><option value="">Choose an OEM project</option>{master.projects.map(p => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}{isAdmin && <option value="__new__">+ Add new OEM project</option>}</select>
              {addingProject && <div className="flex flex-wrap gap-2"><input autoFocus maxLength={200} value={newProject} onChange={e => setNewProject(e.target.value)} className={`${field} min-w-40 flex-1`} placeholder="New OEM project name"/><button disabled={busy || !newProject.trim()} type="button" onClick={() => void registerProject()} className="rounded bg-cyan-500 px-3 py-2 font-semibold text-slate-950 disabled:opacity-40">Add</button><button type="button" onClick={() => setAddingProject(false)} className="rounded border border-slate-700 px-2">Cancel</button></div>}
            </div>
          </div>
          {audit && <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-400">Created {new Date(audit.createdAt).toLocaleString('en-IN')} by {audit.createdBy || '—'} · Last updated {new Date(audit.updatedAt).toLocaleString('en-IN')} by {audit.updatedBy || '—'}</div>}
          <div className="overflow-x-auto rounded-xl border border-slate-700"><table className="w-full min-w-[1060px] text-sm"><thead className="bg-slate-950 text-left text-xs uppercase tracking-wide text-slate-400"><tr><th className="w-10 p-3">#</th><th className="min-w-80 p-3">Material name + pack *</th><th className="p-3">Pack size</th><th className="p-3">Pack price (₹) *</th><th className="p-3">Per unit rate</th><th className="p-3">Coverage (SFT/unit/coat) *</th><th className="min-w-44 p-3">Remark</th><th className="p-3"></th></tr></thead>
          <tbody>{quoteLines.map((l, i) => {
            const pack = packMap.get(l.packId);
            const rate = pack && Number(l.price) > 0 ? Number(l.price) / pack.packSize : NaN;
            const costSft = Number(l.coverage) > 0 ? rate / Number(l.coverage) : NaN;
            return <tr key={l.key} className="border-t border-slate-700/80 align-top"><td className="p-3 text-slate-400">{i+1}</td><td className="p-2"><select disabled={!isAdmin} value={l.packId} onChange={e => changeLine(l.key, 'packId', e.target.value)} className={field} aria-label={`Material for line ${i+1}`}><option value="">Select material and pack size</option>{allPacks.map(p => <option key={p.packId} value={p.packId} disabled={selectedPacks.has(p.packId) && l.packId !== p.packId}>{p.label}</option>)}</select><p className="mt-1 text-xs text-slate-500">{pack?.category || 'Register missing materials in Material / OEM view first'}</p></td>
              <td className="p-2"><div className="pt-3 whitespace-nowrap">{pack ? `${pack.packSize} ${pack.unit}` : '—'}</div></td>
              <td className="p-2"><input disabled={!isAdmin} type="number" min="0.0001" step="0.0001" className={`${field} w-32`} value={l.price} onChange={e => changeLine(l.key, 'price', e.target.value)} placeholder="0" aria-label={`Pack price for line ${i+1}`} /></td>
              <td className="p-2"><div className="whitespace-nowrap pt-3 font-semibold text-cyan-300">{Number.isFinite(rate) ? `${money(rate)}/${pack?.unit}` : '—'}</div></td>
              <td className="p-2"><input disabled={!isAdmin} type="number" min="0.0001" step="0.0001" className={`${field} w-32`} value={l.coverage} onChange={e => changeLine(l.key, 'coverage', e.target.value)} placeholder="SFT / unit" aria-label={`Coverage for line ${i+1}`} /><p className="mt-1 text-xs text-slate-400">{Number.isFinite(costSft) ? `${money(costSft)} / SFT` : 'Per coat'}</p></td>
              <td className="p-2"><input disabled={!isAdmin} maxLength={1000} className={field} value={l.remark} onChange={e => changeLine(l.key, 'remark', e.target.value)} placeholder="Optional remark" aria-label={`Remark for line ${i+1}`} /></td>
              <td className="p-2">{isAdmin && <button type="button" disabled={quoteLines.length <= 1} onClick={() => setQuoteLines(ls => ls.filter(r => r.key !== l.key))} className="rounded border border-red-800 px-2 py-2 text-xs text-red-300 disabled:opacity-30">Remove</button>}</td>
            </tr>;
          })}</tbody></table></div>
          {isAdmin && <button type="button" onClick={() => setQuoteLines(ls => [...ls, newLine()])} className="w-full rounded-lg border border-dashed border-slate-600 px-3 py-3 text-sm text-cyan-300 hover:border-cyan-400">+ Add Line</button>}
          {duplicatePack && <p role="alert" className="text-sm text-amber-300">The same material and pack size cannot be repeated in one quotation.</p>}
          {hasPartial && <p className="text-sm text-amber-300">Complete or remove any partially filled lines before saving.</p>}
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-700 bg-slate-900/95 p-4 backdrop-blur">
            <p className="text-sm text-slate-400">{completeLines.length} complete line(s) · Per-unit price = Pack Price ÷ Pack Size</p>
            <div className="flex gap-2"><button type="button" onClick={() => { setEditor(false); setError(''); }} className="rounded-lg border border-slate-600 px-4 py-2">Close</button>{isAdmin && <button disabled={!canSave} type="submit" className="rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white disabled:opacity-40">{busy ? 'Saving...' : editingId ? 'Save Quotation Changes' : 'Save New Quotation'}</button>}</div>
          </div>
        </form>
      </section>
    </div>}
  </div>;
}