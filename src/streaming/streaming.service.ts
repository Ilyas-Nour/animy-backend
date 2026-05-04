import { Injectable, Logger } from "@nestjs/common";
import { ConsumetService } from "./consumet.service";
import { IdMappingService } from "./id-mapping.service";
import { EpisodeCacheService } from "./episode-cache.service";
import axios from "axios";

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);

  constructor(
    private readonly consumetService: ConsumetService,
    private readonly mappingService: IdMappingService,
    private readonly cacheService: EpisodeCacheService,
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
  async findAnimeByTitle(title: string, titleEnglish?: string, anilistId?: number) {
    return this.consumetService.search(title);
  }


  /**
   * Resolve TMDB ID from AniList ID or title
   * Uses manual mapping, malsync.moe, or TMDB Search API
   */
  async getTmdbId(anilistId?: number, title?: string): Promise<string | null> {
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
      };

      if (anilistId && manualMap[anilistId]) {
        this.logger.debug(`Manual Map: AniList ${anilistId} -> TMDB ${manualMap[anilistId]}`);
        return manualMap[anilistId];
      }

      // 1. First try malsync (fastest)
      if (anilistId && !isNaN(anilistId)) {
        try {
          const res = await axios.get(`https://api.malsync.moe/anilist/anime/${anilistId}`, { timeout: 3000 }).catch(() => null);
          const tmdbSite = res?.data?.Sites?.Tmdb;
          if (tmdbSite) {
            const tmdbId = Object.keys(tmdbSite)[0];
            if (tmdbId) {
              this.logger.debug(`malsync: AniList ${anilistId} -> TMDB ${tmdbId}`);
              return tmdbId;
            }
          }
          if (res?.data?.title) {
            title = res.data.title;
          }
        } catch (e) {}
      }

      // 2. Aggressive TMDB Search
      if (title) {
        const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=5220615c4f292398606c4068305f8841&query=${encodeURIComponent(title)}&language=en-US&page=1&include_adult=false`;
        const res = await axios.get(searchUrl, { timeout: 5000 }).catch(() => null);
        if (res?.data?.results?.length) {
          // Prioritize TV shows for anime, then movies
          const tvMatch = res.data.results.find((r: any) => r.media_type === 'tv');
          const movieMatch = res.data.results.find((r: any) => r.media_type === 'movie');
          const bestMatch = tvMatch || movieMatch;
          
          if (bestMatch) {
            this.logger.debug(`TMDB search: "${title}" -> ${bestMatch.id} (${bestMatch.media_type})`);
            return bestMatch.id.toString();
          }
        }
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
      this.logger.debug(`Mesh-v8.2 Discovery: ${title} (AL: ${anilistId})`);

      const fallback = {
        id: anilistId,
        title: titleEnglish || title,
        provider: "anilist"
      };

      try {
        const results = await Promise.race([
          this.consumetService.search(titleEnglish || title),
          new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 2500))
        ]).catch(() => []);

        if (results.length > 0) {
          return {
            id: results[0].id,
            title: results[0].title,
            provider: results[0].provider
          };
        }
      } catch (e) {}

      return fallback;
    } catch (error) {
      return { id: anilistId, title: titleEnglish || title, provider: "anilist" };
    }
  }

  /**
   * Resilience ID Mapper: AniList -> MAL
   */
  async resolveMalId(anilistId: number): Promise<number | null> {
    try {
      this.logger.debug(`Resolving MAL ID for AniList: ${anilistId}`);
      // Correct Malsync URL for AniList mapping
      const res = await axios.get(`https://api.malsync.moe/mal/anime/anilist:${anilistId}`, { timeout: 3000 });
      return res.data?.mal_id || res.data?.id || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Nuclear Mesh v11.0 — "Always Streaming"
   *
   * Builds a large set of working mirrors across multiple strategies:
   *  Tier 1 — High-quality embeds using MAL ID (VidLink - Gold Standard)
   *  Tier 2 — Iframe embeds using TMDB ID (Stable backups)
   *  Tier 3 — Native .m3u8 extraction via consumet (Best quality, proxy-enabled)
   */
  async getEpisodeLinks(
    episodeId: string,
    provider: string = "hianime",
    proxyBaseUrl?: string,
    malIdParam?: string,
    episodeNumber?: string,
    tmdbIdParam?: string,
    title?: string
  ) {
    try {
      const anilistId = parseInt(malIdParam || (!isNaN(Number(episodeId)) ? episodeId : ""), 10);
      const epNum = parseInt(episodeNumber || "1", 10);

      // 1. Check Cache First (Anikai level speed)
      if (!isNaN(anilistId)) {
        const cached = await this.cacheService.getCachedLinks(anilistId, epNum, "mesh-v11");
        if (cached) {
          this.logger.log(`Nuclear Mesh v11: CACHE HIT for AL=${anilistId}, EP=${epNum}`);
          return cached;
        }
      }

      this.logger.log(`Nuclear Mesh v11: AL=${anilistId}, EP=${epNum}, Title="${title}"`);

      const servers: any[] = [];

      // ──────────────────────────────────────────────────────────────────────
      // TIER 1: MAL & AniList based embeds (VidLink - Most Stable 2026)
      // ──────────────────────────────────────────────────────────────────────
      let malId = isNaN(anilistId) ? null : await this.resolveMalId(anilistId).catch(() => null);
      
      if (malId) {
        this.logger.debug(`MAL ID resolved: ${malId} -> Adding VidLink Tier 1`);
        
        // Mirror 0: VidLink via AniList ID
        servers.push({
          name: 'Mirror 0 (VidLink - AL)',
          url: `https://vidlink.pro/anime/${anilistId}/${epNum}`,
          provider: 'vidlink',
          isNative: false
        });

        // VidLink (Primary) - Direct MAL support
        servers.push({
          name: 'Mirror 1 (VidLink - MAL)',
          url: `https://vidlink.pro/anime/${malId}/${epNum}`,
          provider: 'vidlink',
          isNative: false
        });

        // Vidsrc.cc / .xyz
        servers.push({
          name: 'Mirror 2 (VidSrc - MAL)',
          url: `https://vidsrc.cc/v2/embed/anime/${malId}/${epNum}/sub`,
          provider: 'vidsrc',
          isNative: false
        });

        // Vidsrc.me (Extremely stable)
        servers.push({
          name: 'Mirror 3 (VidSrc.me)',
          url: `https://vidsrc.me/embed/anime/${malId}/${epNum}`,
          provider: 'vidsrc',
          isNative: false
        });

        // Vidsrc.to (AL Direct)
        servers.push({
          name: 'Mirror 8 (VidSrc.to - AL)',
          url: `https://vidsrc.to/embed/anime/${anilistId}/${epNum}`,
          provider: 'mirror',
          isNative: false
        });

        // Vyla (Fail-safe)
        servers.push({
          name: 'Mirror 9 (Vyla)',
          url: `https://vyla.pages.dev/embed/${anilistId}/${epNum}`,
          provider: 'mirror',
          isNative: false
        });
      }

      // ──────────────────────────────────────────────────────────────────────
      // TIER 2: TMDB-based embeds
      // ──────────────────────────────────────────────────────────────────────
      const tmdbIdPromise = tmdbIdParam
        ? Promise.resolve(tmdbIdParam)
        : this.getTmdbId(isNaN(anilistId) ? undefined : anilistId, title).catch(() => null);

      const tmdbId = await Promise.race([
        tmdbIdPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))
      ]).catch(() => null);

      const secondaryId = tmdbId || anilistId;
      const isTmdb = !!tmdbId;

      if (secondaryId) {
        if (isTmdb) {
          servers.push({
            name: 'Mirror 4 (VidLink - TMDB)',
            url: `https://vidlink.pro/tv/${secondaryId}/1/${epNum}`,
            provider: 'vidlink',
            isNative: false
          });
        }

        servers.push({
          name: isTmdb ? 'Mirror 5 (VidSrc.to)' : 'Mirror 5 (VidSrc.to - AL)',
          url: isTmdb 
            ? `https://vidsrc.to/embed/tv/${secondaryId}/1/${epNum}`
            : `https://vidsrc.to/embed/anime/${secondaryId}/${epNum}`,
          provider: 'mirror',
          isNative: false
        });

        servers.push({
          name: isTmdb ? 'Mirror 6 (Embed.su)' : 'Mirror 6 (Embed.su - AL)',
          url: isTmdb
            ? `https://embed.su/embed/tv/${secondaryId}/1/${epNum}`
            : `https://embed.su/embed/anime/${secondaryId}/${epNum}`,
          provider: 'mirror',
          isNative: false
        });
      }

      // ──────────────────────────────────────────────────────────────────────
      // TIER 3: Native .m3u8 extraction via consumet (Best quality)
      // ──────────────────────────────────────────────────────────────────────
      if (title) {
        try {
          const nativeServers = await Promise.race([
            this.extractNativeSources(title, epNum, anilistId, proxyBaseUrl),
            new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 15000))
          ]);
          if (nativeServers.length > 0) {
            servers.unshift(...nativeServers); 
          }
        } catch (e) {}
      }

      const response = {
        provider: "mesh-v11-nuclear",
        servers,
        anilistId,
        malId,
        tmdbId: tmdbId || null,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://vidlink.pro/'
        }
      };

      // Cache the result (Anikai strategy)
      if (!isNaN(anilistId) && servers.length > 0) {
        await this.cacheService.cacheLinks(anilistId, epNum, "mesh-v11", response, 3);
      }

      return response;
    } catch (error) {
      this.logger.error(`Mesh v11 CRITICAL: ${error.message}`);
      return { provider: "mesh-v11-error", servers: [], headers: {} };
    }
  }

  /**
   * Internal: try to extract native .m3u8 sources via consumet providers.
   */
  private async extractNativeSources(title: string, epNum: number, anilistId: number, proxyBaseUrl?: string): Promise<any[]> {
    const nativeServers: any[] = [];

    const toProxiedUrl = (rawUrl: string, referer: string): string => {
      if (!proxyBaseUrl || !rawUrl) return rawUrl;
      return `${proxyBaseUrl}/${rawUrl}?referer=${encodeURIComponent(referer)}`;
    };

    try {
      this.logger.debug(`Native extraction attempt: "${title}" EP${epNum}`);

      const searchResults = await Promise.race([
        this.consumetService.search(title),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 8000))
      ]).catch(() => []);

      if (!searchResults?.length) return [];

      // 1. AnimePahe (Most reliable native source)
      const paheResult = searchResults.find(r => r.provider === 'animepahe');
      if (paheResult) {
        try {
          const paheEpId = await this.consumetService.resolveEpisodeId(paheResult.id, epNum, 'animepahe');
          if (paheEpId) {
            const sources = await this.consumetService.getEpisodeSources(paheEpId, 'animepahe');
            if (sources?.sources?.length) {
              const paheReferer = sources.headers?.Referer || 'https://animepahe.com/';
              const proxiedSources = sources.sources.map((s: any) => ({
                ...s,
                url: toProxiedUrl(s.url, paheReferer)
              }));
              nativeServers.push({
                name: 'Native 1 (AnimePahe)',
                url: proxiedSources[0].url,
                sources: proxiedSources,
                subtitles: sources.subtitles || [],
                provider: 'animepahe',
                isNative: true,
                headers: sources.headers
              });
              this.logger.log(`Native AnimePahe extraction SUCCESS for EP${epNum}`);
            }
          }
        } catch (e) {}
      }

      // 2. Anify (Fastest .m3u8 provider)
      const anifyResult = searchResults.find(r => r.provider === 'anify');
      if (anifyResult) {
        try {
          const res = await axios.get(`https://api.anify.tv/sources?id=${anifyResult.id}&episodeNumber=${epNum}&providerId=gogoanime&watchId=${anifyResult.id}&subType=sub`, { timeout: 6000 });
          if (res.data?.sources?.length) {
            const sources = res.data.sources.map((s: any) => ({
              url: toProxiedUrl(s.url, 'https://anify.tv/'),
              quality: s.quality,
              isM3U8: s.url.includes('.m3u8')
            }));
            nativeServers.push({
              name: 'Native 2 (Anify - High Speed)',
              url: sources[0].url,
              sources,
              subtitles: res.data.subtitles || [],
              provider: 'anify',
              isNative: true,
              headers: { Referer: 'https://anify.tv/' }
            });
            this.logger.log(`Native Anify extraction SUCCESS for EP${epNum}`);
          }
        } catch (e) {}
      }
      // 3. HiAnime (Zoro - High Quality Subs)
      const hiResult = searchResults.find(r => r.provider === 'hianime');
      if (hiResult) {
        try {
          const hiEpId = await this.consumetService.resolveEpisodeId(hiResult.id, epNum, 'hianime');
          if (hiEpId) {
            const sources = await this.consumetService.getEpisodeSources(hiEpId, 'hianime');
            if (sources?.sources?.length) {
              const hiReferer = sources.headers?.Referer || 'https://hianime.to/';
              const proxiedSources = sources.sources.map((s: any) => ({
                ...s,
                url: toProxiedUrl(s.url, hiReferer)
              }));
              nativeServers.push({
                name: 'Native 3 (HiAnime - Clean)',
                url: proxiedSources[0].url,
                sources: proxiedSources,
                subtitles: sources.subtitles || [],
                provider: 'hianime',
                isNative: true,
                headers: sources.headers
              });
              this.logger.log(`Native HiAnime extraction SUCCESS for EP${epNum}`);
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
