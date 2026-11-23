'use client';

import { useEffect, useMemo, useState } from 'react';
import { oemApi } from '../../lib/oemApi';
import type { NewOemMaterial, OemMasterData, OemMaterial } from '../../lib/oemApi';

const inputClass = 'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400';
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
type MaterialForm = {
  brand: string;
  newBrand: string;
  category: string;
  newCategory: string;
  selectedMaterial: string;
  newMaterial: string;
  packSize: string;
  unit: 'KG' | 'L' | 'Piece';
};
const blankForm: MaterialForm = {
  brand: '', newBrand: '', category: '', newCategory: '', selectedMaterial: '__new__',
  newMaterial: '', packSize: '', unit: 'KG',
};

export default function OemMaterialsPage() {
  const [token, setToken] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [metadata, setMetadata] = useState<OemMasterData>({ brands: [], categories: [], projects: [] });
  const [materials, setMaterials] = useState<OemMaterial[]>([]);
  const [form, setForm] = useState<MaterialForm>(blankForm);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);

  async function load(t: string) {
    const [master, catalog] = await Promise.all([oemApi.masterData(t), oemApi.materials(t)]);
    setMetadata(master);
    setMaterials(catalog);
  }
  useEffect(() => {
    const t = localStorage.getItem('zos_access_token') || '';
    let role = '';
    try { role = String(JSON.parse(localStorage.getItem('zos_user') || '{}').role || '').toLowerCase(); } catch { /* invalid user */ }
    setToken(t); setIsAdmin(role === 'admin');
    if (!t) return;
    let cancelled = false;
    Promise.all([oemApi.masterData(t), oemApi.materials(t)])
      .then(([master, catalog]) => { if (!cancelled) { setMetadata(master); setMaterials(catalog); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load OEM catalogue'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const brandName = form.brand === '__new__' ? form.newBrand.trim() : form.brand;
  const categoryName = form.category === '__new__' ? form.newCategory.trim() : form.category;
  const matching = useMemo(() => materials.filter(m =>
    norm(m.brandName) === norm(brandName) && norm(m.categoryName) === norm(categoryName)),
  [materials, brandName, categoryName]);
  const picked = matching.find(m => m.materialId === form.selectedMaterial);
  const selectedMaterialName = picked ? picked.materialName : form.newMaterial.trim();
  const selectedUnit = picked?.unit || form.unit;
  const packAlreadyExists = Boolean(picked?.packs.some(p => Number(p.packSize) === Number(form.packSize) && Number(form.packSize) > 0));
  const duplicateNewName = !picked && matching.some(m => norm(m.materialName) === norm(form.newMaterial));
  const canSave = Boolean(brandName && categoryName && selectedMaterialName && Number(form.packSize) > 0 && !packAlreadyExists && !duplicateNewName && !busy);
  const shownMaterials = useMemo(() => {
    const q = norm(search);
    return materials.filter(m => !q || norm(`${m.brandName} ${m.categoryName} ${m.materialName} ${m.unit} ${m.packs.map(p => p.packSize).join(' ')}`).includes(q));
  }, [materials, search]);
  const packCount = materials.reduce((sum, m) => sum + m.packs.length, 0);

  function openForm() {
    setForm(blankForm); setError(''); setSuccess(''); setShowForm(true);
  }
  function chooseBrand(v: string) {
    setForm(f => ({ ...f, brand: v, newBrand: '', selectedMaterial: '__new__', newMaterial: '' }));
  }
  function chooseCategory(v: string) {
    setForm(f => ({ ...f, category: v, newCategory: '', selectedMaterial: '__new__', newMaterial: '' }));
  }
  function chooseMaterial(v: string) {
    setForm(f => ({ ...f, selectedMaterial: v, newMaterial: '', unit: matching.find(m => m.materialId === v)?.unit || f.unit, packSize: '' }));
  }
  async function register(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true); setError(''); setSuccess('');
    const payload: NewOemMaterial = {
      brandName, categoryName,
      materialName: selectedMaterialName,
      ...(picked ? { materialId: picked.materialId } : {}),
      packSize: Number(form.packSize), unit: selectedUnit,
    };
    try {
      await oemApi.registerMaterial(token, payload);
      await load(token);
      setShowForm(false);
      setForm(blankForm);
      setSuccess(`${brandName} · ${selectedMaterialName} · ${payload.packSize} ${selectedUnit} registered successfully.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to register material'); }
    finally { setBusy(false); }
  }
  function toggle(id: string) { setExpanded(s => s.includes(id) ? s.filter(v => v !== id) : [...s, id]); }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-xl font-bold">Material Catalogue</h2>
          <p className="mt-1 text-sm text-slate-400">Register each material once and add any number of unique pack sizes. Quotation prices are stored separately.</p></div>
        {isAdmin && <button onClick={openForm} className="rounded-lg bg-cyan-500 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-400">+ Add Material</button>}
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>}
      {success && <div role="status" className="rounded-lg border border-emerald-700 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">{success}</div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([['Brands', metadata.brands.length], ['Categories', metadata.categories.length], ['Materials', materials.length], ['Pack sizes', packCount]] as const).map(([label, count]) => (
          <div key={label} className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-2xl font-bold text-cyan-300">{count}</p></div>
        ))}
      </div>
      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
          <h3 className="font-semibold">Registered materials</h3>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by brand, category, material or pack" className={`${inputClass} max-w-md`} />
        </div>
        {loading ? <div className="p-8 text-slate-400">Loading materials...</div> : shownMaterials.length === 0 ?
          <div className="p-10 text-center text-slate-400">No matching materials yet. Use Add Material to register one.</div> :
          <div className="divide-y divide-slate-800">{shownMaterials.map(m => (
            <div key={m.materialId}>
              <button onClick={() => toggle(m.materialId)} className="flex w-full flex-wrap items-center gap-3 px-4 py-4 text-left hover:bg-slate-800/50">
                <span className="text-cyan-400">{expanded.includes(m.materialId) ? '▾' : '▸'}</span>
                <span className="min-w-[240px] flex-1"><span className="block font-semibold">{m.brandName} · {m.materialName}</span><span className="text-xs text-slate-400">{m.categoryName} · {m.unit}</span></span>
                <span className="text-sm text-slate-300">{m.packs.length} pack size(s)</span>
                <span className="flex flex-wrap gap-1">{m.packs.slice(0, 4).map(p => <span key={p.packId} className="rounded bg-slate-800 px-2 py-1 text-xs">{p.packSize} {m.unit}</span>)}{m.packs.length > 4 && <span className="text-xs text-slate-400">+{m.packs.length - 4}</span>}</span>
              </button>
              {expanded.includes(m.materialId) && <div className="border-t border-slate-800 bg-slate-950/60 px-6 py-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Already registered packs</p>
                <div className="flex flex-wrap gap-2">{m.packs.map(p => <span key={p.packId} className="rounded-lg border border-slate-700 px-3 py-2 text-sm">{p.packSize} {m.unit}</span>)}</div>
                {isAdmin && <button onClick={() => { setForm({ ...blankForm, brand: m.brandName, category: m.categoryName, selectedMaterial: m.materialId, unit: m.unit }); setError(''); setShowForm(true); }} className="mt-3 text-sm font-semibold text-cyan-300 hover:underline">+ Register another pack size</button>}
              </div>}
            </div>
          ))}</div>}
        <div className="border-t border-slate-800 px-4 py-3 text-xs text-slate-400">{shownMaterials.length} material(s) shown · one record per material, with separate pack sizes</div>
      </section>

      {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-6" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setShowForm(false); }}>
        <div role="dialog" aria-modal="true" aria-labelledby="oem-mat-title" className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-7">
          <div className="mb-5 flex items-start justify-between gap-3"><div><h3 id="oem-mat-title" className="text-xl font-bold">Add Material / Pack Size</h3><p className="mt-1 text-sm text-slate-400">Choose existing values or add a new brand, category or material.</p></div><button disabled={busy} onClick={() => setShowForm(false)} className="rounded border border-slate-700 px-3 py-1 text-sm">Close</button></div>
          {error && <div role="alert" className="mb-4 rounded border border-red-700 bg-red-950/40 p-3 text-sm text-red-200">{error}</div>}
          <form onSubmit={register} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm"><span className="font-semibold">1. Brand *</span>
                <select required className={inputClass} value={form.brand} onChange={e => chooseBrand(e.target.value)}><option value="">Select brand</option>{metadata.brands.map(b => <option key={b.brandId} value={b.brandName}>{b.brandName}</option>)}<option value="__new__">+ Add new brand</option></select>
                {form.brand === '__new__' && <input required maxLength={160} className={inputClass} value={form.newBrand} onChange={e => setForm(f => ({ ...f, newBrand: e.target.value }))} placeholder="Enter new brand name" />}
              </label>
              <label className="space-y-2 text-sm"><span className="font-semibold">2. Category *</span>
                <select required className={inputClass} value={form.category} onChange={e => chooseCategory(e.target.value)}><option value="">Select category</option>{metadata.categories.map(c => <option key={c.categoryId} value={c.categoryName}>{c.categoryName}</option>)}<option value="__new__">+ Add new category</option></select>
                {form.category === '__new__' && <input required maxLength={160} className={inputClass} value={form.newCategory} onChange={e => setForm(f => ({ ...f, newCategory: e.target.value }))} placeholder="Enter new category name" />}
              </label>
            </div>
            <label className="block space-y-2 text-sm"><span className="font-semibold">3. Material Name *</span>
              <select className={inputClass} disabled={!brandName || !categoryName} value={form.selectedMaterial} onChange={e => chooseMaterial(e.target.value)}>
                <option value="__new__">+ Register new material name</option>{matching.map(m => <option key={m.materialId} value={m.materialId}>{m.materialName}</option>)}
              </select>
              {(!picked) && <input required maxLength={240} className={inputClass} value={form.newMaterial} onChange={e => setForm(f => ({ ...f, newMaterial: e.target.value }))} placeholder="Enter new material name" />}
              <span className="block text-xs text-slate-400">{matching.length} existing material name(s) for this brand and category.</span>
            </label>
            {picked && <div className="rounded-lg border border-slate-700 bg-slate-950 p-4"><p className="text-sm font-semibold">Already registered packs for {picked.materialName}</p><div className="mt-2 flex flex-wrap gap-2">{picked.packs.map(p => <span key={p.packId} className="rounded-md bg-slate-800 px-3 py-1 text-xs">{p.packSize} {picked.unit}</span>)}</div><p className="mt-2 text-xs text-slate-400">A duplicate pack size will not be accepted. Unit is locked for the existing material.</p></div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm"><span className="font-semibold">4. New Pack Size *</span><input required min="0.0001" step="0.0001" type="number" className={inputClass} value={form.packSize} onChange={e => setForm(f => ({ ...f, packSize: e.target.value }))} placeholder="e.g. 30 or 40" /></label>
              <label className="space-y-2 text-sm"><span className="font-semibold">5. Unit *</span><select disabled={Boolean(picked)} className={inputClass} value={selectedUnit} onChange={e => setForm(f => ({ ...f, unit: e.target.value as MaterialForm['unit'] }))}><option value="KG">KG</option><option value="L">L</option><option value="Piece">Piece</option></select></label>
            </div>
            {packAlreadyExists && <p className="text-sm text-amber-300">This pack size is already registered for {picked?.materialName}.</p>}
            {duplicateNewName && <p className="text-sm text-amber-300">That material name already exists. Choose it from the dropdown to add a pack.</p>}
            <div className="flex justify-end gap-2 border-t border-slate-800 pt-4"><button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-600 px-4 py-2">Cancel</button><button disabled={!canSave} type="submit" className="rounded-lg bg-cyan-500 px-5 py-2 font-semibold text-slate-950 disabled:opacity-40">{busy ? 'Registering...' : 'Register Material / Pack'}</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}