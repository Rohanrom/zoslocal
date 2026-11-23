import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LayerCalculationDto {
  @ApiPropertyOptional()
  Projection_Billable?: string;

  @ApiPropertyOptional()
  Projection_Total_Area?: string;

  @ApiPropertyOptional()
  Projection_Done_Area?: string;

  @ApiPropertyOptional()
  Productivity_Sqft_Per_Hour?: string;

  @ApiPropertyOptional()
  Painter_Count_Required?: string;

  @ApiPropertyOptional()
  Projection_Material_Coverage?: number;

  @ApiPropertyOptional()
  Projection_Material_Rate?: string;
}

export class CreateLayerDto extends LayerCalculationDto {
  @ApiProperty()
  LayerID!: string;

  @ApiPropertyOptional()
  LAYERName?: string;

  @ApiPropertyOptional()
  Block?: string;

  @ApiPropertyOptional()
  Application?: string;

  @ApiPropertyOptional()
  Flat?: string;

  @ApiPropertyOptional()
  ID?: string;

  @ApiPropertyOptional()
  Related_Backends?: string;

  @ApiPropertyOptional()
  Projection_Order?: number;

  @ApiPropertyOptional()
  Projection_Work_Mode?: string;

  @ApiPropertyOptional()
  Layer_Material_Key?: string;

  @ApiPropertyOptional()
  Projection_Material_Name?: string;
}

export class UpdateLayerDto extends LayerCalculationDto {
  @ApiPropertyOptional()
  LAYERName?: string;

  @ApiPropertyOptional()
  Block?: string;

  @ApiPropertyOptional()
  Application?: string;

  @ApiPropertyOptional()
  Flat?: string;

  @ApiPropertyOptional()
  ID?: string;

  @ApiPropertyOptional()
  Related_Backends?: string;

  @ApiPropertyOptional()
  Projection_Order?: number;

  @ApiPropertyOptional()
  Projection_Work_Mode?: string;

  @ApiPropertyOptional()
  Layer_Material_Key?: string;

  @ApiPropertyOptional()
  Projection_Material_Name?: string;
}