'use client';

import { useSyncExternalStore } from 'react';
import type { User } from './api';

/**
 * One place to read the login session in the browser.
 *
 * The token and user are kept in localStorage (as before). Components read
 * them through useSession(), which is safe for server rendering: on the
 * server, and for the very first browser render, status is 'loading', so
 * nothing that depends on the user is drawn until the browser has read it.
 */

const TOKEN_KEY = 'zos_access_token';
const USER_KEY = 'zos_user';

export type SessionStatus = 'loading' | 'signed-out' | 'signed-in';

export type Session = {
  status: SessionStatus;
  token: string;
  user: User | null;
  role: string;
};

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener('zos-session', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('zos-session', onChange);
  };
}

// Snapshots must return the same value until storage changes, so return the
// raw strings and parse them outside.
const readToken = () => window.localStorage.getItem(TOKEN_KEY) ?? '';
const readUser = () => window.localStorage.getItem(USER_KEY) ?? '';
const serverSnapshot = () => null;

function parseUser(raw: string): User | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function normalizeRole(role?: string | null) {
  return String(role || '').trim().toLowerCase();
}

export function useSession(): Session {
  const token = useSyncExternalStore<string | null>(subscribe, readToken, serverSnapshot);
  const rawUser = useSyncExternalStore<string | null>(subscribe, readUser, serverSnapshot);

  if (token === null || rawUser === null) {
    return { status: 'loading', token: '', user: null, role: '' };
  }
  const user = parseUser(rawUser);
  return {
    status: token ? 'signed-in' : 'signed-out',
    token,
    user,
    role: normalizeRole(user?.role),
  };
}

/** Clears the session everywhere it is kept and tells open components. */
export function clearSession() {
  for (const key of [TOKEN_KEY, USER_KEY, 'zos_selected_project', 'zos_selected_project_name', 'zos_analytics_project']) {
    window.localStorage.removeItem(key);
  }
  window.dispatchEvent(new Event('zos-session'));
}
