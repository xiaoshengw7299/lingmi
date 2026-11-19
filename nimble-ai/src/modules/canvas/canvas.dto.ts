import { IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CanvasDoc } from './canvas.entity';

export class CreateCanvasDto {
  @IsOptional() @IsString() @MaxLength(120)
  title?: string;

  @IsOptional() @IsObject()
  doc?: CanvasDoc;
}

export class SaveCanvasDto {
  @IsOptional() @IsString() @MaxLength(120)
  title?: string;

  @IsOptional() @IsObject()
  doc?: CanvasDoc;

  @IsInt() @Min(1)
  baseVersion: number;
}
