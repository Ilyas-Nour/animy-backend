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

import { StreamingProxyService } from "./streaming.proxy.service";

@Controller("streaming")
export class StreamingController {
  private readonly logger = new Logger(StreamingController.name);

  constructor(
    private readonly streamingService: StreamingService,
    private readonly streamingProxyService: StreamingProxyService,
  ) {}

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
    @Query("proxyBaseUrl") customProxyUrl?: string,
    @Query("tmdbId") tmdbId?: string,
    @Query("title") title?: string,
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
    const proxyBaseUrl =
      customProxyUrl || `${protocol}://${host}/api/v1/streaming/proxy`;

    return this.streamingService.getEpisodeLinks(
      id,
      "animepahe",
      proxyBaseUrl,
      malId,
      ep,
      tmdbId,
      title,
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

    return this.streamingService.findAnime(
      title,
      titleEnglish || "",
      anilistId || "",
    );
  }

  /**
   * Proxy video streams to bypass CORS and 403s
   * Uses a wildcard path so HLS relative URLs resolve natively in the browser.
   * GET /api/v1/streaming/proxy/https://cdn...
   */
  @Get("proxy/*")
  async proxyStream(@Req() req: any) {
    // Extract the full target URL from the request URL
    // e.g., /api/v1/streaming/proxy/https://cdn.com/video.m3u8?token=123
    let url = req.url.substring(req.url.indexOf('/proxy/') + 7);
    
    // Support the legacy ?url= format if it's still being used somewhere
    if (req.query.url) {
      url = req.query.url as string;
    }

    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      throw new HttpException(
        "Valid absolute URL path parameter is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    const res = req.res;
    
    // Build absolute proxy base URL dynamically from the request host
    const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const host = req.headers.host;
    const proxyBaseUrl = `${protocol}://${host}/api/v1/streaming/proxy`;

    // Extract referer from query if provided, otherwise auto-detect based on URL
    let referer = (req.query.referer as string) || "";
    if (!referer) {
      if (url.includes('krussdomi.com') || url.includes('kaa.lt') || url.includes('kickassanime')) referer = 'https://kaa.lt/';
      else if (url.includes('kwik.cx')) referer = 'https://animepahe.com/';
      else if (url.includes('animepahe')) referer = 'https://animepahe.com/';
      else if (url.includes('megaup')) referer = 'https://megaup.nl/';
    }

    return this.streamingProxyService.proxy(url, referer, res, req, proxyBaseUrl);
  }
}
