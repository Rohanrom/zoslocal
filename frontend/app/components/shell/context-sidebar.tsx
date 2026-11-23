'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ProjectDirectoryProject } from '../../../lib/api';
import { projectViewHref, type ProjectViewId } from '../../dashboard/view-routes';
import {
  HUB_PAGES,
  IN_DEVELOPMENT,
  moduleHref,
  projectGroupsForRole,
  type Hub,
} from './nav-config';

const itemClass = (active: boolean) =>
  `flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm ${
    active ? 'bg-[#F7A05A]/10 font-semibold text-[#F7A05A]' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
  }`;

const groupLabel = 'px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500';

/**
 * Layer 2: what is inside the open hub. In a project it is the project picker
 * and the project's modules; in company hubs it is that hub's pages.
 * Returns null where a hub has no sub-pages (Home), so no empty panel shows.
 */
export function ContextSidebar({
  hub,
  pathname,
  role,
  projects,
  project,
  view,
  onNavigate,
}: {
  hub: Hub | null;
  pathname: string;
  role: string;
  projects: ProjectDirectoryProject[] | null;
  project: { id: string; row: ProjectDirectoryProject | null } | null;
  view: ProjectViewId | null;
  onNavigate?: () => void;
}) {
  if (!hub) return null;

  if (hub.id === 'projects' && project && view) {
    return (
      <ProjectNav
        role={role}
        projects={projects}
        projectId={project.id}
        row={project.row}
        view={view}
        onNavigate={onNavigate}
      />
    );
  }

  if (hub.id === 'projects') {
    return (
      <nav aria-label="Projects" className="flex flex-col">
        <div className={groupLabel}>All projects</div>
        {(projects ?? []).map((row) => (
          <Link key={row.projectId} href={projectViewHref(row.projectId)} onClick={onNavigate} className={itemClass(false)}>
            <span className="truncate">{row.projectName}</span>
          </Link>
        ))}
        {projects === null && <p className="px-3 py-2 text-sm text-slate-500">Loading projects...</p>}
      </nav>
    );
  }

  if (hub.id === 'analytics') {
    return (
      <nav aria-label="Analytics scope" className="flex flex-col">
        <div className={groupLabel}>Scope</div>
        <Link href="/analytics" onClick={onNavigate} className={itemClass(pathname === '/analytics')}>
          All projects
        </Link>
        {(projects ?? []).map((row) => (
          <Link
            key={row.projectId}
            href={`/analytics?projectId=${encodeURIComponent(row.projectId)}`}
            onClick={onNavigate}
            className={itemClass(false)}
          >
            <span className="truncate">{row.projectName}</span>
          </Link>
        ))}
      </nav>
    );
  }

  const pages = HUB_PAGES[hub.id];
  if (!pages) return null;
  return (
    <nav aria-label={hub.label} className="flex flex-col">
      <div className={groupLabel}>{hub.label}</div>
      {pages.map((page) => {
        const active = pathname === page.href || pathname.startsWith(`${page.href}/`);
        return (
          <Link key={page.href} href={page.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={itemClass(active)}>
            {page.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ProjectNav({
  role,
  projects,
  projectId,
  row,
  view,
  onNavigate,
}: {
  role: string;
  projects: ProjectDirectoryProject[] | null;
  projectId: string;
  row: ProjectDirectoryProject | null;
  view: ProjectViewId;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const groups = projectGroupsForRole(role);
  const canSwitch = role !== 'manager' && (projects?.length ?? 0) > 1;

  return (
    <nav aria-label="Project menu" className="flex flex-col">
      <div className="px-1 pb-2">
        {canSwitch ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="zos-project-picker" className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Project
            </label>
            <select
              id="zos-project-picker"
              value={projectId}
              onChange={(event) => {
                onNavigate?.();
                // Same view in the other project.
                router.push(projectViewHref(event.target.value, view));
              }}
              className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm font-semibold text-white"
            >
              {(projects ?? []).map((item) => (
                <option key={item.projectId} value={item.projectId}>
                  {item.projectName}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Project</div>
            <div className="truncate text-sm font-semibold text-white">{row?.projectName || projectId}</div>
          </div>
        )}
      </div>

      {groups.map((group) => (
        <div key={group.label} className="flex flex-col">
          <div className={groupLabel}>{group.label}</div>
          {group.modules.map((mod) => {
            const active = mod.views.includes(view);
            const needsSetup = Boolean(mod.capability && row && !row.capabilities[mod.capability]);
            return (
              <Link
                key={mod.key}
                href={moduleHref(mod, projectId)}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={itemClass(active)}
              >
                <span className="truncate">{mod.label}</span>
                {needsSetup && (
                  <span className="ml-auto rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-300">
                    Set up
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}

      {role !== 'manager' && (
        <details className="mt-4 border-t border-slate-800 pt-2">
          <summary className="flex min-h-9 cursor-pointer items-center px-3 text-sm text-slate-500 hover:text-slate-300">
            {IN_DEVELOPMENT.length} modules in development
          </summary>
          <p className="px-3 pb-2 text-xs leading-6 text-slate-500">{IN_DEVELOPMENT.join(' · ')}</p>
        </details>
      )}
    </nav>
  );
}
