import { Injectable, Logger, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { PrismaService } from "../database/prisma.service";
import { AnilistService } from "../common/services/anilist.service";
import { JikanService } from "../common/services/jikan.service";
import { SearchAnimeDto } from "./dto/search-anime.dto";

@Injectable()
export class AnimeService {
  private readonly logger = new Logger(AnimeService.name);

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
      this.logger.warn(`AniList Search Failed, falling back to Jikan: ${e.message}`);
      // Actual search fallback to Jikan
      const jikanResults = await this.jikanService.searchAnime(query || "", Number(page), Number(limit), type);
      const response = {
        pagination: { last_visible_page: 1, has_next_page: jikanResults.length === limit, current_page: Number(page), items: { count: jikanResults.length, total: jikanResults.length, per_page: Number(limit) } },
        data: jikanResults.map(r => this.mapJikanToResponse(r))
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
        cachedAnime.lastUpdated > sevenDaysAgo &&
        cachedAnime.imageUrl &&
        cachedAnime.synopsis &&
        cachedAnime.idMal && 
        cachedAnime.characters && 
        (cachedAnime.characters as any[]).length > 0
      ) {
        this.logger.debug(`DB HIT (DEEP): Anime ${id}`);
        const resp = this.mapDbToResponse(cachedAnime);
        await this.cacheManager.set(cacheKey, resp, 3600000); // 1 hour
        return resp;
      }

      this.logger.debug(`DB STALE/MISS: Anime ${id} -> Fetching AniList`);
      const data = await this.anilistService.getAnimeById(id);

      if (data) {
        await this.saveAnimeToDb(data);
      }

      const resp = this.mapAnilistToResponse(data);
      await this.cacheManager.set(cacheKey, resp, 3600000); // 1 hour
      return resp;
    } catch (error) {
      this.logger.error(`Error fetching anime ${id}`, error.message);
      
      // Fallback to DB if possible
      const cached = await this.prisma.anime.findUnique({ where: { id } });
      if (cached) return this.mapDbToResponse(cached);

      // Fallback to Jikan if we have MAL ID or if we can search
      this.logger.warn(`AniList Failed for ${id}, trying Jikan fallback`);
      const mapping = await this.prisma.animeMapping.findUnique({ where: { id } });
      if (mapping?.idMal) {
        const jikanData = await this.jikanService.getAnimeById(mapping.idMal);
        if (jikanData) return this.mapJikanToResponse(jikanData);
      }

      throw error;
    }
  }

  async getTopAnime(type?: string, filter?: string) {
    const cacheKey = `top:${filter}:${type}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    try {
      const data = await Promise.race([
        (async () => {
          if (filter === "bypopularity") {
            return await this.anilistService.getPopular();
          } else {
            return await this.anilistService.getTrending();
          }
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Gateway Safety Timeout')), 15000))
      ]);
      
      const resp = {
        data: (data.media || []).map((m: any) => this.mapAnilistToResponse(m)).filter(a => a !== null),
        pageInfo: data.pageInfo
      };
      await this.cacheManager.set(cacheKey, resp, 3600000); // 1 hour
      return resp;
    } catch (e) {
      this.logger.warn(`AniList Top Anime failed, falling back to Jikan: ${e.message}`);
      const data = await this.jikanService.getTopAnime();
      return {
        data: (data || []).map(r => this.mapJikanToResponse(r))
      };
    }
  }

  async getAnimeByType(type: string, page: number = 1) {
    try {
      const data = await this.anilistService.getPopular(page);
      return {
        data: (data.media || []).map((item) => this.mapAnilistToResponse(item)).filter(a => a !== null),
        pageInfo: data.pageInfo
      };
    } catch (e) {
      const data = await this.jikanService.getTopAnime();
      return { data: data.map(r => this.mapJikanToResponse(r)) };
    }
  }

  async getUpcomingNextSeason(page: number = 1) {
    try {
      const data = await this.anilistService.getNextSeason(page);
      return {
        data: (data.media || []).map((item) => this.mapAnilistToResponse(item)).filter(a => a !== null),
        pageInfo: data.pageInfo
      };
    } catch (e) {
      this.logger.warn(`AniList Upcoming failed, falling back to Jikan: ${e.message}`);
      const data = await this.jikanService.getUpcoming();
      return { data: data.map(r => this.mapJikanToResponse(r)) };
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
      this.logger.warn(`AniList Characters failed for ${id}, trying Jikan fallback`);
      const mapping = await this.prisma.animeMapping.findUnique({ where: { id } });
      if (mapping?.idMal) {
        const jikanChars = await this.jikanService.getAnimeCharacters(mapping.idMal);
        return { data: jikanChars.map(c => ({ role: c.role, node: { id: c.character.mal_id, name: { full: c.character.name }, image: { large: c.character.images?.jpg?.image_url } } })) };
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
      this.logger.warn(`AniList Recommendations failed for ${id}, trying Jikan fallback`);
      const mapping = await this.prisma.animeMapping.findUnique({ where: { id } });
      if (mapping?.idMal) {
        const jikanRecs = await this.jikanService.getAnimeRecommendations(mapping.idMal);
        return { data: jikanRecs.map(r => ({ mediaRecommendation: { id: r.entry.mal_id, title: { romaji: r.entry.title }, coverImage: { large: r.entry.images?.jpg?.image_url } } })) };
      }
      return { data: [] };
    }
  }

  async getUpcomingSchedule() {
    // Current season/year approximation
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    let season: "WINTER" | "SPRING" | "SUMMER" | "FALL" = "WINTER";

    if (month >= 0 && month <= 2) season = "WINTER";
    else if (month >= 3 && month <= 5) season = "SPRING";
    else if (month >= 6 && month <= 8) season = "SUMMER";
    else season = "FALL";

    const data = await this.anilistService.getThisSeason(season, year);
    return {
      data: data.map((item) => this.mapAnilistToResponse(item)),
    };
  }

  // --- Helper Methods ---

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
      rank: data.rankings?.find((r: any) => r.allTime)?.rank || data.rankings?.[0]?.rank,
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
      title: data.title.romaji || data.title.english || data.title.native,
      title_english: data.title.english,
      title_japanese: data.title.native,
      synopsis: data.description ? data.description : "No synopsis available.",
      type: data.format,
      episodes: data.episodes,
      status: data.status,
      score: data.averageScore ? data.averageScore / 10 : null,
      rank: data.rankings?.find((r: any) => r.allTime)?.rank || data.rankings?.[0]?.rank,
      popularity: data.popularity,
      members: data.popularity,
      favorites: data.favourites,
      duration: data.duration ? `${data.duration} min` : null,
      source: data.source,
      bannerImage: data.bannerImage,
      color: data.coverImage?.color,
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
        url: data.trailer?.site === "youtube"
          ? `https://www.youtube.com/watch?v=${data.trailer.id}`
          : data.trailer?.site === "dailymotion"
            ? `https://www.dailymotion.com/video/${data.trailer.id}`
            : data.trailer?.id ? `https://www.youtube.com/watch?v=${data.trailer.id}` : null,
        youtube_id: data.trailer?.site === "youtube" ? data.trailer.id : null,
        embed_url: data.trailer?.site === "youtube"
          ? `https://www.youtube.com/embed/${data.trailer.id}`
          : data.trailer?.site === "dailymotion"
            ? `https://www.dailymotion.com/embed/video/${data.trailer.id}`
            : data.trailer?.id ? `https://www.youtube.com/embed/${data.trailer.id}` : null,
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
    return {
      id: dbAnime.id,
      mal_id: dbAnime.idMal || dbAnime.id,
      anilistId: dbAnime.id,
      idMal: dbAnime.idMal || dbAnime.id,
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
      aired: dbAnime.aired,
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

  private mapJikanToResponse(jikan: any) {
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
      genres: jikan.genres?.map((g: any) => ({ name: g.name, mal_id: g.mal_id })) || [],
      studios: jikan.studios?.map((s: any) => ({ name: s.name, mal_id: s.mal_id })) || [],
      streaming: [],
      relations: [],
      staff: [],
      recommendations: [],
      characters: [],
    };
  }
}
