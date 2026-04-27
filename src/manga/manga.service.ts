import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { AnilistService } from "../common/services/anilist.service";
import { IdMappingService } from "../streaming/id-mapping.service";
import { StreamingProxyService } from "../streaming/streaming.proxy.service";
import { SearchMangaDto } from "./dto/search-manga.dto";
import { Response } from "express";
import axios from "axios";

@Injectable()
export class MangaService {
  private readonly logger = new Logger(MangaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anilistService: AnilistService,
    private readonly idMappingService: IdMappingService,
    private readonly streamingProxyService: StreamingProxyService,
  ) {}

  async searchManga(searchDto: SearchMangaDto) {
    const { query, page = 1, limit = 25 } = searchDto;

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

    const data = await this.anilistService.searchManga(
      query || "",
      Number(page),
      Number(limit),
      sortStr,
    );

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
    if (filter === "bypopularity") {
      data = await this.anilistService.getPopularManga(page);
    } else {
      data = await this.anilistService.getTrendingManga(page);
    }

    return {
      data: data.map(this.mapAnilistToResponse),
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
      
      // 1. Check DB Cache first
      const cachedManga = await this.prisma.manga.findUnique({ where: { id } });
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      if (cachedManga?.chaptersList && Array.isArray(cachedManga.chaptersList) && cachedManga.chaptersList.length > 0) {
        if (cachedManga.lastUpdated > oneDayAgo) {
          this.logger.debug(`CHAPTER CACHE HIT: Manga ${id}`);
          return { chapters: cachedManga.chaptersList };
        }
        this.logger.debug(`CHAPTER CACHE STALE: Manga ${id} -> Fetching fresh in parallel`);
      }

      let title = cachedManga?.title || "";
      let englishTitle = cachedManga?.titleEnglish || "";
      let nativeTitle = cachedManga?.titleJapanese || "";

      if (!title) {
        try {
          const anilistInfo = await this.anilistService.getMangaById(id);
          if (anilistInfo) {
            title = anilistInfo.title.english || anilistInfo.title.romaji || anilistInfo.title.native;
            englishTitle = anilistInfo.title.english || "";
            nativeTitle = anilistInfo.title.native || "";
          }
        } catch (e) {}
      }

      if (!title) return { chapters: [] };

      const titlesToSearch = [title, englishTitle, nativeTitle].filter(t => t && t.length > 1);

      // --- FAST RACE STRATEGY ---
      this.logger.debug(`Triggering fast race chapter search for: ${title}`);
      
      const chapters = await Promise.any([
        this.fetchAnifyChapters(id, title).then(res => {
          if (res.length > 0) return res;
          throw new Error('No chapters');
        }),
        this.fetchMangaDexChapters(id, titlesToSearch).then(res => {
          if (res.length > 0) return res;
          throw new Error('No chapters');
        }),
        this.fetchConsumetChapters(id, titlesToSearch).then(res => {
          if (res.length > 0) return res;
          throw new Error('No chapters');
        }),
        // Global safety timeout to return cache if it exists, or empty
        new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 12000))
      ]).catch(() => {
        return cachedManga?.chaptersList || [];
      });

      if (chapters && Array.isArray(chapters) && chapters.length > 0) {
        const sortedChapters = (chapters as any[]).sort((a, b) => Number(b.chapterNumber) - Number(a.chapterNumber));
        
        // Background update DB cache if it changed or was empty
        const cachedList = (cachedManga?.chaptersList as any[]) || [];
        if (!cachedManga?.chaptersList || cachedList.length !== sortedChapters.length) {
            this.prisma.manga.update({ 
              where: { id }, 
              data: { chaptersList: sortedChapters as any, lastUpdated: new Date() } 
            }).catch(e => this.logger.error(`Failed to update chapter cache: ${e.message}`));
        }

        return { chapters: sortedChapters };
      }

