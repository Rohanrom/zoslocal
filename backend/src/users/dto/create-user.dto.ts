import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'aph_client' })
  username!: string;

  @ApiProperty({ example: 'StrongPassword123' })
  password!: string;

  @ApiProperty({
    example: 'client',
    enum: ['admin', 'manager', 'viewer', 'client'],
  })
  role!: string;

  @ApiProperty({
    example: 'park_heights',
    required: false,
    nullable: true,
    description: 'Required only for client users',
  })
  projectId?: string | null;
}