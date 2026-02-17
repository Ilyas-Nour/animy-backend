import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { AnilistService } from "../common/services/anilist.service";
import { SearchAnimeDto } from "./dto/search-anime.dto";

@Injectable()
export class AnimeService {
  private readonly logger = new Logger(AnimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anilistService: AnilistService,
  ) { }

  async searchAnime(searchDto: SearchAnimeDto) {
    const {
      query,
      page = 1,
      limit = 25,
      type,
      order_by,
      sort,
    } = searchDto;

    // Map Jikan 'type' to AniList 'format'
    let format = null;
    if (type) {
      format = type.toUpperCase();
      if (format === 'SPECIAL') format = 'SPECIAL'; // Verify AniList enum if needed, usually same
    }

    // Map Jikan 'order_by' to AniList 'sort'
    let anilistSort = 'POPULARITY_DESC';
    if (order_by === 'score') anilistSort = 'SCORE_DESC';
    else if (order_by === 'title') anilistSort = 'TITLE_ENGLISH';
    else if (order_by === 'start_date') anilistSort = 'START_DATE_DESC';
    else if (order_by === 'favorites') anilistSort = 'FAVOURITES_DESC';
    else if (order_by === 'rank') anilistSort = 'SCORE_DESC';

    // Handle specific sort direction if needed (simplified for now)
    if (sort === 'asc' && order_by === 'popularity') anilistSort = 'POPULARITY';

    // AniList equivalent search
    // Pass undefined for query if empty to allow pure filtering
    const data = await this.anilistService.searchAnime(query || undefined, Number(page), Number(limit), format, anilistSort);

    // Map to Jikan-like response structure for frontend compatibility
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
      data: data.media.map(this.mapAnilistToResponse),
    };
  }

  async getAnimeById(id: number) {
    try {
      // 1. Check Database (Stale-While-Revalidate logic)
      const cachedAnime = await this.prisma.anime.findUnique({ where: { id } });
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      if (
        cachedAnime &&
        cachedAnime.lastUpdated > sevenDaysAgo &&
        cachedAnime.imageUrl &&
        cachedAnime.synopsis
      ) {
        // DB Filter Check (Simple check for Hentai if genres stored)
        const isRestricted = Array.isArray(cachedAnime.genres) &&
          cachedAnime.genres.some((g: any) => g.name === "Hentai" || g === "Hentai");

        if (isRestricted) {
          throw new HttpException("Content not available", HttpStatus.NOT_FOUND);
        }

        this.logger.debug(`DB HIT: Anime ${id}`);
        return this.mapDbToResponse(cachedAnime);
      }

      this.logger.debug(`DB STALE/MISS: Anime ${id} -> Fetching AniList`);

      // 2. Fetch from AniList
      const data = await this.anilistService.getAnimeById(id);

      if (data) {
        // Opsional: Check for adult content (AniList usually filters if isAdult: false in query, 
        // but by ID we might get it if we don't request isAdult in getAnimeById - wait, getAnimeById GQL usually returns it)
        // For safety, we can check genres or isAdult field if added to query.

        // 3. Upsert to Database
        await this.saveAnimeToDb(data);
      }

      return this.mapAnilistToResponse(data);
    } catch (error) {
      this.logger.error(`Error fetching anime ${id}`, error);
      // Fallback to DB
      const cached = await this.prisma.anime.findUnique({ where: { id } });
      if (cached) return this.mapDbToResponse(cached);
      throw error;
    }
  }

  async getTopAnime(type?: string, filter?: string) {
    // Map Jikan 'filter' to AniList equivalent
    let data;
    if (filter === "bypopularity") {
      data = await this.anilistService.getPopular();
    } else {
      data = await this.anilistService.getTrending();
    }

    return {
      data: data.map(this.mapAnilistToResponse)
    };
  }

  async getAnimeByType(type: string, page: number = 1) {
    const data = await this.anilistService.getPopular(page);
    return {
      data: data.map(this.mapAnilistToResponse)
    };
  }

  async getUpcomingNextSeason(page: number = 1) {
    const data = await this.anilistService.getNextSeason(page);
    return {
      data: data.map(this.mapAnilistToResponse)
    };
  }

  async getAnimeCharacters(id: number) {
    try {
      const data = await this.anilistService.getAnimeById(id);
      return data.characters?.edges || [];
    } catch (e) {
      return [];
    }
  }

  async getAnimeRecommendations(id: number) {
    try {
      const data = await this.anilistService.getAnimeById(id);
      return {
        data: data.recommendations?.nodes || []
      };
    } catch (e) {
      return { data: [] };
    }
  }

  async getUpcomingSchedule() {
    // Current season/year approximation
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    let season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL' = 'WINTER';

    if (month >= 0 && month <= 2) season = 'WINTER';
    else if (month >= 3 && month <= 5) season = 'SPRING';
    else if (month >= 6 && month <= 8) season = 'SUMMER';
    else season = 'FALL';

    const data = await this.anilistService.getThisSeason(season, year);
    return {
      data: data.map(this.mapAnilistToResponse)
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
      title: data.title.romaji || data.title.english || data.title.native,
      titleEnglish: data.title.english,
      titleJapanese: data.title.native,
      synopsis: data.description ? data.description.replace(/<[^>]*>?/gm, '') : '', // Strip HTML
      type: data.format,
      episodes: data.episodes,
      status: data.status,
      rating: "PG-13", // Default/Placeholder as AniList doesn't give simple rating string like MAL
      score: data.averageScore ? data.averageScore / 10 : null,
      rank: null,
      popularity: data.popularity,
      imageUrl: data.coverImage.extraLarge || data.coverImage.large,
      trailerUrl: data.trailer ? `https://www.youtube.com/watch?v=${data.trailer.id}` : null,
      duration: data.duration ? `${data.duration} min` : null,
      source: data.source,
      airing: data.status === 'RELEASING',
      aired: {
        // Simplified aired object
        from: data.startDate ? `${data.startDate.year}-${data.startDate.month}-${data.startDate.day}` : null
      },
      scoredBy: null,
      members: data.popularity, // Use popularity as members count proxy
      favorites: null,
      background: null,
      year: data.seasonYear,
      season: data.season,
      genres: data.genres?.map((g: string) => ({ name: g })) || [], // Map to object structure if DB expects JSON
      studios: data.studios?.nodes?.map((s: any) => ({ name: s.name })) || [],
      streamingLinks: [],
    };
  }

  private mapAnilistToResponse(data: any) {
    if (!data) return null;
    return {
      mal_id: data.id, // Use AniList ID as mal_id for frontend compatibility
      title: data.title.romaji || data.title.english || data.title.native,
      title_english: data.title.english,
      title_japanese: data.title.native,
      synopsis: data.description ? data.description : 'No synopsis available.',
      type: data.format,
      episodes: data.episodes,
      status: data.status,
      score: data.averageScore ? data.averageScore / 10 : null,
      popularity: data.popularity,
      duration: data.duration ? `${data.duration} min` : null,
      source: data.source,
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
        }
      },
      trailer: {
        url: data.trailer ? `https://www.youtube.com/watch?v=${data.trailer.id}` : null,
        youtube_id: data.trailer?.id
      },
      year: data.seasonYear,
      season: data.season,
      genres: data.genres?.map((g: string) => ({ name: g, mal_id: 0 })) || [],
      studios: data.studios?.nodes?.map((s: any) => ({ name: s.name, mal_id: 0 })) || [],
      streaming: data.externalLinks?.map((link: any) => ({
        name: link.site,
        url: link.url
      })) || [],
      relations: data.relations?.edges?.map((edge: any) => ({
        relationType: edge.relationType,
        node: edge.node
      })) || [],
      staff: data.staff?.edges?.map((edge: any) => ({
        role: edge.role,
        node: edge.node
      })) || [],
      recommendations: data.recommendations?.nodes || [],
      characters: data.characters?.edges || []
    };
  }

  private mapDbToResponse(dbAnime: any) {
    return {
      mal_id: dbAnime.id,
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
        youtube_id: dbAnime.trailerUrl?.split("v=")[1],
      },
      year: dbAnime.year,
      season: dbAnime.season,
      genres: Array.isArray(dbAnime.genres) ? dbAnime.genres : [],
      studios: Array.isArray(dbAnime.studios) ? dbAnime.studios : [],
      streaming: Array.isArray(dbAnime.streamingLinks)
        ? dbAnime.streamingLinks
        : [],
      relations: [], // DB doesn't store these yet, will be fetched in separate call or refresh
      staff: [],
      recommendations: [],
      characters: []
    };
  }
}
