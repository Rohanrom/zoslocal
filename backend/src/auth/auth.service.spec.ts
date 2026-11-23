import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.app_users.findUnique({
      where: {
        Username: dto.username,
      },
    });

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.app_users.create({
      data: {
        Username: dto.username,
        PasswordHash: passwordHash,
        Role: dto.role || 'viewer',
        IsActive: true,
      },
    });

    return {
      message: 'User created successfully',
      user: {
        userId: user.UserID.toString(),
        username: user.Username,
        role: user.Role,
      },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.app_users.findUnique({
      where: {
        Username: dto.username,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid username or password');
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
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        userId: user.UserID.toString(),
        username: user.Username,
        role: user.Role,
      },
    };
  }
}