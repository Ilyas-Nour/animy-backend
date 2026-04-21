import { Controller, Get, Param, Query, ParseIntPipe, Req, Res, HttpException, HttpStatus } from "@nestjs/common";
import { MangaService } from "./manga.service";
import { Request, Response } from "express";
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
  async getChapterPages(@Param("chapterId") chapterId: string, @Req() req: Request) {
    // Build absolute proxy base URL dynamically from the request host
    const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const host = req.headers.host;
    const proxyBaseUrl = `${protocol}://${host}/api/v1/manga/image-proxy`;
    
    return this.mangaService.getChapterPages(chapterId, proxyBaseUrl);
  }

  @Get("image-proxy")
  async proxyImage(
    @Query("url") url: string,
    @Query("referer") referer: string,
    @Res() res: Response
  ) {
    if (!url) {
      throw new HttpException("URL parameter is required", HttpStatus.BAD_REQUEST);
    }
    return this.mangaService.proxyImage(url, referer, res);
  }
}
