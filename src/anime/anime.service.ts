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
import { JikanService } from "../common/services/jikan.service";
import { SearchAnimeDto } from "./dto/search-anime.dto";

@Injectable()
export class AnimeService {
  private readonly logger = new Logger(AnimeService.name);
  private readonly activeRequests = new Map<number, Promise<any>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly anilistService: AnilistService,
    private readonly jikanService: JikanService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async searchAnime(searchDto: SearchAnimeDto) {
    const { query, page = 1, limit = 25, type, order_by, sort } = searchDto;

    // Map Jikan 'type' to AniList 'format'
    let format = null;
    if (type) {
      format = type.toUpperCase();
      if (format === "SPECIAL") format = "SPECIAL";
    }

    // Map Jikan 'order_by' to AniList 'sort'
    let anilistSort = "POPULARITY_DESC";
    if (order_by === "score") anilistSort = "SCORE_DESC";
    else if (order_by === "title") anilistSort = "TITLE_ENGLISH";
    else if (order_by === "start_date") anilistSort = "START_DATE_DESC";
    else if (order_by === "favorites") anilistSort = "FAVOURITES_DESC";
    else if (order_by === "rank") anilistSort = "SCORE_DESC";

    if (sort === "asc" && order_by === "popularity") anilistSort = "POPULARITY";

    // Cache key
    const cacheKey = `search:${JSON.stringify(searchDto)}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.anilistService.searchAnime(
        query || undefined,
        Number(page),
        Number(limit),
        format,
        anilistSort,
      );

      const response = {
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
        data: data.media.map((item) => this.mapAnilistToResponse(item)),
      };

      await this.cacheManager.set(cacheKey, response, 1800000); // 30 mins
      return response;
    } catch (e) {
      this.logger.warn(
        `AniList Search Failed, falling back to Jikan: ${e.message}`,
      );
      // Actual search fallback to Jikan
      const jikanResults = await this.jikanService.searchAnime(
        query || "",
        Number(page),
        Number(limit),
        type,
      );
      const response = {
        pagination: {
          last_visible_page: 1,
          has_next_page: jikanResults.length === limit,
          current_page: Number(page),
          items: {
            count: jikanResults.length,
            total: jikanResults.length,
            per_page: Number(limit),
          },
        },
        data: jikanResults.map((r) => this.mapJikanToResponse(r)),
      };
      return response;
    }
  }

  async getAnimeById(id: number) {
    if (!id || isNaN(id)) {
      this.logger.warn(`Invalid anime ID received: ${id}`);
      return null;
    }
    const cacheKey = `anime:${id}`;
    const cachedResponse = await this.cacheManager.get(cacheKey);
    if (cachedResponse) return cachedResponse;

    try {
      const cachedAnime = await this.prisma.anime.findUnique({ where: { id } });
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      if (
        cachedAnime &&
        cachedAnime.imageUrl &&
        cachedAnime.synopsis &&
        cachedAnime.idMal &&
        cachedAnime.characters &&
        (cachedAnime.characters as any[]).length > 0
      ) {
        if (cachedAnime.lastUpdated > sevenDaysAgo) {
          this.logger.debug(`DB HIT (FRESH): Anime ${id}`);
          const resp = this.mapDbToResponse(cachedAnime);
          await this.cacheManager.set(cacheKey, resp, 3600000); // 1 hour
          return resp;
        } else {
          this.logger.debug(
            `DB HIT (STALE): Anime ${id} -> Returning stale and triggering SWR update`,
          );
          this.updateAnimeInBackground(id).catch((err) =>
            this.logger.error(
              `Background update failed for ${id}: ${err.message}`,
            ),
          );
          const resp = this.mapDbToResponse(cachedAnime);
          await this.cacheManager.set(cacheKey, resp, 3600000); // 1 hour
          return resp;
        }
      }

      this.logger.debug(`DB MISS/INCOMPLETE: Anime ${id} -> Fetching AniList`);

      if (this.activeRequests.has(id)) {
        try {
          await this.activeRequests.get(id);
        } catch (e) {}
        const freshlyCached = await this.cacheManager.get(cacheKey);
        if (freshlyCached) return freshlyCached;
      }

      const fetchPromise = (async () => {
        try {
          const data = await this.anilistService.getAnimeById(id);
          if (!data)
            throw new HttpException(
              "Not found on AniList",
              HttpStatus.NOT_FOUND,
            );
          await this.saveAnimeToDb(data);
          const resp = this.mapAnilistToResponse(data);
          await this.cacheManager.set(cacheKey, resp, 3600000); // 1 hour
          return resp;
        } finally {
          this.activeRequests.delete(id);
        }
      })();
      this.activeRequests.set(id, fetchPromise);
      return await fetchPromise;
    } catch (error) {
      this.logger.error(`Error fetching anime ${id}`, error.message);

      // Fallback to DB if possible
      const cached = await this.prisma.anime.findUnique({ where: { id } });
      if (cached) return this.mapDbToResponse(cached);

      // Fallback to Jikan if we have MAL ID
      this.logger.warn(`AniList Failed for ${id}, trying Jikan fallback`);
      let malId = cached?.idMal;
      if (!malId) {
        const mapping = await this.prisma.animeMapping.findUnique({
          where: { id },
        });
        malId = mapping?.idMal;
      }

      if (malId) {
        const jikanData = await this.jikanService.getAnimeById(malId);
        if (jikanData) return this.mapJikanToResponse(jikanData);
      }

      // Final fallback: try Jikan directly assuming id is a MAL ID
      try {
        const directJikanData = await this.jikanService.getAnimeById(id);
        if (directJikanData) {
          // Add small delay to respect Jikan's rate limits
          await new Promise(r => setTimeout(r, 500));
          const characters = await this.jikanService.getAnimeCharacters(id).catch(() => []);
          await new Promise(r => setTimeout(r, 500));
          const recommendations = await this.jikanService.getAnimeRecommendations(id).catch(() => []);
          
          return this.mapJikanToResponse(
            directJikanData,
            characters,
            recommendations,
          );
        }
      } catch (jikanErr: any) {
        this.logger.error(
          `Jikan fallback direct fetch failed for ${id}: ${jikanErr.message}`,
        );
      }

      if (error instanceof HttpException) throw error;
      throw new HttpException("Anime not found", HttpStatus.NOT_FOUND);
    }
  }

  async getTopAnime(type?: string, filter?: string) {
    const cacheKey = `top:${filter}:${type}`;
    this.logger.debug(`Fetching top anime: filter=${filter}, type=${type}`);

    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`TOP ANIME CACHE HIT: ${cacheKey}`);
      return cached;
    }

    try {
      this.logger.debug(
        `TOP ANIME CACHE MISS: ${cacheKey} -> Fetching AniList`,
      );
      const data = await Promise.race([
        (async () => {
          if (filter === "bypopularity") {
            return await this.anilistService.getPopular();
          } else if (filter === "airing") {
            return await this.anilistService.getTopAiring();
          } else {
            return await this.anilistService.getTrending();
          }
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Gateway Safety Timeout")), 15000),
        ),
      ]);

      const resp = {
        data: (data.media || [])
          .map((m: any) => this.mapAnilistToResponse(m))
          .filter((a) => a !== null),
        pageInfo: data.pageInfo,
      };
      await this.cacheManager.set(cacheKey, resp, 3600000); // 1 hour
      return resp;
    } catch (e) {
      this.logger.warn(
        `AniList Top Anime failed, falling back to Jikan: ${e.message}`,
      );
      const data = await this.jikanService.getTopAnime(filter);
      return {
        data: (data || []).map((r) => this.mapJikanToResponse(r)),
      };
    }
  }

  async getAnimeByType(type: string, page: number = 1) {
    try {
      const data = await this.anilistService.getPopular(page);
      return {
        data: (data.media || [])
          .map((item) => this.mapAnilistToResponse(item))
          .filter((a) => a !== null),
        pageInfo: data.pageInfo,
      };
    } catch (e) {
      const data = await this.jikanService.getTopAnime();
      return { data: data.map((r) => this.mapJikanToResponse(r)) };
    }
  }

  async getUpcomingNextSeason(page: number = 1) {
    try {
      const data = await this.anilistService.getNextSeason(page);
      return {
        data: (data.media || [])
          .map((item: any) => this.mapAnilistToResponse(item))
          .filter((a: any) => a !== null),
        pageInfo: data.pageInfo,
      };
    } catch (e) {
      this.logger.warn(
        `AniList Upcoming failed, falling back to Jikan: ${e.message}`,
      );
      const data = await this.jikanService.getUpcoming();
      return { data: data.map((r) => this.mapJikanToResponse(r)) };
    }
  }

  async getUpcomingSchedule() {
    const cacheKey = `schedule:today`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    try {
      // Jikan /schedules endpoint returns today's schedule by default or can specify a day
      const days = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      const today = days[new Date().getDay()];
      const res = await fetch(
        `https://api.jikan.moe/v4/schedules?filter=${today}`,
      );
      if (!res.ok) throw new Error("Jikan schedule failed");
      const json = await res.json();

