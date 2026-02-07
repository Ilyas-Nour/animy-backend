import { IsEnum } from "class-validator";
import { MangaStatus } from "@prisma/client";

export class UpdateMangaStatusDto {
  @IsEnum(MangaStatus)
  status: MangaStatus;
}
