import { IsOptional, IsString, IsNumber, IsEnum, Min } from "class-validator";

export class SearchMangaDto {
  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  limit?: number = 25;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  score?: string;

  @IsOptional()
  @IsString()
  order_by?: string;

  @IsOptional()
  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @IsString() // Or @IsBoolean() depending on how global pipes transform it
  sfw?: boolean;
}
