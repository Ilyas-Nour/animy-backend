import { IsEnum } from "class-validator";
import { WatchStatus } from "@prisma/client";

export class UpdateWatchlistStatusDto {
  @IsEnum(WatchStatus)
  status: WatchStatus;
}
