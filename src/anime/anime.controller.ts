import { Controller, Get, Query, Param } from "@nestjs/common";
import { AnimeService } from "./anime.service";
import { SearchAnimeDto } from "./dto/search-anime.dto";
import { Public } from "../common/decorators/public.decorator";

@Controller("anime")
export class AnimeController {
  constructor(private readonly animeService: AnimeService) { }

  @Public()
  @Get()
  async searchAnimeRoot(@Query() query: any) {
    if (query.q) query.query = query.q;
    return this.animeService.searchAnime(query);
  }

  @Public()
  @Get("search")
  async searchAnime(@Query() searchDto: SearchAnimeDto) {
    return this.animeService.searchAnime(searchDto);
  }

  @Public()
  @Get("top")
  async getTopAnime(
    @Query("type") type?: string,
    @Query("filter") filter?: string,
  ) {
    return this.animeService.getTopAnime(type, filter);
  }

  @Public()
  @Get("movies")
  async getMovies(@Query("page") page?: number) {
    return this.animeService.getAnimeByType("movie", page);
  }

  @Public()
  @Get("series")
  async getSeries(@Query("page") page?: number) {
    return this.animeService.getAnimeByType("tv", page);
  }

  @Public()
  @Get(":id/full")
  async getAnimeFullById(@Param("id") id: string) {
    return this.animeService.getAnimeById(parseInt(id, 10));
  }

  @Public()
  @Get(":id")
  async getAnimeById(@Param("id") id: string) {
    return this.animeService.getAnimeById(parseInt(id, 10));
  }

  @Public()
  @Get(":id/characters")
  async getAnimeCharacters(@Param("id") id: string) {
    return this.animeService.getAnimeCharacters(parseInt(id, 10));
  }

  @Public()
  @Get(":id/recommendations")
  async getAnimeRecommendations(@Param("id") id: string) {
    return this.animeService.getAnimeRecommendations(parseInt(id, 10));
  }
  @Public()
  @Get("schedule")
  async getUpcomingSchedule() {
    return this.animeService.getUpcomingSchedule();
  }
}
