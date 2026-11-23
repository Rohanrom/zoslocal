import { IsNotEmpty, Matches, MaxLength } from 'class-validator';

export class CreateProjectDto {
  @IsNotEmpty()
  @MaxLength(120)
  projectName!: string;

  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, {
    message:
      'projectId must use lowercase letters, numbers and underscores only',
  })
  projectId!: string;
}
