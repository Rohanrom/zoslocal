'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BoqProjectListItem, preContractBoqApi } from '../../lib/preContractBoqApi';
import type { User } from '../../lib/api';

export default function PreContractBoqProjectsPage() {
  const router=useRouter();
  const [token,setToken]=useState('');
  const [isAdmin,setIsAdmin]=useState(false);
  const [projects,setProjects]=useState<BoqProjectListItem[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [name,setName]=useState('');
  const [adding,setAdding]=useState(false);
  useEffect(()=>{
    const t=localStorage.getItem('zos_access_token');
    const u=localStorage.getItem('zos_user');
    if(!t){router.replace('/');return;}
    let user:User|null=null;
    try {user=u?JSON.parse(u) as User:null;}catch { /* invalid session */ }
    if(!user || !['admin','viewer'].includes(user.role.toLowerCase())){router.replace('/projects');return;}
    setIsAdmin(user.role.toLowerCase()==='admin');setToken(t);
    preContractBoqApi.list(t).then(setProjects).catch(e=>setError(String(e.message))).finally(()=>setLoading(false));
  },[router]);
  async function refresh(){setProjects(await preContractBoqApi.list(token));}
  async function addProject(e:React.FormEvent) {
    e.preventDefault();if(!name.trim()||busy)return;
    setBusy(true);setError('');
    try {const item=await preContractBoqApi.create(token,name);setAdding(false);setName('');router.push(`/pre-contract-boq/${encodeURIComponent(item.projectId)}`);}
    catch(e){setError(e instanceof Error?e.message:'Failed to create BOQ project');}
    finally{setBusy(false);}
  }
  async function deleteProject(project:BoqProjectListItem){
    if(!isAdmin)return;
    const confirmation=window.prompt(`PERMANENT DELETE: Type the exact project name (${project.projectName}) to delete all its Pre-Contract BOQ data. This cannot be undone.`);
    if(confirmation!==project.projectName)return;
    setBusy(true);setError('');
    try{await preContractBoqApi.delete(token,project.projectId);await refresh();}
    catch(e){setError(e instanceof Error?e.message:'Failed to delete BOQ project');}
    finally{setBusy(false);}
  }
  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-8">
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><button onClick={()=>router.push('/projects')} className="mb-3 text-sm text-cyan-300 hover:underline">← All ZOS tiles</button>
          <h1 className="font-display text-3xl font-bold">Pre-Contract BOQ</h1>
          <p className="mt-1 text-sm text-slate-400">Independent bid costing and commercial evaluation. No operational project is created here.</p>
        </div>
        {isAdmin&&<button onClick={()=>setAdding(v=>!v)} className="rounded-lg bg-cyan-500 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-400">+ Add BOQ Project</button>}
      </div>
      {error&&<div role="alert" className="rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200">{error}</div>}
      {adding&&<form onSubmit={addProject} className="flex flex-wrap gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <input autoFocus maxLength={200} required value={name} onChange={e=>setName(e.target.value)} placeholder="Enter BOQ project name" className="min-w-64 flex-1 rounded-lg border border-slate-600 bg-slate-950 p-3 text-sm outline-none focus:border-cyan-400"/>
        <button disabled={busy||!name.trim()} type="submit" className="rounded-lg bg-cyan-500 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">Create Project</button>
        <button type="button" onClick={()=>setAdding(false)} className="rounded-lg border border-slate-600 px-4 py-3 text-sm">Cancel</button>
      </form>}
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Saved BOQ Projects</h2><span className="text-sm text-slate-400">{projects.length} project(s)</span></div>
      {loading?<p className="text-slate-400">Loading saved estimates...</p>:
        projects.length===0?<div className="rounded-xl border border-dashed border-slate-700 p-12 text-center text-slate-400">No saved BOQ projects yet. Create one to import a tender BOQ.</div>:
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{projects.map(p=><div key={p.projectId} className="flex flex-col rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-lg">
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-xl font-bold">{p.projectName}</h3><p className="mt-1 break-all font-mono text-xs text-slate-500">{p.projectId}</p></div>
            {isAdmin&&<button disabled={busy} aria-label={`Delete ${p.projectName}`} title="Delete permanently" onClick={()=>deleteProject(p)} className="rounded-lg border border-red-500/30 px-2 py-1 text-sm text-red-300 hover:bg-red-950 disabled:opacity-50">Delete</button>}</div>
          <p className="mt-4 text-sm text-slate-400">{p.applicationCount} applications · {p.layerCount} layers</p>
          <p className="mt-1 text-xs text-slate-500">Last updated {new Date(p.updatedAt).toLocaleString('en-IN')}</p>
          <button onClick={()=>router.push(`/pre-contract-boq/${encodeURIComponent(p.projectId)}`)} className="mt-5 rounded-lg bg-cyan-500 p-3 text-center font-semibold text-slate-950 hover:bg-cyan-400">Open BOQ Analysis</button>
        </div>)}</div>}
    </div>
  </main>;
}
