import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { AnilistService } from "../common/services/anilist.service";
import { SearchMangaDto } from "./dto/search-manga.dto";
import axios from "axios";

@Injectable()
export class MangaService {
  private readonly logger = new Logger(MangaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anilistService: AnilistService,
  ) { }

  async searchManga(searchDto: SearchMangaDto) {
    const {
      query,
      page = 1,
      limit = 25,
    } = searchDto;

    // Map Jikan order_by/sort to AniList sort
    let sortStr = 'POPULARITY_DESC';
    const sort = searchDto.sort || 'desc';
    const orderBy = searchDto.order_by || 'popularity';

    if (orderBy === 'popularity') sortStr = sort === 'desc' ? 'POPULARITY_DESC' : 'POPULARITY';
    else if (orderBy === 'score') sortStr = sort === 'desc' ? 'SCORE_DESC' : 'SCORE';
    else if (orderBy === 'title') sortStr = sort === 'desc' ? 'TITLE_ROMAJI_DESC' : 'TITLE_ROMAJI';
    else if (orderBy === 'start_date') sortStr = sort === 'desc' ? 'START_DATE_DESC' : 'START_DATE';

    const data = await this.anilistService.searchManga(query || "", Number(page), Number(limit), sortStr);

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
      data: data.media.map(this.mapAnilistToResponse)
    };
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

      if (data) {
        // 3. Upsert to Database
        await this.saveMangaToDb(data);
      }

      return this.mapAnilistToResponse(data);
    } catch (error) {
      this.logger.error(`Error fetching manga ${id}`, error);
      // Fallback to DB
      const cached = await this.prisma.manga.findUnique({ where: { id } });
      if (cached) return this.mapDbToResponse(cached);
      throw error;
    }
  }

  async getTopManga(type?: string, filter?: string, page: number = 1) {
    let data;
    // Simple logic: if popularity sort or no sort, get popular. Else trending.
    // AniList handles "Top" usually as Popular or Score.
    if (filter === 'bypopularity') {
      data = await this.anilistService.getPopularManga(page);
    } else {
      data = await this.anilistService.getTrendingManga(page);
    }

    return {
      data: data.map(this.mapAnilistToResponse)
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
            jpg: { image_url: char.image.large }
          }
        },
        role: "Main"
      }));
    } catch (e) {
      return [];
    }
  }

  async getMangaChapters(id: number) {
    try {
      this.logger.debug(`Fetching chapters for manga ${id}`);
      let title = "";
      
      const cachedManga = await this.prisma.manga.findUnique({ where: { id } });
      if (cachedManga && cachedManga.title) {
        title = cachedManga.title;
      } else {
        const anilistInfo = await this.anilistService.getMangaById(id);
        if (anilistInfo) title = anilistInfo.title.english || anilistInfo.title.romaji;
      }

      if (!title) {
        this.logger.warn(`Could not find title for manga ${id}`);
        return { chapters: [] };
      }

      // 1. Try meta/anilist-manga with mangadex first
      try {
        const { data } = await axios.get(`https://consumet-api-clone.vercel.app/meta/anilist-manga/${id}?provider=mangadex`);
        if (data.chapters && data.chapters.length > 0) {
          // Format chapter IDs for the read endpoint
          const chapters = data.chapters.map(c => ({ ...c, id: `anilist___${c.id}` }));
          return { chapters };
        }
      } catch (e) {
        this.logger.debug(`meta/anilist-manga failed for ${id}, falling back...`);
      }

      // 2. Try direct provider search fallback
      const providers = ['mangapill', 'mangadex'];
      
      for (const provider of providers) {
        try {
          this.logger.debug(`Searching ${provider} for: ${title}`);
          const searchRes = await axios.get(`https://consumet-api-clone.vercel.app/manga/${provider}/${encodeURIComponent(title)}`);
          
          if (searchRes.data?.results?.length > 0) {
            const providerId = searchRes.data.results[0].id;
            
            // Note: consumet-api endpoints vary slighty (info?id= vs info/id)
            const infoUrl = `https://consumet-api-clone.vercel.app/manga/${provider}/info?id=${encodeURIComponent(providerId)}`;
            const infoRes = await axios.get(infoUrl);
            
            if (infoRes.data?.chapters && infoRes.data.chapters.length > 0) {
              const chapters = infoRes.data.chapters.map(c => ({
                ...c,
                id: `${provider}___${c.id}`
              }));
              this.logger.debug(`Found ${chapters.length} chapters on ${provider}`);
              return { chapters };
            }
          }
        } catch (e) {
          this.logger.debug(`${provider} fallback failed: ${e.message}`);
        }
      }

      return { chapters: [] };
    } catch (e) {
      this.logger.error(`Failed to fetch chapters for manga ${id}: ${e.message}`);
      return { chapters: [] };
    }
  }

  async getChapterPages(chapterId: string) {
    try {
      this.logger.debug(`Fetching high-quality pages for chapter ${chapterId}`);
      
      let url = "";
      const parts = chapterId.split('___');
      
      if (parts.length === 2) {
        const provider = parts[0];
        const actualId = parts[1];
        
        if (provider === 'anilist') {
          url = `https://consumet-api-clone.vercel.app/meta/anilist-manga/read?chapterId=${encodeURIComponent(actualId)}&provider=mangadex`;
        } else {
          url = `https://consumet-api-clone.vercel.app/manga/${provider}/read?chapterId=${encodeURIComponent(actualId)}`;
        }
      } else {
        // Fallback for old cached/saved formats
        url = `https://consumet-api-clone.vercel.app/meta/anilist-manga/read?chapterId=${encodeURIComponent(chapterId)}&provider=mangadex`;
      }
      
      const { data } = await axios.get(url);
      return { pages: data };
    } catch (e) {
      this.logger.error(`Failed to fetch pages for chapter ${chapterId}: ${e.message}`);
      throw new HttpException('Failed to fetch chapter pages from provider', HttpStatus.BAD_GATEWAY);
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
      title: data.title.romaji || data.title.english || data.title.native,
      titleEnglish: data.title.english,
      titleJapanese: data.title.native,
      synopsis: data.description ? data.description.replace(/<[^>]*>?/gm, '') : '',
      type: data.format,
      chapters: data.chapters,
      volumes: data.volumes,
      status: data.status,
      score: data.averageScore ? data.averageScore / 10 : null,
      rank: null,
      popularity: data.popularity,
      imageUrl: data.coverImage.extraLarge || data.coverImage.large,
      authors: data.staff?.nodes?.map((s: any) => ({ name: s.name.full })) || [],
      genres: data.genres?.map((g: string) => ({ name: g })) || [],
      background: null,
      published: {
        from: data.startDate?.year ? `${data.startDate.year}` : null
      },
      scoredBy: null,
      members: data.popularity,
      favorites: null,
    };
  }

  private mapAnilistToResponse(data: any) {
    if (!data) return null;
    return {
      mal_id: data.id,
      title: data.title.romaji || data.title.english || data.title.native,
      title_english: data.title.english,
      title_japanese: data.title.native,
      synopsis: data.description ? data.description.replace(/<[^>]*>?/gm, '') : '',
      type: data.format,
      chapters: data.chapters,
      volumes: data.volumes,
      status: data.status,
      score: data.averageScore ? data.averageScore / 10 : null,
      rank: null,
      popularity: data.popularity,
      background: null,
      published: {
        from: data.startDate?.year
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
      authors: data.staff?.nodes?.map((s: any) => ({ name: s.name.full })) || [],
      genres: data.genres?.map((g: string) => ({ name: g, mal_id: 0 })) || [],
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