      const response = { data: json.data || [] };
      await this.cacheManager.set(cacheKey, response, 3600000); // cache for 1 hour
      return response;
    } catch (e) {
      this.logger.error(`Failed to fetch schedule: ${e.message}`);
      return { data: [] };
    }
  }

  async getAnimeCharacters(id: number) {
    const cacheKey = `chars:${id}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.anilistService.getAnimeById(id);
      const response = { data: data.characters?.edges || [] };
      await this.cacheManager.set(cacheKey, response, 3600000);
      return response;
    } catch (e) {
      this.logger.warn(
        `AniList Characters failed for ${id}, trying Jikan fallback`,
      );
      const mapping = await this.prisma.animeMapping.findUnique({
        where: { id },
      });
      if (mapping?.idMal) {
        const jikanChars = await this.jikanService.getAnimeCharacters(
          mapping.idMal,
        );
        return {
          data: jikanChars.map((c) => ({
            role: c.role,
            node: {
              id: c.character.mal_id,
              name: { full: c.character.name },
              image: { large: c.character.images?.jpg?.image_url },
            },
          })),
        };
      }
      return { data: [] };
    }
  }

  async getAnimeRecommendations(id: number) {
    const cacheKey = `recs:${id}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.anilistService.getAnimeById(id);
      const response = {
        data: data.recommendations?.nodes || [],
      };
      await this.cacheManager.set(cacheKey, response, 3600000);
      return response;
    } catch (e) {
      this.logger.warn(
        `AniList Recommendations failed for ${id}, trying Jikan fallback`,
      );
      const mapping = await this.prisma.animeMapping.findUnique({
        where: { id },
      });
      if (mapping?.idMal) {
        const jikanRecs = await this.jikanService.getAnimeRecommendations(
          mapping.idMal,
        );
        return {
          data: jikanRecs.map((r) => ({
            mediaRecommendation: {
              id: r.entry.mal_id,
              title: { romaji: r.entry.title },
              coverImage: { large: r.entry.images?.jpg?.image_url },
            },
          })),
        };
      }
      return { data: [] };
    }
  }

  // --- Helper Methods ---

  private async updateAnimeInBackground(id: number) {
    if (this.activeRequests.has(id)) return;
    const fetchPromise = (async () => {
      try {
        const data = await this.anilistService.getAnimeById(id);
        if (data) {
          await this.saveAnimeToDb(data);
          const resp = this.mapAnilistToResponse(data);
          await this.cacheManager.set(`anime:${id}`, resp, 3600000);
        }
      } finally {
        this.activeRequests.delete(id);
      }
    })();
    this.activeRequests.set(id, fetchPromise);
    await fetchPromise;
  }

  private async saveAnimeToDb(data: any) {
    try {
      await this.prisma.anime.upsert({
        where: { id: data.id }, // AniList ID
        update: this.mapAnilistToPrisma(data),
        create: {
          id: data.id,
          ...this.mapAnilistToPrisma(data),
        },
      });
    } catch (e) {
      this.logger.error(`Failed to save anime ${data.id} to DB`, e);
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
        : "", // Strip HTML
      type: data.format,
      episodes: data.episodes,
      status: data.status,
      rating: "PG-13", // Default/Placeholder as AniList doesn't give simple rating string like MAL
      score: data.averageScore ? data.averageScore / 10 : null,
      rank:
        data.rankings?.find((r: any) => r.allTime)?.rank ||
        data.rankings?.[0]?.rank,
      popularity: data.popularity,
      imageUrl: data.coverImage.extraLarge || data.coverImage.large,
      bannerImage: data.bannerImage,
      duration: data.duration ? `${data.duration} min` : null,
      source: data.source,
      airing: data.status === "RELEASING",
      aired: {
        // Simplified aired object
        from: data.startDate
          ? `${data.startDate.year}-${data.startDate.month}-${data.startDate.day}`
          : null,
      },
      scoredBy: null,
      members: data.popularity, // Use popularity as members count proxy
      favorites: data.favourites,
      background: null,
      year: data.seasonYear,
      season: data.season,
      genres: data.genres?.map((g: string) => ({ name: g })) || [], // Map to object structure if DB expects JSON
      studios: data.studios?.nodes?.map((s: any) => ({ name: s.name })) || [],
      streamingLinks:
        data.externalLinks?.map((link: any) => ({
          name: link.site,
          url: link.url,
        })) || [],
      characters:
        data.characters?.edges?.filter((edge: any) => edge && edge.node) || [],
      recommendations:
        data.recommendations?.nodes?.filter(
          (node: any) => node && node.mediaRecommendation,
        ) || [],
      staff:
        data.staff?.edges
          ?.filter((edge: any) => edge && edge.node)
          .map((edge: any) => ({
            role: edge.role,
            node: edge.node,
          })) || [],
      relations:
        data.relations?.edges
          ?.filter((edge: any) => edge && edge.node)
          .map((edge: any) => ({
            relationType: edge.relationType,
            node: edge.node,
          })) || [],
      trailerUrl: data.trailer
        ? `https://www.youtube.com/watch?v=${data.trailer.id}`
        : null,
    };
  }

  private mapAnilistToResponse(data: any) {
    if (!data) return null;
    return {
      id: data.id,
      anilistId: data.id,
      mal_id: data.id, // KEEP as AniList ID for frontend routing compatibility
      idMal: data.idMal, // Real MAL ID for streaming providers like VidLink
      tmdbId: data.idTmdb, // If available from AniList service or previous DB enrichment
      title: data.title.romaji || data.title.english || data.title.native,
      title_english: data.title.english,
      title_japanese: data.title.native,
      synopsis: data.description ? data.description : "No synopsis available.",
      type: data.format,
      episodes: data.episodes,
      status: data.status,
      score: data.averageScore ? data.averageScore / 10 : null,
      rank:
        data.rankings?.find((r: any) => r.allTime)?.rank ||
        data.rankings?.[0]?.rank,
      popularity: data.popularity,
      members: data.popularity,
      favorites: data.favourites,
      duration: data.duration ? `${data.duration} min` : null,
      source: data.source,
      bannerImage: data.bannerImage,
      color: data.coverImage?.color,
      airing: data.status === "RELEASING",
      aired: {
        from: data.startDate?.year
          ? `${data.startDate.year}-${String(data.startDate.month || 1).padStart(2, "0")}-${String(data.startDate.day || 1).padStart(2, "0")}`
          : null,
      },
      images: {
        jpg: {
          image_url: data.coverImage.large,
          large_image_url: data.coverImage.extraLarge,
          small_image_url: data.coverImage.medium,
        },
        webp: {
          image_url: data.coverImage.large,
          large_image_url: data.coverImage.extraLarge,
          small_image_url: data.coverImage.medium,
        },
      },
      trailer: {
        url:
          data.trailer?.site === "youtube"
            ? `https://www.youtube.com/watch?v=${data.trailer.id}`
            : data.trailer?.site === "dailymotion"
              ? `https://www.dailymotion.com/video/${data.trailer.id}`
              : data.trailer?.id
                ? `https://www.youtube.com/watch?v=${data.trailer.id}`
                : null,
        youtube_id: data.trailer?.site === "youtube" ? data.trailer.id : null,
        embed_url:
          data.trailer?.site === "youtube"
            ? `https://www.youtube.com/embed/${data.trailer.id}`
            : data.trailer?.site === "dailymotion"
              ? `https://www.dailymotion.com/embed/video/${data.trailer.id}`
              : data.trailer?.id
                ? `https://www.youtube.com/embed/${data.trailer.id}`
                : null,
        thumbnail: data.trailer?.thumbnail,
      },
      year: data.seasonYear,
      season: data.season,
      genres: data.genres?.map((g: string) => ({ name: g, mal_id: 0 })) || [],
      studios:
        data.studios?.nodes?.map((s: any) => ({ name: s.name, mal_id: 0 })) ||
        [],
      streaming:
        data.externalLinks?.map((link: any) => ({
          name: link.site,
          url: link.url,
        })) || [],
      relations:
        data.relations?.edges
          ?.filter((edge: any) => edge && edge.node)
          .map((edge: any) => ({
            relationType: edge.relationType,
            node: edge.node,
          })) || [],
      staff:
        data.staff?.edges
          ?.filter((edge: any) => edge && edge.node)
          .map((edge: any) => ({
            role: edge.role,
            node: edge.node,
          })) || [],
      recommendations:
        data.recommendations?.nodes?.filter(
          (node: any) => node && node.mediaRecommendation,
        ) || [],
      characters:
        data.characters?.edges?.filter((edge: any) => edge && edge.node) || [],
    };
  }

  private mapDbToResponse(dbAnime: any) {
    // Normalize the aired object from DB storage
    const airedRaw = dbAnime.aired;
    let aired: { from: string | null } = { from: null };
    if (airedRaw && typeof airedRaw === "object") {
      // DB stores { from: "YYYY-M-D" } or { from: "YYYY" } or { from: null }
      aired = { from: airedRaw.from || null };
    } else if (typeof airedRaw === "string" && airedRaw) {
      aired = { from: airedRaw };
    } else if (dbAnime.year) {
      // Fallback: build from year field if aired is missing
      aired = { from: `${dbAnime.year}-01-01` };
    }

    return {
      id: dbAnime.id,
      mal_id: dbAnime.id, // Consistent with mapAnilistToResponse (AniList ID)
      anilistId: dbAnime.id,
      idMal: dbAnime.idMal || dbAnime.id, // Real MAL ID for streaming
      tmdbId: dbAnime.idTmdb,
      title: dbAnime.title,
      title_english: dbAnime.titleEnglish,
      title_japanese: dbAnime.titleJapanese,
      synopsis: dbAnime.synopsis,
      type: dbAnime.type,
      episodes: dbAnime.episodes,
      status: dbAnime.status,
      rating: dbAnime.rating,
      score: dbAnime.score,
      rank: dbAnime.rank,
      popularity: dbAnime.popularity,
      duration: dbAnime.duration,
      source: dbAnime.source,
      airing: dbAnime.airing,
      aired,
      scored_by: dbAnime.scoredBy,
      members: dbAnime.members,
      favorites: dbAnime.favorites,
      background: dbAnime.background,
      bannerImage: dbAnime.bannerImage,
      images: {
        jpg: {
          image_url: dbAnime.imageUrl || "",
          large_image_url: dbAnime.imageUrl || "",
          small_image_url: dbAnime.imageUrl || "",
        },
        webp: {
          image_url: dbAnime.imageUrl || "",
          large_image_url: dbAnime.imageUrl || "",
          small_image_url: dbAnime.imageUrl || "",
        },
      },
      trailer: {
        url: dbAnime.trailerUrl,
        youtube_id: dbAnime.trailerUrl?.includes("youtube.com/watch?v=")
          ? dbAnime.trailerUrl.split("v=")[1]?.split("&")[0]
          : dbAnime.trailerUrl?.includes("youtu.be/")
            ? dbAnime.trailerUrl.split("/").pop()
            : null,
        embed_url: dbAnime.trailerUrl?.includes("youtube.com/watch?v=")
          ? `https://www.youtube.com/embed/${dbAnime.trailerUrl.split("v=")[1]?.split("&")[0]}`
          : dbAnime.trailerUrl?.includes("youtu.be/")
            ? `https://www.youtube.com/embed/${dbAnime.trailerUrl.split("/").pop()}`
            : dbAnime.trailerUrl?.includes("dailymotion.com/video/")
              ? `https://www.dailymotion.com/embed/video/${dbAnime.trailerUrl.split("/").pop()}`
              : null,
      },
      year: dbAnime.year,
      season: dbAnime.season,
      genres: Array.isArray(dbAnime.genres) ? dbAnime.genres : [],
      studios: Array.isArray(dbAnime.studios) ? dbAnime.studios : [],
      streaming: Array.isArray(dbAnime.streamingLinks)
        ? dbAnime.streamingLinks
        : [],
      relations: Array.isArray(dbAnime.relations) ? dbAnime.relations : [],
      staff: Array.isArray(dbAnime.staff) ? dbAnime.staff : [],
      recommendations: Array.isArray(dbAnime.recommendations)
        ? dbAnime.recommendations
        : [],
      characters: Array.isArray(dbAnime.characters) ? dbAnime.characters : [],
    };
  }

  private mapJikanToResponse(
    jikan: any,
    jikanCharacters: any[] = [],
    jikanRecommendations: any[] = [],
  ) {
    if (!jikan) return null;
    return {
      id: jikan.mal_id,
      anilistId: jikan.mal_id, // Fallback to MAL ID if AniList is down
      mal_id: jikan.mal_id,
      idMal: jikan.mal_id,
      title: jikan.title,
      title_english: jikan.title_english,
      title_japanese: jikan.title_japanese,
      synopsis: jikan.synopsis || "No synopsis available.",
      type: jikan.type,
      episodes: jikan.episodes,
      status: jikan.status,
      score: jikan.score,
      rank: jikan.rank,
      popularity: jikan.popularity,
      members: jikan.members,
      favorites: jikan.favorites,
      duration: jikan.duration,
      source: jikan.source,
      bannerImage: null, // Jikan doesn't provide banners
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
      trailer: {
        url: jikan.trailer?.url,
        youtube_id: jikan.trailer?.youtube_id,
        embed_url: jikan.trailer?.embed_url,
        thumbnail: jikan.trailer?.images?.maximum_image_url,
      },
      year: jikan.year,
      season: jikan.season,
      genres:
        jikan.genres?.map((g: any) => ({ name: g.name, mal_id: g.mal_id })) ||
        [],
      studios:
        jikan.studios?.map((s: any) => ({ name: s.name, mal_id: s.mal_id })) ||
        [],
      streaming: [],
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
      staff: [],
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
    };
  }
}
