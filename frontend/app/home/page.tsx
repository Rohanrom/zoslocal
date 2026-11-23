'use client';

import Link from 'next/link';
import type { ProjectDirectoryProject } from '../../lib/api';
import { useSession } from '../../lib/session';
import { projectViewHref } from '../dashboard/view-routes';
import { useProjectDirectory } from '../components/shell/use-project-directory';

type WorkItem = {
  id: string;
  kind: 'Set up' | 'Watch';
  projectName: string;
  title: string;
  detail: string;
  href: string;
  action: string;
};

// Phase 1 of Home: items worked out from each project's setup state. Later
// phases add items published by Assignment, QC and Billing (core.work_item).
function workItemsFor(row: ProjectDirectoryProject, isAdmin: boolean): WorkItem[] {
  const items: WorkItem[] = [];
  const setupHref = isAdmin ? '/admin/project-setup' : projectViewHref(row.projectId);
  const setupAction = isAdmin ? 'Open project setup' : 'Open project';
  const c = row.counts;

  if (c.layers === 0) {
    items.push({ id: `${row.projectId}-layers`, kind: 'Set up', projectName: row.projectName, title: 'Import layer data', detail: 'Blocks, flats and layers come first; every other module needs them.', href: setupHref, action: setupAction });
  } else if (c.surfaces === 0) {
    items.push({ id: `${row.projectId}-surfaces`, kind: 'Set up', projectName: row.projectName, title: 'Import surface data', detail: 'Wall and ceiling areas drive progress, costing and billing.', href: setupHref, action: setupAction });
  } else if (c.boq === 0 && c.costing === 0) {
    items.push({ id: `${row.projectId}-boq`, kind: 'Set up', projectName: row.projectName, title: 'Import Cost / BOQ data', detail: 'Rates, productivity and materials turn the structure into a plan.', href: setupHref, action: setupAction });
  }

  if (row.setupStatus === 'Planning ready' && c.backend === 0) {
    items.push({ id: `${row.projectId}-reporting`, kind: 'Watch', projectName: row.projectName, title: 'No work reported yet', detail: 'Progress stays at 0% until site reporting starts.', href: projectViewHref(row.projectId), action: 'Open overview' });
  }
  return items;
}

const STATUS_STYLE: Record<string, string> = {
  'Planning ready': 'bg-emerald-400/10 text-emerald-300',
  'Structure ready': 'bg-sky-400/10 text-sky-300',
};

export default function HomePage() {
  const { role, user } = useSession();
  const { projects, error } = useProjectDirectory();
  const isAdmin = role === 'admin';

  const items = (projects ?? [])
    .flatMap((row) => workItemsFor(row, isAdmin))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'Set up' ? -1 : 1));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-white">Home</h1>
        <p className="text-sm text-slate-400">
          {user?.username ? `Signed in as ${user.username}. ` : ''}What needs attention across your projects.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <section aria-labelledby="home-actions" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="home-actions" className="font-display text-lg font-semibold text-white">Needs action</h2>
          <span className="font-mono text-sm text-slate-400">{projects ? items.length : '...'}</span>
        </div>
        {projects === null && !error && <p className="mt-4 text-sm text-slate-500">Loading...</p>}
        {projects !== null && items.length === 0 && (
          <p className="mt-4 text-sm text-slate-400">Nothing needs action right now.</p>
        )}
        <ul className="mt-2 divide-y divide-slate-800">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start gap-3 py-3">
              <span
                className={`mt-0.5 rounded-md px-2 py-0.5 text-xs font-semibold ${
                  item.kind === 'Set up' ? 'bg-amber-400/10 text-amber-300' : 'bg-sky-400/10 text-sky-300'
                }`}
              >
                {item.kind}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white">
                  {item.projectName}: {item.title}
                </div>
                <div className="text-sm text-slate-400">{item.detail}</div>
              </div>
              <Link href={item.href} className="inline-flex min-h-11 items-center text-sm font-medium text-sky-300 hover:text-sky-200">
                {item.action}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Assignment, QC and billing items will appear here as those modules start sending them.
        </p>
      </section>

      <section aria-labelledby="home-projects" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="home-projects" className="font-display text-lg font-semibold text-white">Projects</h2>
          <Link href="/projects" className="text-sm text-sky-300 hover:text-sky-200">All projects</Link>
        </div>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
          {(projects ?? []).map((row) => (
            <article key={row.projectId} className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-white">{row.projectName}</h3>
                  <p className="font-mono text-xs text-slate-500">{row.projectCode}</p>
                </div>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[row.setupStatus] ?? 'bg-amber-400/10 text-amber-300'}`}>
                  {row.setupStatus}
                </span>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Layers</dt>
                  <dd className="font-mono text-white">{row.counts.layers.toLocaleString('en-IN')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Flats</dt>
                  <dd className="font-mono text-white">{row.counts.flatAreas.toLocaleString('en-IN')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Reports</dt>
                  <dd className="font-mono text-white">{row.counts.backend.toLocaleString('en-IN')}</dd>
                </div>
              </dl>
              <div className="flex gap-4 text-sm">
                <Link href={projectViewHref(row.projectId)} className="inline-flex min-h-11 items-center font-medium text-sky-300 hover:text-sky-200">
                  Open
                </Link>
                <Link
                  href={`/analytics?projectId=${encodeURIComponent(row.projectId)}`}
                  className="inline-flex min-h-11 items-center text-slate-400 hover:text-white"
                >
                  Analytics
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
