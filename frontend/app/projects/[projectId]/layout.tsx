'use client';

import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { DashboardScreen } from '../../dashboard/dashboard-screen';
import { DEFAULT_PROJECT_VIEW, parseProjectPath } from '../../dashboard/view-routes';
import { ModuleTabs } from '../../components/shell/module-tabs';
import { useSession } from '../../../lib/session';

/**
 * Project workspace for /projects/<projectId>/<view>, drawn inside the app
 * shell (app/projects/layout.tsx). The shell gives the menus; this adds the
 * module's view tabs and the existing project screens.
 *
 * It is a layout, so it stays mounted while the user moves between views of
 * the same project: data and filters are kept. Another project gets a fresh
 * workspace through the `key`.
 */
export default function ProjectWorkspaceLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ projectId: string }>();
  const pathname = usePathname();
  const { role } = useSession();

  const projectId = decodeURIComponent(String(params?.projectId || ''));
  const view = parseProjectPath(pathname)?.view ?? DEFAULT_PROJECT_VIEW;

  return (
    <>
      <DashboardScreen
        key={projectId}
        routeProjectId={projectId}
        routeView={view}
        embedded
        subNav={<ModuleTabs projectId={projectId} view={view} role={role} />}
      />
      {children}
    </>
  );
}
