import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { JikanService } from "../common/services/jikan.service";
import { SearchMangaDto } from "./dto/search-manga.dto";

@Injectable()
export class MangaService {
  private readonly logger = new Logger(MangaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jikanService: JikanService,
  ) {}

  async searchManga(searchDto: SearchMangaDto) {
    const {
      query,
      page = 1,
      limit = 25,
      type,
      status,
      score,
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
      ...(score && { score }),
      ...(order_by && { order_by }),
      ...(sort && { sort }),
      genres_exclude: "9,49", // Exclude Ecchi (9) and Hentai/Erotica (49)
    }).toString();

    // Cache search results for 1 hour
    // Add SFW filter to search params if not already there
    if (!queryString.includes("sfw")) {
      searchDto.sfw = true; // Assuming DTO handles it, or we append to query string
    }
    // Actually, just append &sfw=true to the URL if strict
    const res = await this.jikanService.get<any>(
      `/manga?${queryString}&sfw=true`,
      3600,
    );

    // Manual filtering for search results
    if (res.data && Array.isArray(res.data)) {
      res.data = res.data.filter(
        (item: any) =>
          !item.genres?.some(
            (g: any) =>
              g.name === "Hentai" ||
              g.name === "Erotica" ||
              g.mal_id === 9 ||
              g.mal_id === 49,
          ),
      );
    }
    return res;
  }

  async getMangaById(id: number) {
    try {
      // 1. Check Database (Stale-While-Revalidate logic)
      const cachedManga = await this.prisma.manga.findUnique({ where: { id } });
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // If exists and fresh, return DB data (Wrapped)
      // Ensure we have critical data like images and synopsis.
      if (
        cachedManga &&
        cachedManga.lastUpdated > sevenDaysAgo &&
        cachedManga.imageUrl &&
        cachedManga.synopsis
      ) {
        this.logger.debug(`DB HIT: Manga ${id}`);
        return this.mapDbToResponse(cachedManga);
      }

      this.logger.debug(
        `DB STALE/MISS/INCOMPLETE: Manga ${id} -> Fetching Jikan`,
      );

      // 2. Fetch from Jikan (Rate Limited & Redis Cached)
      const res = await this.jikanService.get<any>(`/manga/${id}/full`);
      const data = res.data;

      if (data) {
        // SAFETY CHECK: Exclude Hentai and Ecchi
        if (
          data.genres?.some(
            (g: any) =>
              g.name === "Hentai" ||
              g.name === "Erotica" ||
              g.mal_id === 9 ||
              g.mal_id === 49,
          )
        ) {
          throw new HttpException(
            "Content not available",
            HttpStatus.NOT_FOUND,
          );
        }

        // 3. Upsert to Database
        await this.saveMangaToDb(data);
      }

      return data; // Returning actual manga object
    } catch (error) {
      this.logger.error(`Error fetching manga ${id}`, error);
      // Fallback to DB if Jikan fails or rate limit
      const cached = await this.prisma.manga.findUnique({ where: { id } });
      if (cached) return this.mapDbToResponse(cached);
      throw error;
    }
  }

  async getTopManga(type?: string, filter?: string, page: number = 1) {
    const params = new URLSearchParams();
    if (type) params.append("type", type);
    if (filter) params.append("filter", filter);
    params.append("page", page.toString());

    const res = await this.jikanService.get<any>(
      `/top/manga?${params.toString()}`,
      86400,
    ); // 24h cache

    // Filter out Hentai
    if (res.data && Array.isArray(res.data)) {
      res.data = res.data.filter(
        (item: any) =>
          !item.genres?.some(
            (g: any) =>
              g.name === "Hentai" ||
              g.name === "Erotica" ||
              g.mal_id === 9 ||
              g.mal_id === 49,
          ),
      );
    }
    return res;
  }

  async getMangaCharacters(id: number) {
    const res = await this.jikanService.get<any>(
      `/manga/${id}/characters`,
      86400,
    );
    return res.data || [];
  }

  // --- Helper Methods ---

  private async saveMangaToDb(data: any) {
    try {
      await this.prisma.manga.upsert({
        where: { id: data.mal_id },
        update: this.mapJikanToPrisma(data),
        create: {
          id: data.mal_id,
          ...this.mapJikanToPrisma(data),
        },
      });
    } catch (e) {
      this.logger.error(`Failed to save manga ${data.mal_id} to DB`, e);
    }
  }

  private mapJikanToPrisma(data: any) {
    return {
      title: data.title,
      titleEnglish: data.title_english,
      titleJapanese: data.title_japanese,
      synopsis: data.synopsis,
      type: data.type,
      chapters: data.chapters,
      volumes: data.volumes,
      status: data.status,
      score: data.score,
      rank: data.rank,
      popularity: data.popularity,
      imageUrl:
        data.images?.jpg?.large_image_url || data.images?.jpg?.image_url,
      authors: data.authors || [],
      genres: data.genres || [],
      background: data.background,
      published: data.published || {},
      scoredBy: data.scored_by,
      members: data.members,
      favorites: data.favorites,
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
    };
  }
}
