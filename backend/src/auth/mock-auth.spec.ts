import { buildMockUser, getMockAuthConfig } from './mock-auth';

describe('getMockAuthConfig', () => {
  it('is off unless AUTH_MOCK=true', () => {
    expect(getMockAuthConfig({})).toBeNull();
    expect(getMockAuthConfig({ AUTH_MOCK: 'false' })).toBeNull();
    expect(getMockAuthConfig({ AUTH_MOCK: '1' })).toBeNull();
  });

  it('defaults to admin locally', () => {
    expect(getMockAuthConfig({ AUTH_MOCK: 'true', NODE_ENV: 'development' })).toEqual({
      role: 'admin',
      projectId: null,
    });
  });

  it('refuses to run with NODE_ENV=production', () => {
    expect(() => getMockAuthConfig({ AUTH_MOCK: 'true', NODE_ENV: 'production' })).toThrow(
      /not allowed on a deployed server/,
    );
  });

  it('refuses to run on Render even without NODE_ENV', () => {
    expect(() => getMockAuthConfig({ AUTH_MOCK: 'true', RENDER: 'true' })).toThrow(
      /not allowed on a deployed server/,
    );
  });

  it('rejects an unknown role', () => {
    expect(() => getMockAuthConfig({ AUTH_MOCK: 'true', AUTH_MOCK_ROLE: 'superuser' })).toThrow(
      /AUTH_MOCK_ROLE must be one of/,
    );
  });

  it('requires a project for the client role', () => {
    expect(() => getMockAuthConfig({ AUTH_MOCK: 'true', AUTH_MOCK_ROLE: 'client' })).toThrow(
      /needs AUTH_MOCK_PROJECT_ID/,
    );
    expect(
      getMockAuthConfig({
        AUTH_MOCK: 'true',
        AUTH_MOCK_ROLE: 'Client',
        AUTH_MOCK_PROJECT_ID: 'park_heights',
      }),
    ).toEqual({ role: 'client', projectId: 'park_heights' });
  });
});

describe('buildMockUser', () => {
  it('uses the typed username and a numeric id', () => {
    expect(buildMockUser(' shreyansh ', { role: 'manager', projectId: null })).toEqual({
      userId: '0',
      username: 'shreyansh',
      role: 'manager',
      projectId: null,
    });
  });

  it('falls back to a default name', () => {
    expect(buildMockUser('', { role: 'admin', projectId: null }).username).toBe('mock-user');
  });
});
