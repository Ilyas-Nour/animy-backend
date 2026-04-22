import {
  Controller,
  Get,
  Param,
  Query,
  HttpException,
  HttpStatus,
  Req,
  Logger,
} from "@nestjs/common";
import { StreamingService } from "./streaming.service";
import { Request } from "express";

@Controller("streaming")
export class StreamingController {
  private readonly logger = new Logger(StreamingController.name);

  constructor(private readonly streamingService: StreamingService) {}

  /**
   * Search for anime on HiAnime
   * GET /api/v1/streaming/search?query=naruto
   */
  @Get("search")
  async searchAnime(@Query("query") query: string) {
    if (!query) {
      throw new HttpException(
        "Query parameter is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.streamingService.searchAnime(query);
  }

  /**
   * Get anime info and episodes from HiAnime
   * GET /api/v1/streaming/anime/*
   */
  @Get("anime/*id")
  async getAnimeInfo(@Param("id") id: string) {
    if (!id) {
      throw new HttpException("Anime ID is required", HttpStatus.BAD_REQUEST);
    }
    return this.streamingService.getAnimeInfo(id);
  }

  /**
   * Get streaming links for an episode from HiAnime
   * GET /api/v1/streaming/episode/*
   */
  @Get("episode/*id")
  async getEpisodeLinks(
    @Param("id") id: string,
    @Req() req: any,
    @Query("malId") malId?: string,
    @Query("ep") ep?: string,
  ) {
    if (!id) {
      throw new HttpException("Episode ID is required", HttpStatus.BAD_REQUEST);
    }

    // Build absolute proxy base URL dynamically from the request host
    // This ensures the frontend gets a URL that points back to this backend instance
    const protocol =
      req.secure || req.headers["x-forwarded-proto"] === "https"
        ? "https"
        : "http";
    const host = req.headers.host;
    const proxyBaseUrl = `${protocol}://${host}/api/v1/streaming/proxy`;

    return this.streamingService.getEpisodeLinks(
      id,
      "hianime",
      proxyBaseUrl,
      malId,
      ep,
    );
  }

  /**
   * Find anime by MAL title (from AniList)
   * GET /api/v1/streaming/find?title=Naruto&titleEnglish=Naruto
   */
  @Get("find")
  async findAnimeByTitle(
    @Query("title") title: string,
    @Query("titleEnglish") titleEnglish?: string,
    @Query("anilistId") anilistId?: string,
  ) {
    if (!title) {
      throw new HttpException(
        "Title parameter is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.streamingService.findAnimeByTitle(
      title,
      titleEnglish,
      anilistId ? parseInt(anilistId, 10) : undefined,
    );
  }

  /**
   * Proxy video streams to bypass CORS and 403s
   * GET /api/v1/streaming/proxy?url=...&referer=...
   */
  @Get("proxy")
  async proxyStream(
    @Query("url") url: string,
    @Query("referer") referer: string,
    @Req() req: any,
  ) {
    if (!url) {
      throw new HttpException(
        "URL parameter is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    const res = req.res;
    return this.streamingService.proxyStream(url, referer, res);
  }
}
