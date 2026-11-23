import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'sagar' })
  username!: string;

  @ApiProperty({ example: 'password123' })
  password!: string;

  @ApiProperty({ example: 'admin', required: false })
  role?: string;
}