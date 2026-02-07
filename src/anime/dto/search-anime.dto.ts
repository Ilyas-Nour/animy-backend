import { IsOptional, IsString, IsInt, Min, Max, IsIn } from "class-validator";
import { Type } from "class-transformer";

export class SearchAnimeDto {
  @IsString()
  @IsOptional()
  query?: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @IsInt()
  @Min(1)
  @Max(25)
  @Type(() => Number)
  @IsOptional()
  limit?: number = 25;

  @IsString()
  @IsOptional()
  @IsIn(["tv", "movie", "ova", "special", "ona", "music"])
  type?: string;

  @IsString()
  @IsOptional()
  @IsIn(["airing", "complete", "upcoming"])
  status?: string;

  @IsString()
  @IsOptional()
  rating?: string;

  @IsString()
  @IsOptional()
  @IsIn([
    "mal_id",
    "title",
    "start_date",
    "end_date",
    "episodes",
    "score",
    "scored_by",
    "rank",
    "popularity",
    "members",
    "favorites",
  ])
  order_by?: string;

  @IsString()
  @IsOptional()
  @IsIn(["asc", "desc"])
  sort?: string;
}
