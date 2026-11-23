'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { clearSession, useSession } from '../../../lib/session';
import { parseProjectPath, projectViewHref } from '../../dashboard/view-routes';
import { CommandPalette, type Command } from './command-palette';
import { ContextSidebar } from './context-sidebar';
import { GlobalRail } from './global-rail';
import { CloseIcon } from './icons';
import {
  activeHubFor,
  HUB_PAGES,
  hubsForRole,
  MANAGER_PROJECT_ID,
  moduleForView,
  moduleHref,
  projectGroupsForRole,
  viewLabel,
} from './nav-config';
import { TopBar, type Crumb } from './top-bar';
import { useProjectDirectory } from './use-project-directory';

/**
 * The ZOS desktop app shell: global rail (hubs), context sidebar (modules of
 * the open hub or project), top bar (breadcrumb, Ctrl K, account) and the page.
 * Wrap a route segment's layout in it. Client users are sent to /client and
 * signed-out users to the login page.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const { projects } = useProjectDirectory();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const role = session.role;

  useEffect(() => {
    if (session.status === 'signed-out') router.replace('/');
    else if (session.status === 'signed-in' && role === 'client') router.replace('/client');
  }, [session.status, role, router]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hubs = useMemo(() => hubsForRole(role), [role]);
  const hub = activeHubFor(pathname);
  const parsed = parseProjectPath(pathname);
  const projectRow = parsed ? (projects ?? []).find((row) => row.projectId === parsed.projectId) ?? null : null;
  const homeHref = role === 'manager' ? projectViewHref(MANAGER_PROJECT_ID, 'assignment-final') : '/home';

  const crumbs = useMemo<Crumb[]>(() => {
    if (parsed) {
      const list: Crumb[] = [
        { label: 'Projects', href: role === 'manager' ? undefined : '/projects' },
        { label: projectRow?.projectName || parsed.projectId, href: projectViewHref(parsed.projectId) },
      ];
      const mod = moduleForView(parsed.view, role);
      if (mod && parsed.view !== 'home') {
        list.push({ label: mod.label, href: moduleHref(mod, parsed.projectId) });
        if (mod.views.length > 1) list.push({ label: viewLabel(parsed.view) });
      }
      return list;
    }
    if (!hub) return [];
    const list: Crumb[] = [{ label: hub.label, href: hub.href }];
    const page = (HUB_PAGES[hub.id] ?? []).find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
    if (page && page.label !== hub.label) list.push({ label: page.label, href: page.href });
    return list;
  }, [parsed, projectRow, hub, pathname, role]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = hubs.map((item) => ({ id: `hub-${item.id}`, label: item.label, group: 'Hub', href: item.href }));
    for (const item of hubs) {
      for (const page of HUB_PAGES[item.id] ?? []) {
        list.push({ id: `page-${page.href}`, label: page.label, group: item.label, href: page.href });
      }
    }
    if (role !== 'manager') {
      for (const row of projects ?? []) {
        list.push({ id: `project-${row.projectId}`, label: row.projectName, group: 'Project', href: projectViewHref(row.projectId) });
      }
    }
    if (parsed) {
      const name = projectRow?.projectName || parsed.projectId;
      for (const group of projectGroupsForRole(role)) {
        for (const mod of group.modules) {
          if (mod.views.length <= 1) {
            list.push({ id: `mod-${mod.key}`, label: mod.label, group: name, href: moduleHref(mod, parsed.projectId) });
          } else {
            for (const item of mod.views) {
              list.push({
                id: `view-${item}`,
                label: `${mod.label} › ${viewLabel(item)}`,
                group: name,
                href: projectViewHref(parsed.projectId, item),
              });
            }
          }
        }
      }
    }
    return list;
  }, [hubs, projects, parsed, projectRow, role]);

  if (session.status !== 'signed-in' || role === 'client') {
    return <div className="h-screen bg-slate-950" aria-busy="true" />;
  }

  const closeMenu = () => setMenuOpen(false);
  const sidebar = (
    <ContextSidebar
      hub={hub}
      pathname={pathname}
      role={role}
      projects={projects}
      project={parsed ? { id: parsed.projectId, row: projectRow } : null}
      view={parsed?.view ?? null}
      onNavigate={closeMenu}
    />
  );
  const hasSidebar = Boolean(hub && (hub.id === 'projects' || hub.id === 'analytics' || HUB_PAGES[hub.id]));

  return (
    <div className="zos-shell flex h-screen overflow-hidden bg-slate-950 font-body text-slate-100">
      <a
        href="#zos-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[90] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900"
      >
        Skip to content
      </a>

      <GlobalRail hubs={hubs} activeHubId={hub?.id ?? null} homeHref={homeHref} />

      {hasSidebar && (
        <aside aria-label="Section menu" className="hidden w-60 shrink-0 overflow-y-auto border-r border-slate-800 bg-[#0B1122] p-3 md:block">
          {sidebar}
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          crumbs={crumbs}
          username={session.user?.username || 'User'}
          role={role}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onLogout={() => {
            clearSession();
            router.replace('/');
          }}
        />
        {/* Each page brings its own <main>; this only scrolls the page area. */}
        <div id="zos-main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          {children}
        </div>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-slate-950/75" onClick={closeMenu} />
          <div role="dialog" aria-modal="true" aria-label="Menu" className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col gap-4 overflow-y-auto border-r border-slate-700 bg-slate-900 p-4">
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-bold">ZOS</span>
              <button type="button" onClick={closeMenu} aria-label="Close menu" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800">
                <CloseIcon />
              </button>
            </div>
            <GlobalRail hubs={hubs} activeHubId={hub?.id ?? null} homeHref={homeHref} layout="list" onNavigate={closeMenu} />
            {hasSidebar && <div className="border-t border-slate-800 pt-2">{sidebar}</div>}
          </div>
        </div>
      )}

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} commands={commands} />
    </div>
  );
}
