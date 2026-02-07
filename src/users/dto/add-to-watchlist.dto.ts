import { IsInt, IsString, IsOptional, IsEnum } from "class-validator";
import { WatchStatus } from "@prisma/client";

export class AddToWatchlistDto {
  @IsInt()
  animeId: number;

  @IsString()
  animeTitle: string;

  @IsString()
  @IsOptional()
  animeImage?: string;

  @IsEnum(WatchStatus)
  @IsOptional()
  status?: WatchStatus;
}
