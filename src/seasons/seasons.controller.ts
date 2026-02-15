import { Controller, Get, Query, Param } from "@nestjs/common";
import { SeasonsService } from "./seasons.service";
import { Public } from "../common/decorators/public.decorator";

@Controller("seasons")
export class SeasonsController {
  constructor(private readonly seasonsService: SeasonsService) { }

  @Public()
  @Get("current")
  async getCurrentSeason() {
    return this.seasonsService.getCurrentSeason();
  }

  @Public()
  @Get("upcoming")
  async getUpcomingSeason() {
    return this.seasonsService.getUpcomingSeason();
  }

  @Public()
  @Get(":year/:season")
  async getSeasonAnime(
    @Param("year") year: string,
    @Param("season") season: string,
    @Query("page") page?: number,
  ) {
    return this.seasonsService.getSeasonAnime(parseInt(year, 10), season, page);
  }

  @Public()
  @Get(["list", "/"])
  async getSeasonsList() {
    return this.seasonsService.getSeasonsList();
  }
}
