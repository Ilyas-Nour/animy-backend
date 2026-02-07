import { IsInt, IsString, IsOptional, IsEnum } from "class-validator";
import { MangaStatus } from "@prisma/client";

export class AddToMangaListDto {
  @IsInt()
  mangaId: number;

  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  image?: string;

  @IsEnum(MangaStatus)
  @IsOptional()
  status?: MangaStatus;
}
