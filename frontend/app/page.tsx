'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginUser, wakeBackend } from '../lib/api';
import { getProjectById } from '../lib/projects';
import { projectViewHref } from './dashboard/view-routes';

export default function Home() {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // While the user types: wake the backend and download the code for the
  // pages a login can lead to, so the redirect after login is instant.
  useEffect(() => {
    wakeBackend();
    router.prefetch('/home');
    router.prefetch('/projects');
  }, [router]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError('');

    try {
      const result = await loginUser(username, password);

      localStorage.setItem('zos_access_token', result.accessToken);
      localStorage.setItem('zos_user', JSON.stringify(result.user));

      const normalizedRole = String(result.user.role || '')
        .trim()
        .toLowerCase();
      const isProjectManager = normalizedRole === 'manager';
      const isClient = normalizedRole === 'client';

      if (isClient) {
        const clientProject = getProjectById(result.user.projectId);

        if (!clientProject) {
          localStorage.removeItem('zos_access_token');
          localStorage.removeItem('zos_user');
          throw new Error('Client account is not assigned to a valid project');
        }

        localStorage.setItem('zos_selected_project', clientProject.id);
        localStorage.setItem('zos_selected_project_name', clientProject.name);
        router.push('/client');
        return;
      }

      if (isProjectManager) {
        localStorage.setItem('zos_selected_project', 'indradhanush');
        localStorage.setItem('zos_selected_project_name', 'Indradhanush');
        router.push(projectViewHref('indradhanush', 'assignment-final'));
        return;
      }

      // Everyone else starts on Home, the inbox across their projects.
      router.push('/home');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Login failed';

      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="nightshift-login flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-black px-6 text-white">
      <div className="nightshift-login-card w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-cyan-500/10">
        <div className="mb-8 text-center">
          <img
            src="/zobocon-logo.png"
            alt="Zobocon — Revolutionizing B2B Painting Services"
            width={663}
            height={160}
            fetchPriority="high"
            className="theme-brand-logo mx-auto h-40 w-auto rounded-xl object-contain p-3"
          />

          <p className="mt-3 text-slate-400">
            Construction Intelligence Platform
          </p>
        </div>

        <form className="space-y-5" onSubmit={handleLogin}>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Username
            </label>
            <input
              type="text"
              placeholder="Enter username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Password
            </label>
            <input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-cyan-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </main>
  );
}
