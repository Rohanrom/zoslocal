'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { projectViewHref } from '../dashboard/view-routes';
import {
  fetchProjectsDirectory,
  ProjectDirectoryProject,
  User,
} from '../../lib/api';
import {
  analyticsProject,
  projectFromDirectory,
  Project,
} from '../../lib/projects';

export default function ProjectsPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [projectRows, setProjectRows] = useState<ProjectDirectoryProject[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const token = localStorage.getItem('zos_access_token');
      const savedUser = localStorage.getItem('zos_user');

      if (!token) {
        router.push('/');
        return;
      }

      if (savedUser) {
        try {
          const parsedUser = JSON.parse(savedUser) as User;
          const normalizedRole = String(parsedUser.role || '')
            .trim()
            .toLowerCase();
          const isProjectManager = normalizedRole === 'manager';
          const isClient = normalizedRole === 'client';

          setUser(parsedUser);

          if (isClient) {
            if (parsedUser.projectId) {
              localStorage.setItem('zos_selected_project', parsedUser.projectId);
            }
            router.replace('/client');
            return;
          }

          if (isProjectManager) {
            localStorage.setItem('zos_selected_project', 'indradhanush');
            localStorage.setItem('zos_selected_project_name', 'Indradhanush');
            router.replace(projectViewHref('indradhanush', 'assignment-final'));
            return;
          }
        } catch {
          localStorage.removeItem('zos_user');
        }
      }

      try {
        const rows = await fetchProjectsDirectory(token);
        if (!cancelled) {
          setProjectRows(rows);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load projects',
          );
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [router]);

  function openProject(project: Project) {
    if (project.id === 'analytics') {
      localStorage.removeItem('zos_analytics_project');
      router.push('/analytics');
      return;
    }

    localStorage.setItem('zos_selected_project', project.id);
    localStorage.setItem('zos_selected_project_name', project.name);

    router.push(projectViewHref(project.id));
  }

  function logout() {
    localStorage.removeItem('zos_access_token');
    localStorage.removeItem('zos_user');
    localStorage.removeItem('zos_selected_project');
    localStorage.removeItem('zos_selected_project_name');
    localStorage.removeItem('zos_analytics_project');

    router.push('/');
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-black px-6 text-white">
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 text-sm text-slate-300">
          Loading your workspace...
        </div>
      </main>
    );
  }

  const operationalProjects = projectRows.map(projectFromDirectory);
  const visibleProjects = [...operationalProjects, analyticsProject];

  return (
    <main className="nightshift-projects min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black px-6 py-8 text-white">
      <header className="nightshift-projects-header mb-8 flex flex-col justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 md:flex-row md:items-center">
        <div>
          <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1 text-sm text-cyan-300">
            Zobocon Platform
          </span>

          <h1 className="mt-5 text-4xl font-extrabold tracking-tight">
            Select Project
          </h1>

          <p className="mt-2 text-slate-400">
            Projects created in Admin → Project Setup appear here automatically.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="font-semibold">{user?.username}</p>
            <p className="text-sm text-slate-400">{user?.role}</p>
          </div>

          <button
            onClick={logout}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-red-400 hover:text-red-300"
          >
            Logout
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {visibleProjects.map((project) => (
          <button
            key={project.id}
            onClick={() => openProject(project)}
            className="nightshift-project-card rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-left shadow-2xl shadow-cyan-500/5 transition hover:border-cyan-400 hover:bg-slate-900"
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <span className="rounded-full bg-cyan-500 px-3 py-1 text-sm font-bold text-slate-950">
                {project.code}
              </span>

              <span className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-sm text-green-300">
                {project.status}
              </span>
            </div>

            <h2 className="text-2xl font-bold">{project.name}</h2>

            <p className="mt-2 text-sm text-slate-400">{project.location}</p>

            <p className="mt-5 text-sm leading-6 text-slate-300">
              {project.description}
            </p>

            {project.id !== 'analytics' && project.counts && (
              <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2">
                  <p className="font-mono text-sm text-slate-100">
                    {project.counts.layers.toLocaleString('en-IN')}
                  </p>
                  <p className="text-slate-500">Layers</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2">
                  <p className="font-mono text-sm text-slate-100">
                    {project.counts.flatAreas.toLocaleString('en-IN')}
                  </p>
                  <p className="text-slate-500">Flats</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2">
                  <p className="font-mono text-sm text-slate-100">
                    {project.counts.boq.toLocaleString('en-IN')}
                  </p>
                  <p className="text-slate-500">Work Order</p>
                </div>
              </div>
            )}

            <div className="mt-6 rounded-lg bg-cyan-500 px-4 py-3 text-center font-semibold text-slate-950">
              {project.id === 'analytics' ? 'Open Analytics' : 'Open Project'}
            </div>
          </button>
        ))}

        <button
          onClick={() => router.push('/pre-contract-boq')}
          className="nightshift-project-card rounded-2xl border border-teal-700/70 bg-slate-900/80 p-6 text-left shadow-2xl shadow-cyan-500/5 transition hover:border-teal-400 hover:bg-slate-900"
        >
          <div className="mb-5 flex items-center justify-between gap-4">
            <span className="rounded-full bg-teal-500 px-3 py-1 text-sm font-bold text-slate-950">BOQ</span>
            <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-sm text-teal-300">Pre-Contract</span>
          </div>
          <h2 className="text-2xl font-bold">Pre-Contract BOQ</h2>
          <p className="mt-2 text-sm text-slate-400">Independent tender and bid costing</p>
          <p className="mt-5 text-sm leading-6 text-slate-300">Create and reopen commercial opportunities, estimate full costs, and simulate application-level pricing and margins.</p>
          <div className="mt-6 rounded-lg bg-teal-500 px-4 py-3 text-center font-semibold text-slate-950">Open BOQ Workspace</div>
        </button>

        <button
          onClick={() => router.push('/oem')}
          className="nightshift-project-card rounded-2xl border border-indigo-600/70 bg-slate-900/80 p-6 text-left shadow-xl transition hover:border-indigo-300 hover:bg-slate-900"
        >
          <div className="mb-5 flex items-center justify-between gap-4">
            <span className="rounded-full bg-indigo-400 px-3 py-1 text-sm font-bold text-slate-950">OEM</span>
            <span className="rounded-full border border-indigo-500/40 px-3 py-1 text-sm text-indigo-200">Materials</span>
          </div>
          <h2 className="text-2xl font-bold">OEM Catalogue & Quotations</h2>
          <p className="mt-2 text-sm text-slate-400">Independent purchase-commercial workspace</p>
          <p className="mt-5 text-sm leading-6 text-slate-300">Register material brands, categories and pack sizes. Record and compare quotation rates by OEM project.</p>
          <div className="mt-6 rounded-lg bg-indigo-400 px-4 py-3 text-center font-semibold text-slate-950">Open OEM Workspace</div>
        </button>

        {visibleProjects.length === 1 && (
          <div className="rounded-2xl border border-dashed border-slate-800 p-6 text-sm text-slate-500">
            No operational projects are registered yet. Create one from Admin →
            Project Setup.
          </div>
        )}
      </section>
    </main>
  );
}