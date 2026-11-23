import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { buildMockUser, getMockAuthConfig } from './mock-auth';

@Injectable()
export class AuthService {
  // Read once at startup. Throws (and stops the server) if AUTH_MOCK is set
  // on a deployed server. See mock-auth.ts.
  private readonly mockAuth = getMockAuthConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {
    if (this.mockAuth) {
      console.warn(
        `[auth] MOCK LOGIN IS ON: any username/password logs in as role "${this.mockAuth.role}"` +
          (this.mockAuth.projectId ? ` (project ${this.mockAuth.projectId})` : '') +
          '. Local development only.',
      );
    }
  }

  async login(dto: LoginDto) {
    if (this.mockAuth) {
      const mockUser = buildMockUser(dto?.username, this.mockAuth);
      const accessToken = await this.jwtService.signAsync({
        sub: mockUser.userId,
        username: mockUser.username,
        role: mockUser.role,
        projectId: mockUser.projectId,
      });
      return { accessToken, user: mockUser };
    }

    const user = await this.prisma.app_users.findUnique({
      where: {
        Username: dto.username,
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        'Invalid username or password',
      );
    }

    if (!user.IsActive) {
      throw new UnauthorizedException('User account is inactive');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.PasswordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const payload = {
      sub: user.UserID.toString(),
      username: user.Username,
      role: user.Role,
      projectId: user.ProjectID ?? null,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        userId: user.UserID.toString(),
        username: user.Username,
        role: user.Role,
        projectId: user.ProjectID ?? null,
      },
    };
  }
}