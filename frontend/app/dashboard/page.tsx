'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { projectViewHref } from './view-routes';

/**
 * Old address. The workspace now lives at /projects/<projectId>/<view>.
 * Kept so bookmarks and existing "Dashboard" buttons still work: it sends
 * the user to the last project they had open, or to the project list.
 */
export default function DashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!localStorage.getItem('zos_access_token')) {
      router.replace('/');
      return;
    }
    const lastProjectId = localStorage.getItem('zos_selected_project');
    router.replace(lastProjectId ? projectViewHref(lastProjectId) : '/projects');
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-slate-400">
      Opening project...
    </main>
  );
}
