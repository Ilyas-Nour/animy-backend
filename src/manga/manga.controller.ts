import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  Req,
  Res,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
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

  @Get("read/:chapterId")
  async getChapterPages(
    @Param("chapterId") chapterId: string,
    @Req() req: Request,
  ) {
    // Build absolute proxy base URL dynamically from the request host
    const protocol =
      req.secure || req.headers["x-forwarded-proto"] === "https"
        ? "https"
        : "http";
    const host = req.headers.host;
    const proxyBaseUrl = `${protocol}://${host}/api/v1/manga/image-proxy`;

    return this.mangaService.getChapterPages(chapterId, proxyBaseUrl);
  }

  @Get("image-proxy")
  async proxyImage(
    @Query("url") url: string,
    @Query("referer") referer: string,
    @Res() res: Response,
  ) {
    if (!url) {
      throw new HttpException(
        "URL parameter is required",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.mangaService.proxyImage(url, referer, res);
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

  @Get("malsync-proxy/:id")
  async proxyMalsync(@Param("id") id: string) {
    try {
      const url = id.includes(':') 
        ? `https://api.malsync.moe/mal/manga/${id}`
        : `https://api.malsync.moe/mal/manga/${id}`;
        
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'curl/7.88.1',
          'Accept': 'application/json'
        }
      });
      if (!response.ok) {
        throw new HttpException(`MalSync responded with ${response.status}`, response.status);
      }
      return await response.json();
    } catch (e: any) {
      throw new HttpException(e.message || 'Error fetching MalSync', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