      this.logger.warn(`All parallel providers failed for manga ${id}`);
      return { chapters: [] };
    } catch (e) {
      this.logger.error(`Failed to fetch chapters for manga ${id}: ${e.message}`);
      return { chapters: [] };
    }
  }

  // --- PRIVATE PROVIDER HELPERS ---

  private async fetchAnifyChapters(id: number, title: string): Promise<any[]> {
    try {
      this.logger.debug(`[Parallel] Trying Anify for: ${title}`);
      const res = await axios.get(`https://api.anify.tv/info/${id}`, { timeout: 8000 });
      if (res.data?.chapters?.data) {
        return res.data.chapters.data
          .filter((c: any) => c.providerId === 'mangadex' || c.providerId === 'readdetective' || c.providerId === 'mangapill')
          .map((c: any) => ({
            id: `anify___${Buffer.from(c.id).toString("base64url")}___${Buffer.from(c.providerId).toString("base64url")}`,
            title: c.title || `Chapter ${c.number}`,
            chapterNumber: c.number.toString(),
            volumeNumber: c.volume?.toString() || "0",
          }));
      }
    } catch (e) {
      this.logger.debug(`Anify parallel fetch failed: ${e.message}`);
    }
    return [];
  }

  private async fetchMangaDexChapters(id: number, titles: string[]): Promise<any[]> {
    try {
      this.logger.debug(`[Parallel] Trying MangaDex for: ${titles[0]}`);
      
      // Try mapping service first
      let mangaDexId = null;
      for (const t of titles) {
        mangaDexId = await this.idMappingService.resolveMangaDexId(id, t);
        if (mangaDexId) break;
      }

      if (!mangaDexId) {
        // Direct API search fallback - try all titles
        for (const t of titles) {
          try {
            this.logger.debug(`[Parallel] Trying MangaDex Search for: ${t}`);
            const searchRes = await axios.get(
              `https://api.mangadex.org/manga?title=${encodeURIComponent(t)}&limit=1`,
              { timeout: 5000 }
            );
            if (searchRes.data.data?.[0]) {
              mangaDexId = searchRes.data.data[0].id;
              this.logger.debug(`[Parallel] Found MangaDex ID via search: ${mangaDexId}`);
              break;
            }
          } catch (e) {
             this.logger.debug(`MangaDex search failed for title ${t}: ${e.message}`);
          }
        }
      }

      if (mangaDexId) {
        const chaptersRes = await axios.get(
          `https://api.mangadex.org/manga/${mangaDexId}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=500`,
          { timeout: 8000, headers: { 'User-Agent': 'Animy/1.0.0' } }
        );

        if (chaptersRes.data.data) {
          return chaptersRes.data.data.map((ch: any) => ({
            id: `mangadex_direct___${ch.id}___na`,
            title: ch.attributes.title || `Chapter ${ch.attributes.chapter}`,
            chapterNumber: ch.attributes.chapter,
            volumeNumber: ch.attributes.volume,
          }));
        }
      }
    } catch (e) {
      this.logger.debug(`MangaDex parallel fetch failed: ${e.message}`);
    }
    return [];
  }

  private async fetchConsumetChapters(id: number, titles: string[]): Promise<any[]> {
    const apiBaseUrls = ["https://consumet-api-clone.vercel.app", "https://api.consumet.org"];
    
    // 1. Try Anilist Meta first
    for (const baseUrl of apiBaseUrls) {
      try {
        const { data } = await axios.get(`${baseUrl}/meta/anilist-manga/${id}?provider=mangadex`, { timeout: 6000 });
        if (data.chapters?.length > 0) {
          return data.chapters.map((c) => ({
            ...c,
            id: `anilist___${Buffer.from(c.id).toString("base64url")}___${Buffer.from(baseUrl).toString("base64url")}`,
          }));
        }
      } catch (e) {}
    }

    // 2. Try Scraper Search if Meta fails
    const providers = ["mangasee123", "mangadex", "mangapill"];
    for (const provider of providers) {
      for (const baseUrl of apiBaseUrls) {
        try {
          const searchRes = await axios.get(`${baseUrl}/manga/${provider}/${encodeURIComponent(titles[0])}`, { timeout: 8000 });
          if (searchRes.data?.results?.length > 0) {
            const providerId = searchRes.data.results[0].id;
            const infoRes = await axios.get(`${baseUrl}/manga/${provider}/info?id=${providerId}`, { timeout: 8000 });
            if (infoRes.data?.chapters?.length > 0) {
              return infoRes.data.chapters.map((c) => ({
                ...c,
                id: `${provider}___${Buffer.from(c.id).toString("base64url")}___${Buffer.from(baseUrl).toString("base64url")}`,
              }));
            }
          }
        } catch (e) {}
      }
    }
    return [];
  }


  async proxyImage(url: string, referer: string, res: Response) {
    return this.streamingProxyService.proxy(url, referer, res);
  }

  async getChapterPages(chapterId: string, proxyBaseUrl?: string) {
    try {
      this.logger.debug(`Fetching high-quality pages for chapter ${chapterId}`);

      // Centralized proxy wrapper logic
      const wrapInProxy = (originalUrl: string) => {
        if (!proxyBaseUrl || !originalUrl) return originalUrl;
        
        let referer = "";
        const lowerUrl = originalUrl.toLowerCase();
        const lowerId = chapterId.toLowerCase();
        
        // Identify provider by URL or by ID prefix
        if (lowerUrl.includes("mangapill.com") || lowerUrl.includes("readdetectiveconan.com") || lowerId.startsWith("mangapill")) {
          referer = "https://mangapill.com/";
        } else if (lowerUrl.includes("mangasee") || lowerId.startsWith("mangasee")) {
          referer = "https://mangasee123.com/";
        } else if (lowerUrl.includes("mangafire") || lowerId.startsWith("mangafire")) {
          referer = "https://mangafire.to/";
        } else if (lowerId.includes("mangadex") || lowerUrl.includes("mangadex")) {
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
      let parts = chapterId.split("___");
      if (parts.length < 2) {
        parts = chapterId.split("__");
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
            : parts[2] ? Buffer.from(parts[2], "base64url").toString("utf-8") : "https://consumet-api-clone.vercel.app";

        if (provider === "anify") {
          const pagesRes = await axios.get(
            `https://api.anify.tv/pages?id=${actualId}&providerId=${baseUrl}&readId=${actualId}&episodeNumber=0&type=manga`,
            { timeout: 10000 }
          );
          
          if (pagesRes.data) {
            const pages = Array.isArray(pagesRes.data) ? pagesRes.data : pagesRes.data.pages || [];
            return {
              pages: pages.map((p: any, index: number) => ({
                img: wrapInProxy(p.url || p.img || p),
                page: index + 1
              }))
            };
          }
        }

        if (provider === "mangadex_direct") {
          const atHomeRes = await axios.get(`https://api.mangadex.org/at-home/server/${actualId}`);
          const host = atHomeRes.data.baseUrl;
          const hash = atHomeRes.data.chapter.hash;
          const files = atHomeRes.data.chapter.data;
          return {
            pages: files.map((f: string, i: number) => ({
              img: wrapInProxy(`${host}/data/${hash}/${f}`),
              page: i + 1,
            })),
          };
        }

        if (provider === "anilist") {
          url = `${baseUrl}/meta/anilist-manga/read?chapterId=${actualId}&provider=mangadex`;
        } else {
          url = `${baseUrl}/manga/${provider}/read?chapterId=${actualId}`;
        }
      } else {
        url = `https://consumet-api-clone.vercel.app/meta/anilist-manga/read?chapterId=${chapterId}&provider=mangadex`;
      }

      const { data } = await axios.get(url);
      const rawPages = Array.isArray(data) ? data : (data.pages || []);
      
      return {
        pages: rawPages.map((p: any, i: number) => ({
          img: wrapInProxy(p.img || p.url || p),
          page: p.page || i + 1
        }))
      };
    } catch (e) {
      this.logger.error(`Failed to fetch pages for chapter ${chapterId}: ${e.message}`);
      throw new HttpException("Failed to fetch chapter pages from provider", HttpStatus.BAD_GATEWAY);
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
      rank: data.rankings?.find((r: any) => r.allTime)?.rank || data.rankings?.[0]?.rank,
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
          role: edge.role,
          character: {
            mal_id: edge.node.id,
            name: edge.node.name.full,
            images: {
              jpg: { image_url: edge.node.image.large },
            },
          },
        })) || [],
      relations:
        data.relations?.edges?.map((edge: any) => ({
          relation: edge.relationType,
          entry: [
            {
              mal_id: edge.node.id,
              type: edge.node.type,
              name: edge.node.title.english || edge.node.title.romaji,
              images: {
                jpg: { image_url: edge.node.coverImage.large },
              },
            },
          ],
        })) || [],
      recommendations:
        data.recommendations?.nodes?.map((node: any) => ({
          entry: {
            mal_id: node.mediaRecommendation.id,
            title:
              node.mediaRecommendation.title.english ||
              node.mediaRecommendation.title.romaji,
            images: {
              jpg: { image_url: node.mediaRecommendation.coverImage.large },
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
          role: edge.role,
          character: {
            mal_id: edge.node.id,
            name: edge.node.name.full,
            images: {
              jpg: { image_url: edge.node.image.large },
            },
          },
        })) ||
        data.characters?.nodes?.map((char: any) => ({
          character: {
            mal_id: char.id,
            name: char.name.full,
            images: {
              jpg: { image_url: char.image.large },
            },
          },
          role: "Main",
        })) ||
        [],
      relations:
        data.relations?.edges?.map((edge: any) => ({
          relation: edge.relationType,
          entry: [
            {
              mal_id: edge.node.id,
              type: edge.node.type,
              name: edge.node.title.english || edge.node.title.romaji,
              images: {
                jpg: { image_url: edge.node.coverImage.large },
              },
            },
          ],
        })) || [],
      recommendations:
        data.recommendations?.nodes?.map((node: any) => ({
          entry: {
            mal_id: node.mediaRecommendation.id,
            title:
              node.mediaRecommendation.title.english ||
              node.mediaRecommendation.title.romaji,
            images: {
              jpg: { image_url: node.mediaRecommendation.coverImage.large },
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
}
