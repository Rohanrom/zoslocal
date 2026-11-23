'use client';

import { useEffect, useState } from 'react';
import { fetchProjectsDirectory, type ProjectDirectoryProject } from '../../../lib/api';
import { useSession } from '../../../lib/session';

/**
 * The project list (GET /projects), fetched once per page load and shared by
 * every part of the shell: sidebar, project picker, breadcrumb, Ctrl K and Home.
 */
let cached: Promise<ProjectDirectoryProject[]> | null = null;

export function useProjectDirectory() {
  const { status, token } = useSession();
  const [projects, setProjects] = useState<ProjectDirectoryProject[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status !== 'signed-in') return;
    if (!cached) {
      cached = fetchProjectsDirectory(token).catch((err: unknown) => {
        cached = null; // let the next mount retry
        throw err;
      });
    }
    let alive = true;
    cached
      .then((rows) => {
        if (alive) setProjects(rows);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load projects');
      });
    return () => {
      alive = false;
    };
  }, [status, token]);

  return { projects, error };
}

/** Forget the cached list, e.g. after creating a project. */
export function refreshProjectDirectory() {
  cached = null;
}
