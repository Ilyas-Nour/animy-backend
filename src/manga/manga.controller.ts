import { Controller, Get, Param, Query, ParseIntPipe } from "@nestjs/common";
import { MangaService } from "./manga.service";
import { SearchMangaDto } from "./dto/search-manga.dto";
import { Public } from "../common/decorators/public.decorator";

@Public()
@Controller("manga")
export class MangaController {
  constructor(private readonly mangaService: MangaService) {}

  @Get()
  async searchRoot(@Query() query: any) {
    if (query.q) query.query = query.q;
    return this.mangaService.searchManga(query);
  }

  @Get("search")
  async search(@Query() searchDto: SearchMangaDto) {
    return this.mangaService.searchManga(searchDto);
  }

  @Get("top")
  async getTop(
    @Query("type") type?: string,
    @Query("filter") filter?: string,
    @Query("page") page: number = 1,
  ) {
    return this.mangaService.getTopManga(type, filter, page);
  }

  @Get(":id/full")
  async getByIdFull(@Param("id", ParseIntPipe) id: number) {
    return this.mangaService.getMangaById(id);
  }

  @Get(":id")
  async getById(@Param("id", ParseIntPipe) id: number) {
    return this.mangaService.getMangaById(id);
  }

  @Get(":id/characters")
  async getCharacters(@Param("id", ParseIntPipe) id: number) {
    return this.mangaService.getMangaCharacters(id);
  }

  @Get(":id/read-chapters")
  async getReadChapters(@Param("id", ParseIntPipe) id: number) {
    return this.mangaService.getMangaChapters(id);
  }

  @Get("read/:chapterId")
  async getChapterPages(@Param("chapterId") chapterId: string) {
    return this.mangaService.getChapterPages(chapterId);
  }
}
