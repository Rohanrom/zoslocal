import { JwtService } from '@nestjs/jwt';

// AuthService imports PrismaService, which needs the generated Prisma client.
// The mock login never touches the database, so a stand-in is enough here.
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { AuthService } from './auth.service';

describe('AuthService mock login', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('logs in any username and returns a valid token', async () => {
    process.env.AUTH_MOCK = 'true';
    process.env.AUTH_MOCK_ROLE = 'manager';
    delete process.env.RENDER;
    process.env.NODE_ENV = 'development';

    const jwt = new JwtService({ secret: 'test-secret' });
    const prisma = { app_users: { findUnique: jest.fn() } };
    const service = new AuthService(prisma as never, jwt);

    const result = await service.login({ username: 'anyone', password: 'x' });

    expect(prisma.app_users.findUnique).not.toHaveBeenCalled();
    expect(result.user).toEqual({ userId: '0', username: 'anyone', role: 'manager', projectId: null });
    const payload = await jwt.verifyAsync(result.accessToken);
    expect(payload).toMatchObject({ sub: '0', username: 'anyone', role: 'manager' });
  });

  it('will not construct on Render', () => {
    process.env.AUTH_MOCK = 'true';
    process.env.RENDER = 'true';
    expect(() => new AuthService({} as never, new JwtService({ secret: 's' }))).toThrow(
      /not allowed on a deployed server/,
    );
  });

  it('uses the real password check when mock is off', async () => {
    delete process.env.AUTH_MOCK;
    const prisma = { app_users: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new AuthService(prisma as never, new JwtService({ secret: 's' }));
    await expect(service.login({ username: 'nobody', password: 'x' })).rejects.toThrow(
      'Invalid username or password',
    );
    expect(prisma.app_users.findUnique).toHaveBeenCalled();
  });
});
