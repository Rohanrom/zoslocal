import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'sagar' })
  username!: string;

  @ApiProperty({ example: 'password123' })
  password!: string;
}