'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AdminUser,
  createAdminUser,
  CreateAdminUserPayload,
  fetchAdminUsers,
  User,
} from '../../../lib/api';
import { projects } from '../../../lib/projects';

const ROLE_OPTIONS: CreateAdminUserPayload['role'][] = [
  'client',
  'manager',
  'viewer',
  'admin',
];

export default function AdminUsersPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<CreateAdminUserPayload['role']>('client');
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const savedToken = localStorage.getItem('zos_access_token');
      const savedUser = localStorage.getItem('zos_user');

      if (!savedToken || !savedUser) {
        router.replace('/');
        return;
      }

      let parsedUser: User;
      try {
        parsedUser = JSON.parse(savedUser) as User;
      } catch {
        router.replace('/');
        return;
      }

      if (String(parsedUser.role || '').trim().toLowerCase() !== 'admin') {
        router.replace('/dashboard');
        return;
      }

      setToken(savedToken);

      try {
        const rows = await fetchAdminUsers(savedToken);
        if (!cancelled) setUsers(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load users');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      await createAdminUser(token, {
        username,
        password,
        role,
        projectId: role === 'client' ? projectId : null,
      });

      setUsername('');
      setPassword('');
      setMessage('User created successfully.');
      setUsers(await fetchAdminUsers(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white md:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-300">
              Governance
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold">User Management</h1>
            <p className="mt-2 text-sm text-slate-500">
              Accounts can only be created by an authenticated ZOS admin.
            </p>
          </div>
          <button
            onClick={() => router.push('/dashboard')}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-900"
          >
            Back to Dashboard
          </button>
        </header>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            {message}
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          <form
            onSubmit={handleCreateUser}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-5"
          >
            <h2 className="font-display text-lg font-semibold">Create User</h2>
            <p className="mt-1 text-xs text-slate-500">
              Passwords are bcrypt-hashed by the backend. Do not create users manually in Supabase for normal use.
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Username</label>
                <input
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">Password</label>
                <input
                  required
                  minLength={6}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">Role</label>
                <select
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as CreateAdminUserPayload['role'])
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-400"
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              {role === 'client' && (
                <div>
                  <label className="mb-1 block text-xs text-slate-400">
                    Client Project
                  </label>
                  <select
                    required
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-400"
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Client accounts are permanently scoped to the selected project at login/API level.
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-cyan-500 px-4 py-2.5 font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
              >
                {submitting ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </form>

          <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            <div className="border-b border-slate-800 p-4">
              <h2 className="font-display font-semibold">Existing Users</h2>
              <p className="mt-1 text-xs text-slate-500">
                Password hashes are never returned to the frontend.
              </p>
            </div>

            {loading ? (
              <div className="p-6 text-sm text-slate-400">Loading users...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-950/60 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Username</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Project</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => {
                      const project = projects.find((item) => item.id === user.projectId);

                      return (
                        <tr key={user.userId} className="border-t border-slate-800">
                          <td className="px-4 py-3 font-semibold text-slate-200">{user.username}</td>
                          <td className="px-4 py-3 text-slate-300">{user.role}</td>
                          <td className="px-4 py-3 text-slate-400">{project?.name || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                              user.isActive
                                ? 'bg-emerald-500/10 text-emerald-300'
                                : 'bg-red-500/10 text-red-300'
                            }`}>
                              {user.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {new Date(user.createdAt).toLocaleDateString('en-IN')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}