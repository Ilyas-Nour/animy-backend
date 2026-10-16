import { Injectable, Logger } from "@nestjs/common";
import { ConsumetService } from "./consumet.service";
import { IdMappingService } from "./id-mapping.service";
import { EpisodeCacheService } from "./episode-cache.service";
import { WitanimeExtractorService } from "./witanime-extractor.service";
import axios from "axios";

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);

  constructor(
    private readonly consumetService: ConsumetService,
    private readonly mappingService: IdMappingService,
    private readonly cacheService: EpisodeCacheService,
    private readonly witanimeExtractor: WitanimeExtractorService,
  ) {}

  /**
   * Search for anime
   */
  async searchAnime(query: string) {
    return this.consumetService.search(query);
  }

  /**
   * Get anime info
   */
  async getAnimeInfo(id: string) {
    return this.consumetService.getAnimeInfo(id);
  }

  /**
   * Find anime by title (AniList fallback)
   */
  async findAnimeByTitle(
    title: string,
    titleEnglish?: string,
    anilistId?: number,
  ) {
    return this.consumetService.search(title);
  }

  /**
   * Resolve TMDB ID from AniList ID, MAL ID, or title
   * Uses manual mapping, AniZip mappings, or malsync.moe
   */
  async getTmdbId(
    anilistId?: number,
    title?: string,
    malId?: number,
  ): Promise<string | null> {
    try {
      // 0. Manual Fast-Track Mapping for Top Anime
      const manualMap: Record<number, string> = {
        21: "37854", // One Piece
        151807: "94668", // Solo Leveling
        16498: "57245", // Attack on Titan
        20605: "60574", // Tokyo Ghoul
        21087: "62018", // One Punch Man
        113415: "95479", // Jujutsu Kaisen
        101922: "85937", // Demon Slayer
        178083: "105009", // Tokyo Revengers: Santen Sensou-hen
        199221: "86031", // Dr. STONE: SCIENCE FUTURE
      };

      if (anilistId && manualMap[anilistId]) {
        this.logger.debug(
          `Manual Map: AniList ${anilistId} -> TMDB ${manualMap[anilistId]}`,
        );
        return manualMap[anilistId];
      }

      // 1. AniZip (Comprehensive, free, highly accurate for all anime)
      if (anilistId && !isNaN(anilistId)) {
        try {
          const res = await axios.get(
            `https://api.ani.zip/mappings?anilist_id=${anilistId}`,
            { timeout: 3500 },
          );
          if (res?.data?.mappings?.themoviedb_id) {
            const tmdbId = String(res.data.mappings.themoviedb_id);
            this.logger.debug(`AniZip: AniList ${anilistId} -> TMDB ${tmdbId}`);
            return tmdbId;
          }
        } catch (e) {}
      }

      if (malId && !isNaN(malId)) {
        try {
          const res = await axios.get(
            `https://api.ani.zip/mappings?mal_id=${malId}`,
            { timeout: 3500 },
          );
          if (res?.data?.mappings?.themoviedb_id) {
            const tmdbId = String(res.data.mappings.themoviedb_id);
            this.logger.debug(`AniZip: MAL ${malId} -> TMDB ${tmdbId}`);
            return tmdbId;
          }
        } catch (e) {}
      }

      // 2. MalSync mapping
      if (anilistId && !isNaN(anilistId)) {
        try {
          const res = await axios
            .get(`https://api.malsync.moe/mal/anime/anilist:${anilistId}`, {
              timeout: 3000,
            })
            .catch(() => null);
          const tmdbSite = res?.data?.Sites?.Tmdb;
          if (tmdbSite) {
            const tmdbId = Object.keys(tmdbSite)[0];
            if (tmdbId) {
              this.logger.debug(
                `malsync: AniList ${anilistId} -> TMDB ${tmdbId}`,
              );
              return tmdbId;
            }
          }
        } catch (e) {}
      }

      return null;
    } catch (e) {
      this.logger.warn(`TMDB Resolve Failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Resilience Mesh v8.2: "Instant Discovery"
   */
  async findAnime(title: string, titleEnglish: string, anilistId: string) {
    try {
      this.logger.debug(`Mesh-v11.1 Discovery: ${title} (AL: ${anilistId})`);

      const queries = [title, titleEnglish].filter(Boolean);
      const broadTitle = title.split(":")[0].split("-")[0].trim();
      if (broadTitle && !queries.includes(broadTitle)) {
        queries.push(broadTitle);
      }

      for (const query of queries) {
        try {
          const results = await Promise.race([
            this.consumetService.search(query),
            new Promise<any[]>((resolve) =>
              setTimeout(() => resolve([]), 4000),
            ),
          ]).catch(() => []);

          if (results.length > 0) {
            this.logger.log(
              `Mesh Discovery Match: "${query}" -> ${results[0].id} (${results[0].provider})`,
            );
            return {
              id: results[0].id,
              title: results[0].title,
              provider: results[0].provider,
            };
          }
        } catch (e) {}
      }

      return {
        id: anilistId,
        title: titleEnglish || title,
        provider: "anilist",
      };
    } catch (error) {
      return {
        id: anilistId,
        title: titleEnglish || title,
        provider: "anilist",
      };
    }
  }

  /**
   * Resilience ID Mapper: AniList -> MAL
   */
  async resolveMalId(anilistId: number): Promise<number | null> {
    try {
      this.logger.debug(`Resolving MAL ID for AniList: ${anilistId}`);
      // 1. Try AniZip first (fastest and most accurate)
      try {
        const aniZip = await axios.get(
          `https://api.ani.zip/mappings?anilist_id=${anilistId}`,
          { timeout: 3000 },
        );
        if (aniZip?.data?.mappings?.mal_id) {
          return Number(aniZip.data.mappings.mal_id);
        }
      } catch (e) {}

      // 2. Try Malsync
      const res = await axios
        .get(`https://api.malsync.moe/mal/anime/anilist:${anilistId}`, {
          timeout: 3000,
        })
        .catch(() => null);
      return res?.data?.malId || res?.data?.mal_id || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Nuclear Mesh v11.0 — "Always Streaming"
   *
   * Builds a large set of working mirrors across multiple strategies:
   *  Tier 1 — High-quality embeds using MAL ID (VidLink - Gold Standard)
   *  Tier 2 — Iframe embeds using TMDB/AniList ID (VidSrc - Stable backups)
   *  Tier 3 — Native .m3u8 extraction via Consumet/Witanime
   */
  async getEpisodeLinks(
    episodeId: string,
    provider: string = "hianime",
    proxyBaseUrl?: string,
    malIdParam?: string,
    episodeNumber?: string,
    tmdbIdParam?: string,
    title?: string,
    subDub: string = "sub",
  ) {
    try {
      const parsedId = parseInt(
        malIdParam || (!isNaN(Number(episodeId)) ? episodeId : ""),
        10,
      );
      const epNum = parseInt(episodeNumber || "1", 10);
      const cleanSubDub = subDub === "dub" ? "dub" : "sub";

      // 1. Check Cache First (Anikai level speed)
      if (!isNaN(parsedId)) {
        const cached = await this.cacheService.getCachedLinks(
          parsedId,
          epNum,
          `mesh-v12-${cleanSubDub}`,
        );
        if (cached) {
          this.logger.log(
            `Nuclear Mesh v12: CACHE HIT for ID=${parsedId}, EP=${epNum}, Track=${cleanSubDub}`,
          );
          return cached;
        }
      }

      this.logger.log(
        `Nuclear Mesh v12: ID=${parsedId}, EP=${epNum}, Track=${cleanSubDub}, Title="${title}"`,
      );

      const servers: any[] = [];

      // ──────────────────────────────────────────────────────────────────────
      // Resolve MAL ID and AniList ID
      // ──────────────────────────────────────────────────────────────────────
      let malId: number | null = null;
      let anilistId: number = parsedId;

      if (!isNaN(parsedId)) {
        // Resolve MAL ID
        const resolved = await this.resolveMalId(parsedId).catch(() => null);
        if (resolved) {
          malId = resolved;
        } else {
          malId = parsedId;
        }
      }

      // ──────────────────────────────────────────────────────────────────────
      // TIER 1: MAL & AniList based embeds (VidLink - Gold Standard)
      // ──────────────────────────────────────────────────────────────────────
      if (malId) {
        this.logger.debug(`MAL ID resolved: ${malId} -> Adding VidLink Tier 1`);

        // Mirror 1: VidLink via MAL ID
        servers.push({
          name: `VidLink (${cleanSubDub.toUpperCase()})`,
          url: `https://vidlink.pro/anime/${malId}/${epNum}/${cleanSubDub}?primaryColor=f97316&autoplay=0`,
          provider: "vidlink",
          isNative: false,
        });

        // Mirror 2: VidSrc.me
        servers.push({
          name: `VidSrc ME (${cleanSubDub.toUpperCase()})`,
          url: `https://vidsrc.me/embed/anime?mal=${malId}&ep=${epNum}&sub=${cleanSubDub}`,
          provider: "vidsrc",
          isNative: false,
        });

        // Mirror 3: VidSrc.su
        servers.push({
          name: "VidSrc SU",
          url: `https://vidsrc.su/embed/anime/${malId}/${epNum}`,
          provider: "vidsrc",
          isNative: false,
        });
      }

      // AniList direct fallback
      if (!isNaN(anilistId) && anilistId !== malId) {
        servers.push({
          name: `VidLink AL (${cleanSubDub.toUpperCase()})`,
          url: `https://vidlink.pro/anime/${anilistId}/${epNum}/${cleanSubDub}?primaryColor=f97316&autoplay=0`,
          provider: "vidlink",
          isNative: false,
        });
      }

      // ──────────────────────────────────────────────────────────────────────
      // TIER 2: TMDB-based embeds
      // ──────────────────────────────────────────────────────────────────────
      const tmdbIdPromise = tmdbIdParam
        ? Promise.resolve(tmdbIdParam)
        : this.getTmdbId(
            isNaN(anilistId) ? undefined : anilistId,
            title,
            malId || undefined,
          ).catch(() => null);

      const tmdbId = await Promise.race([
        tmdbIdPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
      ]).catch(() => null);

      if (tmdbId) {
        servers.push({
          name: `VidLink TMDB (${cleanSubDub.toUpperCase()})`,
          url: `https://vidlink.pro/tv/${tmdbId}/1/${epNum}?primaryColor=f97316&autoplay=0&player=${cleanSubDub}&type=${cleanSubDub}`,
          provider: "vidlink",
          isNative: false,
        });

        servers.push({
          name: `VidSrc PM (${cleanSubDub.toUpperCase()})`,
          url: `https://vidsrc.pm/embed/tv/${tmdbId}/1/${epNum}?sub=${cleanSubDub}`,
          provider: "vidsrc",
          isNative: false,
        });

        // 2Embed Backup
        servers.push({
          name: "2Embed (Backup)",
          url: `https://www.2embed.skin/embedtv/${tmdbId}&s=1&e=${epNum}`,
          provider: "2embed",
          isNative: false,
        });
      }

      // ──────────────────────────────────────────────────────────────────────
      // TIER 0: Witanime native extraction (Arabic CDN, highest quality)
      // Uses AniList ID → MAL-Sync → Witanime slug resolution with DB caching
      // ──────────────────────────────────────────────────────────────────────
      {
        try {
          const witanimeStreams = await Promise.race([
            !isNaN(anilistId) && anilistId > 0
              ? this.witanimeExtractor.extractEpisodeStreamsByAnilistId(
                  anilistId,
                  epNum,
                  title,
                )
              : title
                ? this.witanimeExtractor.extractEpisodeStreams(title, epNum)
                : Promise.resolve([]),
            new Promise<any[]>((resolve) =>
              setTimeout(() => resolve([]), 12000),
            ),
          ]);

          // Reverse the array to maintain the order when unshifting
          const reversedStreams = [...witanimeStreams].reverse();

          for (const stream of reversedStreams) {
            if (stream.isNative && stream.streamUrl) {
              // Native .m3u8 proxy through our server or Cloudflare to handle CORS
              let proxiedUrl = stream.streamUrl;
              if (process.env.CLOUDFLARE_PROXY_URL) {
                proxiedUrl = `${process.env.CLOUDFLARE_PROXY_URL}?url=${encodeURIComponent(stream.streamUrl)}&referer=${encodeURIComponent(stream.referer || "https://witanime.you/")}`;
              } else if (proxyBaseUrl) {
                proxiedUrl = `${proxyBaseUrl}/${encodeURIComponent(stream.streamUrl)}?referer=${encodeURIComponent(stream.referer || "https://witanime.you/")}`;
              }

              servers.unshift({
                name: `Witanime ${stream.quality || "HD"} (${stream.provider.replace("witanime-", "")})`,
                url: proxiedUrl,
                sources: [
                  {
                    url: proxiedUrl,
                    quality: stream.quality || "auto",
                    isM3U8: true,
                  },
                ],
                provider: stream.provider,
                isNative: true,
                headers: {
                  Referer: stream.referer || "https://witanime.you/",
                },
              });
            } else if (stream.embedUrl) {
              // Embed-only server (ok.ru, videa, etc.) — renderable as iframe
              servers.unshift({
                name: `Witanime ${stream.quality || "HD"} (${stream.provider.replace("witanime-", "")})`,
                url: stream.embedUrl,
                provider: stream.provider,
                isNative: false,
              });
            }
          }

          this.logger.log(
            `Witanime Tier 0: ${witanimeStreams.length} servers extracted`,
          );
        } catch (e) {
          this.logger.warn(`Witanime Tier 0 failed: ${e.message}`);
        }
      }

      // ──────────────────────────────────────────────────────────────────────
      // TIER 3: Native .m3u8 extraction via consumet (Best quality)
      // ──────────────────────────────────────────────────────────────────────
      if (title) {
        try {
          const nativeServers = await Promise.race([
            this.extractNativeSources(title, epNum, anilistId, proxyBaseUrl),
            new Promise<any[]>((resolve) =>
              setTimeout(() => resolve([]), 15000),
            ),
          ]);
          if (nativeServers.length > 0) {
            servers.unshift(...nativeServers);
          }
        } catch (e) {}
      }

      const response = {
        provider: "mesh-v12-nuclear",
        servers,
        anilistId,
        malId,
        tmdbId: tmdbId || null,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Referer: "https://vidlink.pro/",
        },
      };

      // Cache the result (Anikai strategy)
      if (!isNaN(anilistId) && servers.length > 0) {
        await this.cacheService.cacheLinks(
          anilistId,
          epNum,
          "mesh-v12",
          response,
          3,
        );
      }

      return response;
    } catch (error) {
      this.logger.error(`Mesh v12 CRITICAL: ${error.message}`);
      return { provider: "mesh-v12-error", servers: [], headers: {} };
    }
  }

  /**
   * Internal: try to extract native .m3u8 sources via consumet providers.
   */
  private async extractNativeSources(
    title: string,
    epNum: number,
    anilistId: number,
    proxyBaseUrl?: string,
  ): Promise<any[]> {
    const nativeServers: any[] = [];

    const toProxiedUrl = (rawUrl: string, referer: string): string => {
      if (!rawUrl) return rawUrl;
      if (process.env.CLOUDFLARE_PROXY_URL) {
        return `${process.env.CLOUDFLARE_PROXY_URL}?url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent(referer)}`;
      }
      if (!proxyBaseUrl) return rawUrl;
      return `${proxyBaseUrl}/${rawUrl}?referer=${encodeURIComponent(referer)}`;
    };

    try {
      this.logger.debug(`Native extraction attempt: "${title}" EP${epNum}`);

      const searchResults = await Promise.race([
        this.consumetService.search(title),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 8000)),
      ]).catch(() => []);

      if (!searchResults?.length) return [];

      // 1. AnimePahe (Most reliable native source)
      const paheResult = searchResults.find((r) => r.provider === "animepahe");
      if (paheResult) {
        try {
          const paheEpId = await this.consumetService.resolveEpisodeId(
            paheResult.id,
            epNum,
            "animepahe",
          );
          if (paheEpId) {
            const sources = await this.consumetService.getEpisodeSources(
              paheEpId,
              "animepahe",
            );
            if (sources?.sources?.length) {
              const paheReferer =
                sources.headers?.Referer || "https://animepahe.com/";
              const proxiedSources = sources.sources.map((s: any) => ({
                ...s,
                url: toProxiedUrl(s.url, paheReferer),
              }));
              nativeServers.push({
                name: "Native 1 (AnimePahe)",
                url: proxiedSources[0].url,
                sources: proxiedSources,
                subtitles: sources.subtitles || [],
                provider: "animepahe",
                isNative: true,
                headers: sources.headers,
              });
              this.logger.log(
                `Native AnimePahe extraction SUCCESS for EP${epNum}`,
              );
            }
          }
        } catch (e) {}
      }

      // 2. Anify (Fastest .m3u8 provider)
      const anifyResult = searchResults.find((r) => r.provider === "anify");
      if (anifyResult) {
        try {
          const res = await axios.get(
            `https://api.anify.tv/sources?id=${anifyResult.id}&episodeNumber=${epNum}&providerId=gogoanime&watchId=${anifyResult.id}&subType=sub`,
            { timeout: 6000 },
          );
          if (res.data?.sources?.length) {
            const sources = res.data.sources.map((s: any) => ({
              url: toProxiedUrl(s.url, "https://anify.tv/"),
              quality: s.quality,
              isM3U8: s.url.includes(".m3u8"),
            }));
            nativeServers.push({
              name: "Native 2 (Anify - High Speed)",
              url: sources[0].url,
              sources,
              subtitles: res.data.subtitles || [],
              provider: "anify",
              isNative: true,
              headers: { Referer: "https://anify.tv/" },
            });
            this.logger.log(`Native Anify extraction SUCCESS for EP${epNum}`);
          }
        } catch (e) {}
      }
      // 3. HiAnime (Zoro - High Quality Subs)
      const hiResult = searchResults.find((r) => r.provider === "hianime");
      if (hiResult) {
        try {
          const hiEpId = await this.consumetService.resolveEpisodeId(
            hiResult.id,
            epNum,
            "hianime",
          );
          if (hiEpId) {
            const sources = await this.consumetService.getEpisodeSources(
              hiEpId,
              "hianime",
            );
            if (sources?.sources?.length) {
              const hiReferer =
                sources.headers?.Referer || "https://hianime.to/";
              const proxiedSources = sources.sources.map((s: any) => ({
                ...s,
                url: toProxiedUrl(s.url, hiReferer),
              }));
              nativeServers.push({
                name: "Native 3 (HiAnime - Clean)",
                url: proxiedSources[0].url,
                sources: proxiedSources,
                subtitles: sources.subtitles || [],
                provider: "hianime",
                isNative: true,
                headers: sources.headers,
              });
              this.logger.log(
                `Native HiAnime extraction SUCCESS for EP${epNum}`,
              );
            }
          }
        } catch (e) {}
      }
    } catch (e) {
      this.logger.warn(`Native extraction failed: ${e.message}`);
    }

    return nativeServers;
  }
}
