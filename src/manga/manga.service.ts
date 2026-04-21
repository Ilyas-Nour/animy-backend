import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { AnilistService } from "../common/services/anilist.service";
import { IdMappingService } from "../streaming/id-mapping.service";
import { SearchMangaDto } from "./dto/search-manga.dto";
import axios from "axios";

@Injectable()
export class MangaService {
  private readonly logger = new Logger(MangaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anilistService: AnilistService,
    private readonly idMappingService: IdMappingService,
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
      let title = "";

      const cachedManga = await this.prisma.manga.findUnique({ where: { id } });
      if (cachedManga && cachedManga.title) {
        title = cachedManga.title;
      }

      if (!title) {
        try {
          this.logger.debug(`Fetching title for manga ${id} from AniList`);
          const anilistInfo = await this.anilistService.getMangaById(id);
          if (anilistInfo) {
            title =
              anilistInfo.title.english ||
              anilistInfo.title.romaji ||
              anilistInfo.title.native;
          }
        } catch (e) {
          this.logger.debug(
            `Could not fetch details from AniList directly: ${e.message}`,
          );
          // Backup graphql call directly if service method fails
          try {
            const { data } = await axios.post("https://graphql.anilist.co", {
              query: `
                        query ($id: Int) {
                          Media(id: $id, type: MANGA) {
                            title {
                              romaji
                              english
                            }
                          }
                        }
                    `,
              variables: { id },
            });
            const anilistInfo = data.data.Media;
            if (anilistInfo) {
              title = anilistInfo.title.english || anilistInfo.title.romaji;
            }
          } catch (graphqlErr) {
            this.logger.error(
              `GraphQL backup title fetch failed: ${graphqlErr.message}`,
            );
          }
        }
      }

      if (!title) {
        this.logger.warn(`Could not find title for manga ${id}`);
        return { chapters: [] };
      }

      const nativeTitle = cachedManga?.titleJapanese || "";

      // 0. Aggressive Anify Fallback (Highly reliable for cloud IPs)
      try {
        this.logger.debug(`Trying Anify fallback for: ${title}`);
        const anifyRes = await axios.get(`https://api.anify.tv/info/${id}`, { timeout: 10000 });
        if (anifyRes.data?.chapters?.data) {
          const chapters = anifyRes.data.chapters.data
            .filter((c: any) => c.providerId === 'mangadex' || c.providerId === 'readdetective' || c.providerId === 'mangapill')
            .map((c: any) => ({
              id: `anify___${Buffer.from(c.id).toString("base64url")}___${Buffer.from(c.providerId).toString("base64url")}`,
              title: c.title || `Chapter ${c.number}`,
              chapterNumber: c.number.toString(),
              volumeNumber: c.volume?.toString() || "0",
            }));
          
          if (chapters.length > 0) {
            this.logger.debug(`Found ${chapters.length} chapters on Anify`);
            return { chapters: chapters.sort((a, b) => Number(b.chapterNumber) - Number(a.chapterNumber)) };
          }
        }
      } catch (e) {
        this.logger.debug(`Anify fallback skipped: ${e.message}`);
      }

      // 1. Try DB Mapping first (Direct MangaDex)
      const titlesToSearch = [title, englishTitle, nativeTitle].filter(t => t && t.length > 1);
      this.logger.debug(`Checking DB mapping/Direct search for manga ${id} with titles: ${titlesToSearch.join(', ')}`);
      
      let mangaDexId = null;
      for (const t of titlesToSearch) {
        mangaDexId = await this.idMappingService.resolveMangaDexId(id, t);
        if (mangaDexId) break;
      }
      
      if (mangaDexId) {
        this.logger.debug(`Found MangaDex mapping for ${id}: ${mangaDexId}. Fetching chapters...`);
        try {
          const chaptersRes = await axios.get(
            `https://api.mangadex.org/manga/${mangaDexId}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=500&includeExternalVol=0`,
            { 
              timeout: 10000,
              headers: {
                'User-Agent': 'Animy/1.0.0 (https://animy.xyz)'
              }
            }
          );

          if (chaptersRes.data.data && chaptersRes.data.data.length > 0) {
            this.logger.debug(`Successfully fetched ${chaptersRes.data.data.length} chapters directly from MangaDex`);
            return {
              chapters: chaptersRes.data.data.map((ch: any) => ({
                id: `mangadex_direct___${ch.id}___na`,
                title: ch.attributes.title || `Chapter ${ch.attributes.chapter}`,
                chapterNumber: ch.attributes.chapter,
                volumeNumber: ch.attributes.volume,
              })).sort((a: any, b: any) => Number(b.chapterNumber) - Number(a.chapterNumber)),
            };
          }
        } catch (e) {
          this.logger.warn(`Direct MangaDex fetch failed for ${mangaDexId}: ${e.message}`);
        }
      }

      // 2. Try meta/anilist-manga with mangadex first (Consumet)
      const apiBaseUrls = [
        "https://consumet-api-clone.vercel.app",
        "https://api.consumet.org",
      ];

      for (const baseUrl of apiBaseUrls) {
        try {
          const { data } = await axios.get(
            `${baseUrl}/meta/anilist-manga/${id}?provider=mangadex`,
            { timeout: 8000 }
          );
          if (data.chapters && data.chapters.length > 0) {
            const chapters = data.chapters.map((c) => ({
              ...c,
              id: `anilist___${Buffer.from(c.id).toString("base64url")}___${Buffer.from(baseUrl).toString("base64url")}`,
            }));
            return { chapters };
          }
        } catch (e) {
          this.logger.debug(
            `meta/anilist-manga failed for ${id} on ${baseUrl}, trying next...`,
          );
        }
      }

      // 3. Try direct provider search fallback with multiple titles
      const providers = ["mangasee123", "mangapill", "mangakakalot", "mangadex", "mangareader"];
      const titlesToTry = [title, englishTitle, nativeTitle].filter(t => t && t.length > 1);

      for (const provider of providers) {
        for (const baseUrl of apiBaseUrls) {
          for (const searchTitle of titlesToTry) {
            try {
              // Strip suffixes like (TV), (Manga), etc. for better matching
              const optimizedSearchTitle = searchTitle.replace(/\s*\(.*?\)\s*/g, ' ').trim();
              
              this.logger.debug(
                `Searching ${provider} for: ${optimizedSearchTitle} on ${baseUrl}`,
              );
              const searchRes = await axios.get(
                `${baseUrl}/manga/${provider}/${encodeURIComponent(optimizedSearchTitle)}`,
                { 
                  timeout: 10000,
                  headers: {
                    'User-Agent': 'Animy/1.0.0 (https://animy.xyz)'
                  }
                }
              );

              if (searchRes.data?.results?.length > 0) {
                const normalize = (str: string) =>
                  str
                    .toLowerCase()
                    .replace(/[^\w\s]|_/g, "")
                    .replace(/\s+/g, " ")
                    .trim();
                const normalizedTargetTitle = normalize(optimizedSearchTitle);

                for (const res of searchRes.data.results) {
                  const normalizedResTitle = normalize(res.title);

                  if (
                    normalizedResTitle === normalizedTargetTitle ||
                    normalizedResTitle.includes(normalizedTargetTitle) ||
                    normalizedTargetTitle.includes(normalizedResTitle)
                  ) {
                    const providerId = res.id;
                    this.logger.debug(
                      `Matched title for ${searchTitle}: ${res.title} (ID: ${providerId}) on ${provider}, checking info...`,
                    );

                    try {
                      const infoUrl = `${baseUrl}/manga/${provider}/info?id=${providerId}`;
                      const infoRes = await axios.get(infoUrl, { 
                        timeout: 10000,
                        headers: {
                          'User-Agent': 'Animy/1.0.0 (https://animy.xyz)'
                        }
                      });

                      if (
                        infoRes.data?.chapters &&
                        infoRes.data.chapters.length > 0
                      ) {
                        const chapters = infoRes.data.chapters.map((c) => ({
                          ...c,
                          id: `${provider}___${Buffer.from(c.id).toString("base64url")}___${Buffer.from(baseUrl).toString("base64url")}`,
                        }));
                        
                        // If we found a good match and it's MangaDex, save it
                        if (provider === 'mangadex') {
                          await this.idMappingService.saveMangaDexMapping(id, providerId);
                        }

                        this.logger.debug(
                          `Found ${chapters.length} chapters on ${provider}`,
                        );
                        return { chapters };
                      }
                    } catch (infoErr) {
                      this.logger.debug(
                        `Failed to fetch info for ${providerId} on ${provider}: ${infoErr.message}`,
                      );
                    }
                  }
                }
              }
            } catch (e) {
              this.logger.debug(
                `${provider} fallback failed for "${searchTitle}" on ${baseUrl}: ${e.message}`,
              );
            }
          }
        }
      }

      // FINAL HIGH-RELIABILITY FALLBACK: Direct MangaDex API (Bypassing scrapers)
      this.logger.debug(
        `Scrapers failed. Attempting direct MangaDex API fallback for: ${title}`,
      );
      try {
        // Try both primary and english titles for direct search
        for (const searchTitle of [englishTitle, title]) {
          const searchRes = await axios.get(
            `https://api.mangadex.org/manga?title=${encodeURIComponent(searchTitle)}&limit=5&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`,
            { timeout: 8000 }
          );
          
          if (!searchRes.data.data || searchRes.data.data.length === 0) continue;

          // Find best match in results
          const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
          const target = normalize(searchTitle);
          
          const bestMatch = searchRes.data.data.find((m: any) => {
            const titles = [m.attributes.title.en, m.attributes.title['ja-ro'], ...Object.values(m.attributes.title)].filter(Boolean) as string[];
            return titles.some(t => normalize(t) === target || normalize(t).includes(target));
          }) || searchRes.data.data[0];

          const mangaId = bestMatch.id;

          if (mangaId) {
            this.logger.debug(`Direct MangaDex match found: ${mangaId}. Saving and fetching feed...`);
            await this.idMappingService.saveMangaDexMapping(id, mangaId);
            
            const chaptersRes = await axios.get(
              `https://api.mangadex.org/manga/${mangaId}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=500`,
              { 
                timeout: 10000,
                headers: {
                  'User-Agent': 'Animy/1.0.0 (https://animy.xyz)'
                }
              }
            );

            if (chaptersRes.data.data && chaptersRes.data.data.length > 0) {
              return {
                chapters: chaptersRes.data.data.map((ch: any) => ({
                  id: `mangadex_direct___${ch.id}___na`,
                  title: ch.attributes.title || `Chapter ${ch.attributes.chapter}`,
                  chapterNumber: ch.attributes.chapter,
                  volumeNumber: ch.attributes.volume,
                })).sort((a: any, b: any) => Number(b.chapterNumber) - Number(a.chapterNumber)),
              };
            }
          }
        }
      } catch (mdError) {
        this.logger.error(
          `Direct MangaDex fallback failed: ${mdError.message}`,
        );
      }

      return { chapters: [] };
    } catch (e) {
      this.logger.error(
        `Failed to fetch chapters for manga ${id}: ${e.message}`,
      );
      return { chapters: [] };
    }
  }

  async getChapterPages(chapterId: string) {
    try {
      this.logger.debug(`Fetching high-quality pages for chapter ${chapterId}`);

      let url = "";
      const parts = chapterId.split("___");

      if (parts.length === 3) {
        const provider = parts[0];
        const actualId =
          provider === "mangadex_direct"
            ? parts[1]
            : Buffer.from(parts[1], "base64url").toString("utf-8");
        const baseUrl =
          provider === "mangadex_direct"
            ? "https://api.mangadex.org"
            : Buffer.from(parts[2], "base64url").toString("utf-8");

        if (provider === "anify") {
          // Handle Anify pages
          const chapterId = actualId;
          const providerId = baseUrl; // In our mapping, baseUrl is the providerId (mangadex, etc)
          const pagesRes = await axios.get(
            `https://api.anify.tv/pages?id=${chapterId}&providerId=${providerId}&readId=${chapterId}&episodeNumber=0&type=manga`,
            { timeout: 10000 }
          );
          
          if (pagesRes.data) {
             // Anify returns an array of page objects or just URLs
             const pages = Array.isArray(pagesRes.data) ? pagesRes.data : pagesRes.data.pages || [];
             return {
               pages: pages.map((p: any, index: number) => ({
                 url: p.url || p,
                 number: index + 1
               }))
             };
          }
        }

        if (provider === "mangadex_direct") {
          // Handle Direct MangaDex pages
          const atHomeRes = await axios.get(
            `https://api.mangadex.org/at-home/server/${actualId}`,
          );
          const host = atHomeRes.data.baseUrl;
          const hash = atHomeRes.data.chapter.hash;
          const files = atHomeRes.data.chapter.data;
          return {
            pages: files.map((f: string) => ({
              url: `${host}/data/${hash}/${f}`,
              number: files.indexOf(f) + 1,
            })),
          };
        }

        if (provider === "anilist") {
          url = `${baseUrl}/meta/anilist-manga/read?chapterId=${actualId}&provider=mangadex`;
        } else {
          url = `${baseUrl}/manga/${provider}/read?chapterId=${actualId}`;
        }
      } else if (parts.length === 2) {
        const provider = parts[0];
        const actualId = Buffer.from(parts[1], "base64url").toString("utf-8");
        const baseUrl = "https://consumet-api-clone.vercel.app";

        if (provider === "anilist") {
          url = `${baseUrl}/meta/anilist-manga/read?chapterId=${actualId}&provider=mangadex`;
        } else {
          url = `${baseUrl}/manga/${provider}/read?chapterId=${actualId}`;
        }
      } else {
        // Fallback for old cached/saved formats
        url = `https://consumet-api-clone.vercel.app/meta/anilist-manga/read?chapterId=${chapterId}&provider=mangadex`;
      }

      const { data } = await axios.get(url);
      return { pages: data };
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
      rank: null,
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
