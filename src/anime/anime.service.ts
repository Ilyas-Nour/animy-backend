import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { JikanService } from "../common/services/jikan.service";
import { SearchAnimeDto } from "./dto/search-anime.dto";

@Injectable()
export class AnimeService {
  private readonly logger = new Logger(AnimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jikanService: JikanService,
  ) { }

  async searchAnime(searchDto: SearchAnimeDto) {
    const {
      query,
      page = 1,
      limit = 25,
      type,
      status,
      rating,
      order_by,
      sort,
    } = searchDto;

    // Construct query string for cache key uniqueness
    const queryString = new URLSearchParams({
      q: query || "",
      page: page.toString(),
      limit: limit.toString(),
      ...(type && { type }),
      ...(status && { status }),
      ...(rating && { rating }),
      ...(order_by && { order_by }),
      ...(sort && { sort }),
      genres_exclude: "9", // Exclude Ecchi
    }).toString();

    // Returns full Jikan response with pagination
    const res = await this.jikanService.get<any>(`/anime?${queryString}`, 3600);

    // Manual filtering for search results
    if (res.data && Array.isArray(res.data)) {
      res.data = res.data.filter(
        (item: any) =>
          item.rating !== "Rx - Hentai" &&
          !item.genres?.some(
            (g: any) =>
              g.name === "Hentai" || g.name === "Erotica" || g.mal_id === 9,
          ),
      );
    }
    return res;
  }

  async getAnimeById(id: number) {
    try {
      // 1. Check Database (Stale-While-Revalidate logic)
      const cachedAnime = await this.prisma.anime.findUnique({ where: { id } });
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      // If exists and fresh, return DB data (Wrapped for consistency)
      // ALSO: Ensure we have critical data like images and synopsis.
      // Some old cache might be missing them.
      if (
        cachedAnime &&
        cachedAnime.lastUpdated > sevenDaysAgo &&
        cachedAnime.imageUrl &&
        cachedAnime.synopsis
      ) {
        // DB Filter Check
        const isRestricted =
          cachedAnime.rating === "Rx - Hentai" ||
          (Array.isArray(cachedAnime.genres) &&
            cachedAnime.genres.some(
              (g: any) =>
                g.name === "Hentai" || g.name === "Erotica" || g.mal_id === 9,
            ));

        if (isRestricted) {
          this.logger.debug(`DB HIT BUT RESTRICTED: Anime ${id}`);
          throw new HttpException(
            "Content not available",
            HttpStatus.NOT_FOUND,
          );
        }

        this.logger.debug(`DB HIT: Anime ${id}`);
        return this.mapDbToResponse(cachedAnime);
      }

      this.logger.debug(
        `DB STALE/MISS/INCOMPLETE: Anime ${id} -> Fetching Jikan`,
      );

      // 2. Fetch from Jikan
      const res = await this.jikanService.get<any>(`/anime/${id}/full`);
      const data = res.data; // Inner object

      if (data) {
        // SAFETY CHECK: Exclude Hentai (Rx) and Ecchi (9)
        if (
          data.rating === "Rx - Hentai" ||
          data.genres?.some(
            (g: any) =>
              g.name === "Hentai" || g.name === "Erotica" || g.mal_id === 9,
          )
        ) {
          throw new HttpException(
            "Content not available",
            HttpStatus.NOT_FOUND,
          );
        }

        // 3. Upsert to Database
        await this.saveAnimeToDb(data);
      }

      return data; // Return actual anime object { mal_id, title... }
    } catch (error) {
      this.logger.error(`Error fetching anime ${id}`, error);
      // Fallback to DB
      const cached = await this.prisma.anime.findUnique({ where: { id } });
      if (cached) return this.mapDbToResponse(cached);
      throw error;
    }
  }

  async getTopAnime(type?: string, filter?: string) {
    const params = new URLSearchParams();
    if (type) params.append("type", type);
    if (filter) params.append("filter", filter);
    // Note: Jikan /top endpoint might not support sfw param depending on version,
    // but we can filter the *response* just in case.
    const res = await this.jikanService.get<any>(
      `/top/anime?${params.toString()}`,
      86400,
    );

    // Filter out Rx content from the list
    if (res.data && Array.isArray(res.data)) {
      res.data = res.data.filter(
        (item: any) =>
          item.rating !== "Rx - Hentai" &&
          !item.genres?.some(
            (g: any) =>
              g.name === "Hentai" || g.name === "Erotica" || g.mal_id === 9,
          ),
      );
    }
    return res;
  }

  async getAnimeByType(type: string, page: number = 1) {
    const params = new URLSearchParams({
      type,
      page: page.toString(),
      limit: "25",
      order_by: "popularity",
      sort: "asc",
      sfw: "true", // Enforce SFW explicitly
      genres_exclude: "9", // Exclude Ecchi
      min_members: "10000", // Filter out obscure content (Higher threshold)
    });
    const res = await this.jikanService.get<any>(
      `/anime?${params.toString()}`,
      3600,
    );

    // Manual filtering for restricted content
    if (res.data && Array.isArray(res.data)) {
      res.data = res.data.filter(
        (item: any) =>
          item.rating !== "Rx - Hentai" &&
          !item.genres?.some(
            (g: any) =>
              g.name === "Hentai" || g.name === "Erotica" || g.mal_id === 9,
          ),
      );
    }
    return res;
  }

  async getAnimeCharacters(id: number) {
    const res = await this.jikanService.get<any>(
      `/anime/${id}/characters`,
      86400,
    );
    return res.data || [];
  }

  async getAnimeRecommendations(id: number) {
    return this.jikanService.get<any>(`/anime/${id}/recommendations`, 86400);
  }

  async getUpcomingSchedule() {
    // Fetch schedule for currently airing anime
    // This returns anime grouped by day or a general list
    const res = await this.jikanService.get<any>("/schedules?limit=10", 3600); // Cache for 1 hour
    return res;
  }

  // --- Helper Methods ---

  private async saveAnimeToDb(data: any) {
    try {
      await this.prisma.anime.upsert({
        where: { id: data.mal_id },
        update: this.mapJikanToPrisma(data),
        create: {
          id: data.mal_id,
          ...this.mapJikanToPrisma(data),
        },
      });
    } catch (e) {
      this.logger.error(`Failed to save anime ${data.mal_id} to DB`, e);
    }
  }

  private mapJikanToPrisma(data: any) {
    return {
      title: data.title,
      titleEnglish: data.title_english,
      titleJapanese: data.title_japanese,
      synopsis: data.synopsis,
      type: data.type,
      episodes: data.episodes,
      status: data.status,
      rating: data.rating,
      score: data.score,
      rank: data.rank,
      popularity: data.popularity,
      imageUrl:
        data.images?.jpg?.large_image_url || data.images?.jpg?.image_url,
      trailerUrl: data.trailer?.url,
      duration: data.duration,
      source: data.source,
      airing: data.airing,
      aired: data.aired || {},
      scoredBy: data.scored_by,
      members: data.members,
      favorites: data.favorites,
      background: data.background,
      year: data.year,
      season: data.season,
      genres: data.genres || [],
      studios: data.studios || [],
      streamingLinks: data.streaming || [],
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
    };
  }
}
