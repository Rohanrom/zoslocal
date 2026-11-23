import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  private readonly allowedRoles = new Set([
    'admin',
    'manager',
    'viewer',
    'client',
  ]);

  private readonly allowedProjectIds = new Set([
    'park_heights',
    'indradhanush',
  ]);

  constructor(private readonly prisma: PrismaService) {}

  async listUsers() {
    const users = await this.prisma.app_users.findMany({
      orderBy: [{ CreatedAt: 'desc' }, { Username: 'asc' }],
    });

    return users.map((user) => ({
      userId: user.UserID.toString(),
      username: user.Username,
      role: user.Role,
      projectId: user.ProjectID ?? null,
      isActive: user.IsActive,
      createdAt: user.CreatedAt,
    }));
  }

  async createUser(dto: CreateUserDto) {
    const username = String(dto.username || '').trim();
    const password = String(dto.password || '');
    const role = String(dto.role || '').trim().toLowerCase();
    const requestedProjectId = String(dto.projectId || '').trim();

    if (!username) {
      throw new BadRequestException('Username is required');
    }

    if (password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    if (!this.allowedRoles.has(role)) {
      throw new BadRequestException('Unsupported user role');
    }

    let projectId: string | null = null;

    if (role === 'client') {
      if (!requestedProjectId) {
        throw new BadRequestException(
          'A client account must be assigned to one project',
        );
      }

      if (!this.allowedProjectIds.has(requestedProjectId)) {
        throw new BadRequestException('Unsupported client project');
      }

      projectId = requestedProjectId;
    }

    const existingUser = await this.prisma.app_users.findUnique({
      where: { Username: username },
    });

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.app_users.create({
      data: {
        Username: username,
        PasswordHash: passwordHash,
        Role: role,
        ProjectID: projectId,
        IsActive: true,
      },
    });

    return {
      message: 'User created successfully',
      user: {
        userId: user.UserID.toString(),
        username: user.Username,
        role: user.Role,
        projectId: user.ProjectID ?? null,
        isActive: user.IsActive,
        createdAt: user.CreatedAt,
      },
    };
  }
}