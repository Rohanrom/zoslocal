/**
 * Mock login for local development only.
 *
 * When AUTH_MOCK=true, POST /auth/login accepts ANY username and password and
 * returns a real signed token for a pretend user. Everything after login
 * (guards, roles, project checks) works exactly as normal, because the token
 * is genuine. Only the password check is skipped.
 *
 * Safety: the backend refuses to START if AUTH_MOCK=true on a deployed server
 * (NODE_ENV=production, or running on Render, which sets RENDER=true). So a
 * stray AUTH_MOCK in the Render environment stops the deploy instead of
 * opening the live system.
 *
 * Settings (backend/.env):
 *   AUTH_MOCK=true             turn it on
 *   AUTH_MOCK_ROLE=admin       admin | manager | viewer | client (default admin)
 *   AUTH_MOCK_PROJECT_ID=...   required when the role is client
 */

const MOCK_ROLES = ['admin', 'manager', 'viewer', 'client'] as const;
export type MockRole = (typeof MOCK_ROLES)[number];

export type MockAuthConfig = {
  role: MockRole;
  projectId: string | null;
};

type Env = Record<string, string | undefined>;

export function isDeployedEnvironment(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production' || Boolean(env.RENDER);
}

/**
 * Returns the mock settings, or null when mock login is off.
 * Throws when the settings are unsafe or invalid, so the server does not start.
 */
export function getMockAuthConfig(env: Env = process.env): MockAuthConfig | null {
  if (String(env.AUTH_MOCK || '').trim().toLowerCase() !== 'true') {
    return null;
  }

  if (isDeployedEnvironment(env)) {
    throw new Error(
      'AUTH_MOCK=true is not allowed on a deployed server (NODE_ENV=production or Render). ' +
        'Remove AUTH_MOCK from this environment.',
    );
  }

  const role = String(env.AUTH_MOCK_ROLE || 'admin').trim().toLowerCase();
  if (!(MOCK_ROLES as readonly string[]).includes(role)) {
    throw new Error(
      `AUTH_MOCK_ROLE must be one of ${MOCK_ROLES.join(', ')}; got "${role}".`,
    );
  }

  const projectId = String(env.AUTH_MOCK_PROJECT_ID || '').trim() || null;
  if (role === 'client' && !projectId) {
    throw new Error('AUTH_MOCK_ROLE=client needs AUTH_MOCK_PROJECT_ID (for example park_heights).');
  }

  return { role: role as MockRole, projectId };
}

/**
 * The pretend user returned by a mock login. The id is "0" because some
 * endpoints expect a numeric user id.
 */
export function buildMockUser(username: string, config: MockAuthConfig) {
  const name = String(username || '').trim() || 'mock-user';
  return {
    userId: '0',
    username: name,
    role: config.role,
    projectId: config.projectId,
  };
}
