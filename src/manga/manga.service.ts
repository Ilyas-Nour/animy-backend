import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { PrismaService } from "../database/prisma.service";
import { AnilistService } from "../common/services/anilist.service";
import { IdMappingService } from "../streaming/id-mapping.service";
import { StreamingProxyService } from "../streaming/streaming.proxy.service";
import { SearchMangaDto } from "./dto/search-manga.dto";
import { JikanService } from "../common/services/jikan.service";
import { Response } from "express";
import axios from "axios";

@Injectable()
export class MangaService {
  private readonly logger = new Logger(MangaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anilistService: AnilistService,
    private readonly jikanService: JikanService,
    private readonly idMappingService: IdMappingService,
    private readonly streamingProxyService: StreamingProxyService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async searchManga(searchDto: SearchMangaDto) {
    const { query, page = 1, limit = 25, status } = searchDto;

    // Map Jikan order_by/sort to AniList sort
    let sortStr = "POPULARITY_DESC";
    const sort = searchDto.sort || "desc";
    const orderBy = searchDto.order_by || "popularity";

    if (orderBy === "popularity")
      sortStr = sort === "desc" ? "POPULARITY_DESC" : "POPULARITY";
    else if (orderBy === "score")
      sortStr = sort === "desc" ? "SCORE_DESC" : "SCORE";
    else if (orderBy === "title")
      sortStr = sort === "desc" ? "TITLE_ROMAJI_DESC" : "TITLE_ROMAJI";
    else if (orderBy === "start_date")
      sortStr = sort === "desc" ? "START_DATE_DESC" : "START_DATE";

    try {
      const data = await Promise.race([
        this.anilistService.searchManga(
          query || "",
          Number(page),
          Number(limit),
          sortStr,
          status,
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Manga Search Timeout")), 25000),
        ),
      ]);

      return {
        pagination: {
          last_visible_page: data.pageInfo.lastPage,
          has_next_page: data.pageInfo.hasNextPage,
          current_page: data.pageInfo.currentPage,
          items: {
            count: data.media.length,
            total: data.pageInfo.total,
            per_page: data.pageInfo.perPage,
          },
        },
        data: data.media
          .map(this.mapAnilistToResponse)
          .filter((m) => m !== null),
      };
    } catch (e) {
      this.logger.warn(
        `searchManga failed (AniList rate-limited or down): ${e.message}. Returning empty gracefully.`,
      );
      // Try Jikan fallback for search queries
      if (query) {
        try {
          const jikanResults = await this.jikanService.searchManga(
            query,
            Number(page),
            Number(limit),
          );
          return {
            pagination: {
              last_visible_page: 1,
              has_next_page: false,
              current_page: Number(page),
              items: {
                count: jikanResults.length,
                total: jikanResults.length,
                per_page: Number(limit),
              },
            },
            data: jikanResults
              .map((m) => this.mapJikanToResponse(m))
              .filter((m) => m !== null),
          };
        } catch (jikanErr) {
          this.logger.error(
            `Jikan searchManga fallback also failed: ${jikanErr.message}`,
          );
        }
      }
      // Return empty — home service's extractData fallback will use stale cache
      return {
        pagination: {
          last_visible_page: 1,
          has_next_page: false,
          current_page: Number(page),
          items: { count: 0, total: 0, per_page: Number(limit) },
        },
        data: [],
      };
    }
  }

  async getMangaById(id: number) {
    try {
      // 1. Check Database
      const cachedManga = await this.prisma.manga.findUnique({ where: { id } });
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      if (
        cachedManga &&
        cachedManga.lastUpdated > sevenDaysAgo &&
        cachedManga.imageUrl &&
        cachedManga.synopsis
      ) {
        this.logger.debug(`DB HIT: Manga ${id}`);
        return this.mapDbToResponse(cachedManga);
      }

      this.logger.debug(`DB STALE/MISS: Manga ${id} -> Fetching AniList`);

      // 2. Fetch from AniList
      const data = await this.anilistService.getMangaById(id);
      if (!data)
        throw new HttpException("Not found on AniList", HttpStatus.NOT_FOUND);
      await this.saveMangaToDb(data);

      return this.mapAnilistToResponse(data);
    } catch (error) {
      this.logger.error(`Error fetching manga ${id}`, error);
      // Fallback to DB
      const cached = await this.prisma.manga.findUnique({ where: { id } });
      if (cached) return this.mapDbToResponse(cached);

      // Jikan fallback using correct MAL ID
      this.logger.warn(`AniList Failed for manga ${id}, trying Jikan fallback`);
      let malId = cached?.idMal;
      if (!malId) {
        const mapping = await this.prisma.animeMapping.findUnique({
          where: { id },
        });
        malId = mapping?.idMal;
      }

      if (malId) {
        try {
          const [jikanData, characters, recommendations] = await Promise.all([
            this.jikanService.getMangaById(malId),
            this.jikanService.getMangaCharacters(malId).catch(() => []),
            this.jikanService.getMangaRecommendations(malId).catch(() => []),
          ]);
          if (jikanData)
            return this.mapJikanToResponse(
              jikanData,
              characters,
              recommendations,
            );
        } catch (jikanErr: any) {
          this.logger.error(
            `Jikan fallback failed for manga ${malId}: ${jikanErr.message}`,
          );
        }
      }

      // Final fallback: try Jikan directly assuming id is a MAL ID
      try {
        const [jikanData, characters, recommendations] = await Promise.all([
          this.jikanService.getMangaById(id),
          this.jikanService.getMangaCharacters(id).catch(() => []),
          this.jikanService.getMangaRecommendations(id).catch(() => []),
        ]);
        if (jikanData)
          return this.mapJikanToResponse(
            jikanData,
            characters,
            recommendations,
          );
      } catch (jikanErr: any) {
        this.logger.error(
          `Jikan fallback direct fetch failed for manga ${id}: ${jikanErr.message}`,
        );
      }

      if (error instanceof HttpException) throw error;
      throw new HttpException("Manga not found", HttpStatus.NOT_FOUND);
    }
  }

  async getTopManga(type?: string, filter?: string, page: number = 1) {
    let data;
    // Simple logic: if popularity sort or no sort, get popular. Else trending.
    // AniList handles "Top" usually as Popular or Score.
    if (filter === "bypopularity") {
      data = await this.anilistService.getPopularManga(page);
    } else {
      data = await this.anilistService.getTrendingManga(page);
    }

    return {
      data: (data.media || [])
        .map(this.mapAnilistToResponse)
        .filter((m) => m !== null),
      pageInfo: data.pageInfo,
    };
  }

  async getMangaCharacters(id: number) {
    try {
      const data = await this.anilistService.getMangaById(id);
      const characters = data.characters?.nodes || [];

      return characters.map((char: any) => ({
        character: {
          mal_id: char.id,
          name: char.name.full,
          images: {
            jpg: { image_url: char.image.large },
          },
        },
        role: "Main",
      }));
    } catch (e) {
      return [];
    }
  }

  async getMangaChapters(id: number) {
    try {
      this.logger.debug(`Fetching chapters for manga ${id}`);

      const cachedManga = await this.prisma.manga.findUnique({ where: { id } });
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const hasCache =
        cachedManga?.chaptersList &&
        Array.isArray(cachedManga.chaptersList) &&
        (cachedManga.chaptersList as any[]).length > 0;

      if (hasCache) {
        if (cachedManga.lastUpdated > oneDayAgo) {
          this.logger.debug(`CHAPTER CACHE HIT: Manga ${id}`);
          return { chapters: cachedManga.chaptersList };
        } else {
          this.logger.debug(
            `CHAPTER CACHE STALE: Manga ${id} -> Returning stale cache instantly, dispatching job to BullMQ`,
          );

          this.fetchAndUpdateChaptersBackground(id, cachedManga).catch((e) =>
            this.logger.error(`Background chapter update failed: ${e.message}`),
          );

          return { chapters: cachedManga.chaptersList };
        }
      }

      // No cache, we must fetch synchronously
      return await this.fetchAndUpdateChaptersBackground(id, cachedManga);
    } catch (e) {
      this.logger.error(
        `Failed to fetch chapters for manga ${id}: ${e.message}`,
      );
      return { chapters: [] };
    }
  }

  async fetchAndUpdateChaptersBackground(id: number, cachedManga: any) {
    try {
      let title = cachedManga?.title || "";
      let englishTitle = cachedManga?.titleEnglish || "";
      let nativeTitle = cachedManga?.titleJapanese || "";
      let malId = cachedManga?.idMal || null;

      if (!title) {
        try {
          const anilistInfo = await this.anilistService.getMangaById(id);
          if (anilistInfo) {
            title =
              anilistInfo.title.english ||
              anilistInfo.title.romaji ||
              anilistInfo.title.native;
            englishTitle = anilistInfo.title.english || "";
            nativeTitle = anilistInfo.title.native || "";
            malId = anilistInfo.idMal || null;
          }
        } catch (e) {
          this.logger.error(
            `Failed to fetch title for manga ${id} from AniList`,
          );
        }
      }

      if (!title) {
        this.logger.warn(
          `No title found for manga ${id}, returning empty chapters`,
        );
        return { chapters: [] };
      }

      // Build a deduplicated list of search titles, prioritising the shortest/most precise
      const titlesToSearch = [
        ...new Set(
          [title, englishTitle, nativeTitle].filter((t) => t && t.length > 1),
        ),
      ];

      this.logger.log(`Chapter fetch start for manga ${id} ("${title}")`);

      const startTime = Date.now();

      // ─────────────────────────────────────────────────────────────
      // STRATEGY: Try providers sequentially with fast timeouts.
      // Consumet clone is most reliable from server context.
      // MangaDex direct uses browser headers to bypass Cloudflare.
      // ─────────────────────────────────────────────────────────────

      // Round 1: Consumet clone via AniList meta (fastest + most reliable)
      let chapters = await this.fetchConsumetByAnilistId(id);

      // Round 2: MangaDex via MAL-Sync resolution (highly reliable ID mapping)
      if (!chapters || chapters.length === 0) {
        this.logger.debug(
          `Consumet meta failed for ${id}, trying MangaDex via MALSync`,
        );
        chapters = await this.fetchMangaDexViaMalSync(
          id,
          malId,
          titlesToSearch,
        );
      }

      // Round 3: Consumet clone via title search across providers
      if (!chapters || chapters.length === 0) {
        this.logger.debug(
          `MangaDex failed for ${id}, trying Consumet title search`,
        );
        chapters = await this.fetchConsumetByTitleSearch(titlesToSearch);
      }

      // Round 4: MangaPill via Consumet
      if (!chapters || chapters.length === 0) {
        this.logger.debug(
          `All main providers failed for ${id}, trying MangaPill`,
        );
        chapters = await this.fetchMangaPillByTitle(titlesToSearch);
      }

      this.logger.log(
        `Chapter fetch for ${id} completed in ${Date.now() - startTime}ms → ${chapters?.length || 0} chapters`,
      );

      if (chapters && Array.isArray(chapters) && chapters.length > 0) {
        const sortedChapters = [...chapters].sort((a, b) => {
          const numA = parseFloat(a.chapterNumber) || 0;
          const numB = parseFloat(b.chapterNumber) || 0;
          return numB - numA;
        });

        // Update DB cache in background
        const cachedList = (cachedManga?.chaptersList as any[]) || [];
        if (cachedList.length !== sortedChapters.length) {
          this.prisma.manga
            .update({
              where: { id },
              data: {
                chaptersList: sortedChapters as any,
                lastUpdated: new Date(),
              },
            })
            .catch((e) =>
              this.logger.error(`Failed to update chapter cache: ${e.message}`),
            );
        }

        return { chapters: sortedChapters };
      }

      this.logger.warn(
        `No chapters found for manga ${id} after all provider attempts`,
      );
      return { chapters: [] };
    } catch (e) {
      this.logger.error(
        `fetchAndUpdateChaptersBackground crashed for manga ${id}: ${e.message}`,
      );
      return { chapters: [] };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PROVIDER: MangaDex via AniList ID → MAL-Sync → MangaDex UUID
  // Replaces the broken Consumet meta endpoint (returns 0 chapters).
  // Uses curl-style UA which MangaDex whitelists from server environments.
  // ─────────────────────────────────────────────────────────────────────────
  private async fetchConsumetByAnilistId(anilistId: number): Promise<any[]> {
    const curlHeaders = {
      "User-Agent": "curl/7.88.1",
      Accept: "application/json",
    };

    try {
      this.logger.debug(
        `[MangaDex Primary] Resolving AL=${anilistId} via MAL-Sync`,
      );

      // Step 1: Get MangaDex UUID from MAL-Sync using AniList ID
      let mangaDexId: string | null = null;
      try {
        const syncRes = await axios.get(
          `https://api.malsync.moe/mal/manga/anilist:${anilistId}`,
          { timeout: 6000, headers: curlHeaders },
        );
        const mdSite = syncRes?.data?.Sites?.MangaDex;
        if (mdSite) {
          const keys = Object.keys(mdSite);
          if (keys.length > 0) {
            mangaDexId = keys[0];
            this.logger.debug(
              `[MangaDex Primary] MAL-Sync resolved AL=${anilistId} → MangaDex=${mangaDexId}`,
            );
          }
        }
      } catch (e: any) {
        this.logger.debug(`[MangaDex Primary] MAL-Sync failed: ${e.message}`);
      }

      if (!mangaDexId) return [];

      // Step 2: Fetch chapters using curl UA + properly encoded URL params
      // MangaDex REQUIRES %5B%5D encoding for array params from server IPs
      const params = new URLSearchParams();
      params.append("translatedLanguage[]", "en");
      params.append("order[chapter]", "desc");
      params.append("limit", "500");
      params.append("offset", "0");
      const feedUrl = `https://api.mangadex.org/manga/${mangaDexId}/feed?${params.toString()}`;

      const chaptersRes = await axios.get(feedUrl, {
        timeout: 15000,
        headers: curlHeaders,
      });

      if (chaptersRes.data?.data?.length > 0) {
        const seen = new Set<string>();
        const chapters: any[] = [];
        for (const ch of chaptersRes.data.data) {
          const num = ch.attributes?.chapter || "";
          const key = `ch_${num}`;
          if (!seen.has(key)) {
            seen.add(key);
            chapters.push({
              id: `mangadex_direct___${ch.id}___na`,
              title: ch.attributes?.title || `Chapter ${num}`,
              chapterNumber: num || "0",
              volumeNumber: ch.attributes?.volume || "0",
            });
          }
        }
        this.logger.debug(
          `[MangaDex Primary] Fetched ${chapters.length} chapters for AL=${anilistId}`,
        );
        return chapters;
      }
    } catch (e: any) {
      this.logger.debug(
        `[MangaDex Primary] Failed for AL=${anilistId}: ${e.message}`,
      );
    }
    return [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PROVIDER: MangaDex via MAL-Sync ID resolution
  // Resolves the correct MangaDex UUID via MAL-Sync, then fetches chapters
  // Uses browser-like headers to avoid Cloudflare bot detection
  // ─────────────────────────────────────────────────────────────────────────
  private async fetchMangaDexViaMalSync(
    anilistId: number,
    malId: number | null,
    titles: string[],
  ): Promise<any[]> {
    // MangaDex REQUIRES curl-style UA from server environments (Chrome UA → blocked)
    const curlHeaders = {
      "User-Agent": "curl/7.88.1",
      Accept: "application/json",
    };

    let mangaDexId: string | null = null;

    // Step 1: Try MAL-Sync to get the MangaDex ID
    try {
      // Try via AniList ID first
      const malsyncUrl = `https://api.malsync.moe/mal/manga/anilist:${anilistId}`;
      const syncRes = await axios
        .get(malsyncUrl, { timeout: 5000, headers: curlHeaders })
        .catch(() => null);
      const mdSite = syncRes?.data?.Sites?.MangaDex;
      if (mdSite) {
        mangaDexId = Object.keys(mdSite)[0] || null;
        this.logger.debug(
          `[MangaDex] MALSync resolved AL=${anilistId} → MangaDex=${mangaDexId}`,
        );
      }
    } catch (e: any) {
      this.logger.debug(`[MangaDex] MALSync failed: ${e.message}`);
    }

    // Step 2: Try mapping service
    if (!mangaDexId) {
      try {
        for (const title of titles.slice(0, 2)) {
          const mapped = await this.idMappingService.resolveMangaDexId(
            anilistId,
            title,
          );
          if (mapped) {
            mangaDexId = mapped;
            break;
          }
        }
      } catch (e: any) {
        this.logger.debug(`[MangaDex] ID mapping service failed: ${e.message}`);
      }
    }

    // Step 3: Direct MangaDex search with curl UA (Chrome UA is blocked from servers)
    if (!mangaDexId) {
      for (const title of titles.slice(0, 2)) {
        try {
          // Build properly encoded search URL
          const searchParams = new URLSearchParams();
          searchParams.set("title", title);
          searchParams.set("limit", "5");
          searchParams.append("contentRating[]", "safe");
          searchParams.append("contentRating[]", "suggestive");
          searchParams.append("order[relevance]", "desc");
          const searchRes = await axios.get(
            `https://api.mangadex.org/manga?${searchParams.toString()}`,
            { timeout: 8000, headers: curlHeaders },
          );
          if (searchRes.data?.data?.length > 0) {
            mangaDexId = searchRes.data.data[0].id;
            this.logger.debug(
              `[MangaDex] Search found ID ${mangaDexId} for "${title}"`,
            );
            break;
          }
        } catch (e: any) {
          this.logger.debug(
            `[MangaDex] Search failed for "${title}": ${e.message}`,
          );
        }
      }
    }

    if (!mangaDexId) return [];

    // Step 4: Fetch chapters — MUST use URLSearchParams for proper %5B%5D encoding
    // and curl UA. MangaDex returns 400 if array params are unencoded or Chrome UA is used.
    try {
      const params = new URLSearchParams();
      params.append("translatedLanguage[]", "en");
      params.append("order[chapter]", "desc");
      params.append("limit", "500");
      params.append("offset", "0");
      const feedUrl = `https://api.mangadex.org/manga/${mangaDexId}/feed?${params.toString()}`;

      const chaptersRes = await axios.get(feedUrl, {
        timeout: 15000,
        headers: curlHeaders,
      });

      if (chaptersRes.data?.data?.length > 0) {
        // Deduplicate by chapter number (keep first scan group)
        const seen = new Set<string>();
        const chapters: any[] = [];
        for (const ch of chaptersRes.data.data) {
          const num = ch.attributes?.chapter || "";
          const key = `ch_${num}`;
          if (!seen.has(key)) {
            seen.add(key);
            chapters.push({
              id: `mangadex_direct___${ch.id}___na`,
              title: ch.attributes?.title || `Chapter ${num}`,
              chapterNumber: num || "0",
              volumeNumber: ch.attributes?.volume || "0",
            });
          }
        }
        this.logger.debug(
          `[MangaDex] Fetched ${chapters.length} unique chapters for ${mangaDexId}`,
        );
        return chapters;
      }
    } catch (e: any) {
      this.logger.debug(
        `[MangaDex] Chapter feed failed for ${mangaDexId}: ${e.message}`,
      );
    }
    return [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PROVIDER: Consumet clone title search across multiple manga providers
  // ─────────────────────────────────────────────────────────────────────────
  private async fetchConsumetByTitleSearch(titles: string[]): Promise<any[]> {
    const baseUrls = [
      "https://consumet-api-clone.vercel.app",
      "https://api.consumet.org",
    ];
    const providers = ["mangadex", "mangasee123"];

    const attempts: Promise<any[]>[] = [];

    for (const baseUrl of baseUrls) {
      for (const provider of providers) {
        for (const title of titles.slice(0, 2)) {
          attempts.push(
            (async () => {
              try {
                const searchRes = await axios.get(
                  `${baseUrl}/manga/${provider}/${encodeURIComponent(title)}`,
                  { timeout: 10000 },
                );
                if (!searchRes.data?.results?.length)
                  throw new Error("no results");

                const providerId = searchRes.data.results[0].id;
                const infoRes = await axios.get(
                  `${baseUrl}/manga/${provider}/info?id=${providerId}`,
                  { timeout: 10000 },
                );
                if (!infoRes.data?.chapters?.length)
                  throw new Error("no chapters");

                this.logger.debug(
                  `[Consumet Title] ${provider} @ ${baseUrl} found ${infoRes.data.chapters.length} chapters for "${title}"`,
                );
                return infoRes.data.chapters.map((c: any) => ({
                  id: `${provider}___${Buffer.from(String(c.id)).toString("base64url")}___${Buffer.from(baseUrl).toString("base64url")}`,
                  title:
                    c.title || `Chapter ${c.chapterNumber || c.number || ""}`,
                  chapterNumber: String(c.chapterNumber || c.number || "0"),
                  volumeNumber: String(c.volumeNumber || c.volume || "0"),
                }));
              } catch (e: any) {
                throw new Error(
                  `${provider}@${baseUrl}/${title}: ${e.message}`,
                );
              }
            })(),
          );
        }
      }
    }

    try {
      return await Promise.any(attempts);
    } catch {
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PROVIDER: MangaPill via Consumet — last resort
  // ─────────────────────────────────────────────────────────────────────────
  private async fetchMangaPillByTitle(titles: string[]): Promise<any[]> {
    const baseUrls = [
      "https://consumet-api-clone.vercel.app",
      "https://api.consumet.org",
    ];

    for (const baseUrl of baseUrls) {
      for (const title of titles.slice(0, 2)) {
        try {
          const searchRes = await axios.get(
            `${baseUrl}/manga/mangapill/${encodeURIComponent(title)}`,
            { timeout: 10000 },
          );
          if (!searchRes.data?.results?.length) continue;

          const providerId = searchRes.data.results[0].id;
          const infoRes = await axios.get(
            `${baseUrl}/manga/mangapill/info?id=${providerId}`,
            { timeout: 10000 },
          );
          if (infoRes.data?.chapters?.length > 0) {
            this.logger.debug(
              `[MangaPill] Found ${infoRes.data.chapters.length} chapters for "${title}"`,
            );
            return infoRes.data.chapters.map((c: any) => ({
              id: `mangapill___${Buffer.from(String(c.id)).toString("base64url")}___${Buffer.from(baseUrl).toString("base64url")}`,
              title: c.title || `Chapter ${c.chapterNumber || c.number || ""}`,
              chapterNumber: String(c.chapterNumber || c.number || "0"),
              volumeNumber: String(c.volumeNumber || c.volume || "0"),
            }));
          }
        } catch (e: any) {
          this.logger.debug(
            `[MangaPill] ${baseUrl}/${title} failed: ${e.message}`,
          );
        }
      }
    }
    return [];
  }

  async proxyImage(url: string, referer: string, res: Response) {
    return this.streamingProxyService.proxy(url, referer, res);
  }

  async getChapterPages(chapterId: string, proxyBaseUrl?: string) {
    const rawId = decodeURIComponent(chapterId);
    const cacheKey = `manga_pages:${rawId}`;

    const cachedPages = await this.cacheManager.get(cacheKey);
    if (cachedPages) {
      this.logger.debug(`[Cache Hit] Serving pages for chapter: ${rawId}`);
      return cachedPages;
    }

    const pages = await this.fetchChapterPages(chapterId, proxyBaseUrl);

    if (pages && pages.pages && pages.pages.length > 0) {
      // Cache the pages for 7 days
      await this.cacheManager.set(cacheKey, pages, 7 * 24 * 60 * 60 * 1000);
    }

    return pages;
  }

  private async fetchChapterPages(chapterId: string, proxyBaseUrl?: string) {
    try {
      // URL-decode in case the frontend passed an encoded chapter ID
      const rawId = decodeURIComponent(chapterId);
      this.logger.debug(`Fetching pages for chapter: ${rawId}`);

      const browserHeaders = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
      };

      // Centralized proxy wrapper logic
      const wrapInProxy = (originalUrl: string) => {
        if (!proxyBaseUrl || !originalUrl) return originalUrl;

        let referer = "";
        const lowerUrl = originalUrl.toLowerCase();
        const lowerId = rawId.toLowerCase();

        if (
          lowerUrl.includes("mangapill.com") ||
          lowerUrl.includes("readdetectiveconan.com") ||
          lowerId.startsWith("mangapill")
        ) {
          referer = "https://mangapill.com/";
        } else if (
          lowerUrl.includes("mangasee") ||
          lowerId.startsWith("mangasee")
        ) {
          referer = "https://mangasee123.com/";
        } else if (
          lowerUrl.includes("mangafire") ||
          lowerId.startsWith("mangafire")
        ) {
          referer = "https://mangafire.to/";
        } else if (
          lowerId.includes("mangadex") ||
          lowerUrl.includes("mangadex")
        ) {
          referer = "https://mangadex.org/";
        } else if (lowerId.startsWith("anify")) {
          if (lowerUrl.includes("mangadex")) referer = "https://mangadex.org/";
        }

        if (referer) {
          return `${proxyBaseUrl}?url=${encodeURIComponent(originalUrl)}&referer=${encodeURIComponent(referer)}`;
        }
        return originalUrl;
      };

      let url = "";

      // Support both triple and double underscores as delimiters
      let parts = rawId.split("___");
      if (parts.length < 2) {
        parts = rawId.split("__");
      }

      if (parts.length >= 2) {
        const provider = parts[0];
        const actualId =
          provider === "mangadex_direct"
            ? parts[1]
            : Buffer.from(parts[1], "base64url").toString("utf-8");
        const baseUrl =
          provider === "mangadex_direct"
            ? "https://api.mangadex.org"
            : parts[2]
              ? Buffer.from(parts[2], "base64url").toString("utf-8")
              : "https://consumet-api-clone.vercel.app";

        if (provider === "anify") {
          const pagesRes = await axios.get(
            `https://api.anify.tv/pages?id=${actualId}&providerId=${baseUrl}&readId=${actualId}&episodeNumber=0&type=manga`,
            { timeout: 10000 },
          );

          if (pagesRes.data) {
            const pages = Array.isArray(pagesRes.data)
              ? pagesRes.data
              : pagesRes.data.pages || [];
            return {
              pages: pages.map((p: any, index: number) => ({
                img: wrapInProxy(p.url || p.img || p),
                page: index + 1,
              })),
            };
          }
        }

        if (provider === "mangadex_direct") {
          // Try MangaDex at-home API with curl UA (Chrome UA blocked from servers)
          const curlHeaders = {
            "User-Agent": "curl/7.88.1",
            Accept: "application/json",
          };
          try {
            const atHomeRes = await axios.get(
              `https://api.mangadex.org/at-home/server/${actualId}`,
              { timeout: 12000, headers: curlHeaders },
            );
            const host = atHomeRes.data.baseUrl;
            const hash = atHomeRes.data.chapter.hash;
            const files = atHomeRes.data.chapter.data;

            if (files && files.length > 0) {
              return {
                pages: files.map((f: string, i: number) => ({
                  img: wrapInProxy(`${host}/data/${hash}/${f}`),
                  page: i + 1,
                })),
              };
            }

            // Fallback to data-saver quality
            const dataSaverFiles = atHomeRes.data.chapter.dataSaver;
            if (dataSaverFiles && dataSaverFiles.length > 0) {
              const dataSaverHash = atHomeRes.data.chapter.hash;
              return {
                pages: dataSaverFiles.map((f: string, i: number) => ({
                  img: wrapInProxy(`${host}/data-saver/${dataSaverHash}/${f}`),
                  page: i + 1,
                })),
              };
            }
          } catch (e: any) {
            this.logger.warn(
              `MangaDex at-home failed for ${actualId}: ${e.message}`,
            );
          }
          throw new Error("Could not load MangaDex chapter pages");
        }

        if (provider === "mangapill") {
          url = `${baseUrl}/manga/mangapill/read?chapterId=${actualId}`;
        } else if (provider === "anilist") {
          url = `${baseUrl}/meta/anilist-manga/read?chapterId=${actualId}&provider=mangadex`;
        } else {
          url = `${baseUrl}/manga/${provider}/read?chapterId=${actualId}`;
        }
      } else {
        url = `https://consumet-api-clone.vercel.app/meta/anilist-manga/read?chapterId=${rawId}&provider=mangadex`;
      }

      this.logger.debug(`Fetching pages from: ${url}`);
      const { data } = await axios.get(url, { timeout: 12000 });
      const rawPages = Array.isArray(data) ? data : data.pages || [];

      if (!rawPages || rawPages.length === 0) {
        throw new Error("No pages returned from provider");
      }

      return {
        pages: rawPages.map((p: any, i: number) => ({
          img: wrapInProxy(p.img || p.url || p),
          page: p.page || i + 1,
        })),
      };
    } catch (e) {
      this.logger.error(
        `Failed to fetch pages for chapter ${chapterId}: ${e.message}`,
      );
      throw new HttpException(
        "Failed to fetch chapter pages from provider",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // --- Helper Methods ---

  private async saveMangaToDb(data: any) {
    try {
      await this.prisma.manga.upsert({
        where: { id: data.id },
        update: this.mapAnilistToPrisma(data),
        create: {
          id: data.id,
          ...this.mapAnilistToPrisma(data),
        },
      });
    } catch (e) {
      this.logger.error(`Failed to save manga ${data.id} to DB`, e);
    }
  }

  private mapAnilistToPrisma(data: any) {
    return {
      idMal: data.idMal,
      title: data.title.romaji || data.title.english || data.title.native,
      titleEnglish: data.title.english,
      titleJapanese: data.title.native,
      synopsis: data.description
        ? data.description.replace(/<[^>]*>?/gm, "")
        : "",
      type: data.format,
      chapters: data.chapters,
      volumes: data.volumes,
      status: data.status,
      score: data.averageScore ? data.averageScore / 10 : null,
      rank:
        data.rankings?.find((r: any) => r.allTime)?.rank ||
        data.rankings?.[0]?.rank,
      popularity: data.popularity,
      imageUrl: data.coverImage.extraLarge || data.coverImage.large,
      authors:
        data.staff?.nodes?.map((s: any) => ({ name: s.name.full })) || [],
      genres: data.genres?.map((g: string) => ({ name: g })) || [],
      background: null,
      published: {
        from: data.startDate?.year ? `${data.startDate.year}` : null,
      },
      scoredBy: null,
      members: data.popularity,
      favorites: data.favourites,
      characters:
        data.characters?.edges?.map((edge: any) => ({
          role: edge?.role,
          character: {
            mal_id: edge?.node?.id,
            name: edge?.node?.name?.full,
            images: {
              jpg: { image_url: edge?.node?.image?.large },
            },
          },
        })) || [],
      relations:
        data.relations?.edges?.map((edge: any) => ({
          relation: edge?.relationType,
          entry: [
            {
              mal_id: edge?.node?.id,
              type: edge?.node?.type,
              name: edge?.node?.title?.english || edge?.node?.title?.romaji,
              images: {
                jpg: { image_url: edge?.node?.coverImage?.large },
              },
            },
          ],
        })) || [],
      recommendations:
        data.recommendations?.nodes
          ?.filter((node: any) => node?.mediaRecommendation)
          ?.map((node: any) => ({
            entry: {
              mal_id: node?.mediaRecommendation?.id,
              title:
                node?.mediaRecommendation?.title?.english ||
                node?.mediaRecommendation?.title?.romaji,
              images: {
                jpg: {
                  image_url: node?.mediaRecommendation?.coverImage?.large,
                },
              },
            },
          })) || [],
      staff:
        data.staff?.nodes?.map((s: any) => ({
          name: s.name.full,
        })) || [],
    };
  }

  private mapAnilistToResponse(data: any) {
    if (!data) return null;
    return {
      mal_id: data.id,
      title: data.title.romaji || data.title.english || data.title.native,
      title_english: data.title.english,
      title_japanese: data.title.native,
      synopsis: data.description
        ? data.description.replace(/<[^>]*>?/gm, "")
        : "",
      type: data.format,
      chapters: data.chapters,
      volumes: data.volumes,
      status: data.status,
      score: data.averageScore ? data.averageScore / 10 : null,
      rank: null,
      popularity: data.popularity,
      background: null,
      published: {
        from: data.startDate?.year,
      },
      images: {
        jpg: {
          image_url: data.coverImage?.large,
          large_image_url: data.coverImage?.extraLarge,
          small_image_url: data.coverImage?.medium,
        },
        webp: {
          image_url: data.coverImage?.large,
          large_image_url: data.coverImage?.extraLarge,
          small_image_url: data.coverImage?.medium,
        },
      },
      authors:
        data.staff?.nodes?.map((s: any) => ({ name: s.name.full })) || [],
      genres: data.genres?.map((g: string) => ({ name: g, mal_id: 0 })) || [],
      characters:
        data.characters?.edges?.map((edge: any) => ({
          role: edge?.role,
          character: {
            mal_id: edge?.node?.id,
            name: edge?.node?.name?.full,
            images: {
              jpg: { image_url: edge?.node?.image?.large },
            },
          },
        })) ||
        data.characters?.nodes?.map((char: any) => ({
          character: {
            mal_id: char?.id,
            name: char?.name?.full,
            images: {
              jpg: { image_url: char?.image?.large },
            },
          },
          role: "Main",
        })) ||
        [],
      relations:
        data.relations?.edges?.map((edge: any) => ({
          relation: edge?.relationType,
          entry: [
            {
              mal_id: edge?.node?.id,
              type: edge?.node?.type,
              name: edge?.node?.title?.english || edge?.node?.title?.romaji,
              images: {
                jpg: { image_url: edge?.node?.coverImage?.large },
              },
            },
          ],
        })) || [],
      recommendations:
        data.recommendations?.nodes
          ?.filter((node: any) => node?.mediaRecommendation)
          ?.map((node: any) => ({
            entry: {
              mal_id: node?.mediaRecommendation?.id,
              title:
                node?.mediaRecommendation?.title?.english ||
                node?.mediaRecommendation?.title?.romaji,
              images: {
                jpg: {
                  image_url: node?.mediaRecommendation?.coverImage?.large,
                },
              },
            },
          })) || [],
    };
  }

  private mapDbToResponse(dbManga: any) {
    return {
      mal_id: dbManga.id,
      title: dbManga.title,
      title_english: dbManga.titleEnglish,
      title_japanese: dbManga.titleJapanese,
      synopsis: dbManga.synopsis,
      type: dbManga.type,
      chapters: dbManga.chapters,
      volumes: dbManga.volumes,
      status: dbManga.status,
      score: dbManga.score,
      rank: dbManga.rank,
      popularity: dbManga.popularity,
      background: dbManga.background,
      published: dbManga.published,
      scored_by: dbManga.scoredBy,
      members: dbManga.members,
      favorites: dbManga.favorites,
      images: {
        jpg: {
          image_url: dbManga.imageUrl || "",
          large_image_url: dbManga.imageUrl || "",
          small_image_url: dbManga.imageUrl || "",
        },
        webp: {
          image_url: dbManga.imageUrl || "",
          large_image_url: dbManga.imageUrl || "",
          small_image_url: dbManga.imageUrl || "",
        },
      },
      authors: Array.isArray(dbManga.authors) ? dbManga.authors : [],
      genres: Array.isArray(dbManga.genres) ? dbManga.genres : [],
      characters: Array.isArray(dbManga.characters) ? dbManga.characters : [],
      relations: Array.isArray(dbManga.relations) ? dbManga.relations : [],
      recommendations: Array.isArray(dbManga.recommendations)
        ? dbManga.recommendations
        : [],
      staff: Array.isArray(dbManga.staff) ? dbManga.staff : [],
    };
  }

  private mapJikanToResponse(
    jikan: any,
    jikanCharacters: any[] = [],
    jikanRecommendations: any[] = [],
  ) {
    if (!jikan) return null;
    return {
      mal_id: jikan.mal_id,
      title: jikan.title,
      title_english: jikan.title_english,
      title_japanese: jikan.title_japanese,
      synopsis: jikan.synopsis || "No synopsis available.",
      type: jikan.type,
      chapters: jikan.chapters,
      volumes: jikan.volumes,
      status: jikan.status,
      score: jikan.score,
      rank: jikan.rank,
      popularity: jikan.popularity,
      members: jikan.members,
      favorites: jikan.favorites,
      images: {
        jpg: {
          image_url: jikan.images?.jpg?.image_url,
          large_image_url: jikan.images?.jpg?.large_image_url,
          small_image_url: jikan.images?.jpg?.small_image_url,
        },
        webp: {
          image_url: jikan.images?.webp?.image_url,
          large_image_url: jikan.images?.webp?.large_image_url,
          small_image_url: jikan.images?.webp?.small_image_url,
        },
      },
      authors: jikan.authors?.map((a: any) => ({ name: a.name })) || [],
      genres:
        jikan.genres?.map((g: any) => ({ name: g.name, mal_id: g.mal_id })) ||
        [],
      relations:
        jikan.relations?.flatMap((r: any) =>
          r.entry.map((entry: any) => ({
            relationType: r.relation.toUpperCase().replace(/\s+/g, "_"),
            node: {
              id: entry.mal_id,
              title: { english: entry.name, romaji: entry.name },
              type: entry.type.toUpperCase(),
              coverImage: { large: "" },
            },
          })),
        ) || [],
      recommendations:
        jikanRecommendations?.map((r: any) => ({
          mediaRecommendation: {
            id: r.entry.mal_id,
            title: { romaji: r.entry.title, english: r.entry.title },
            coverImage: {
              large:
                r.entry.images?.jpg?.large_image_url ||
                r.entry.images?.jpg?.image_url,
            },
          },
        })) || [],
      characters:
        jikanCharacters?.map((c: any) => ({
          role: c.role,
          node: {
            id: c.character.mal_id,
            name: { full: c.character.name },
            image: { large: c.character.images?.jpg?.image_url },
          },
          voiceActors:
            c.voice_actors
              ?.filter((va: any) => va.language === "Japanese")
              .map((va: any) => ({
                id: va.person.mal_id,
                name: { full: va.person.name },
                image: { large: va.person.images?.jpg?.image_url },
              })) || [],
        })) || [],
      staff: [],
    };
  }
}
