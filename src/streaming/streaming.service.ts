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
   * Uses malsync.moe to map AniList -> TMDB (no API key needed)
   */
  async getTmdbId(anilistId?: number, title?: string): Promise<string | null> {
    try {
      // 1. Best: Use malsync to map AniList ID -> TMDB (no key required)
      if (anilistId && !isNaN(anilistId)) {
        try {
          const malsyncUrl = `https://api.malsync.moe/mal/anime/anilist:${anilistId}`;
          const res = await axios.get(malsyncUrl, { timeout: 4000 }).catch(() => null);
          // malsync returns sites map with TMDB
          const tmdbSite = res?.data?.Sites?.Tmdb;
          if (tmdbSite) {
            const tmdbId = Object.keys(tmdbSite)[0];
            if (tmdbId) {
              this.logger.debug(`malsync: AniList ${anilistId} -> TMDB ${tmdbId}`);
              return tmdbId;
            }
          }
        } catch (e) {}
      }

      // 2. Fallback: TMDB Search API (uses hardcoded public key)
      if (title) {
        const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=5220615c4f292398606c4068305f8841&query=${encodeURIComponent(title)}&language=en-US&page=1&include_adult=false`;
        const res = await axios.get(searchUrl, { timeout: 5000 }).catch(() => null);
        if (res?.data?.results?.length) {
          const bestMatch = res.data.results.find(
            (r: any) => r.media_type === 'tv' || r.media_type === 'movie'
          );
          if (bestMatch) {
            this.logger.debug(`TMDB search: "${title}" -> ${bestMatch.id}`);
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

      this.logger.log(`Nuclear Mesh v11: AL=${anilistId}, EP=${epNum}, Title="${title}"`);

      const servers: any[] = [];

      // ──────────────────────────────────────────────────────────────────────
      // TIER 1: MAL-based embeds (VidLink - Most Stable 2026)
      // ──────────────────────────────────────────────────────────────────────
      let malId = isNaN(anilistId) ? null : await this.resolveMalId(anilistId).catch(() => null);
      
      if (malId) {
        this.logger.debug(`MAL ID resolved: ${malId} -> Adding VidLink Tier 1`);
        
        // VidLink (Primary) - Direct MAL support
        servers.push({
          name: 'Mirror 1 (VidLink - MAL)',
          url: `https://vidlink.pro/anime/${malId}/${epNum}`,
          provider: 'vidlink',
          isNative: false
        });

        // Vidsrc.cc / .xyz often support MAL IDs too
        servers.push({
          name: 'Mirror 2 (VidSrc - MAL)',
          url: `https://vidsrc.cc/v2/embed/anime/${malId}/${epNum}/sub`,
          provider: 'vidsrc',
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
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
      ]).catch(() => null);

      if (tmdbId) {
        this.logger.debug(`TMDB resolved: ${tmdbId}`);

        // VidLink.pro (TMDB) - Often more stable than MAL route
        servers.push({
          name: 'Mirror 3 (VidLink - TMDB)',
          url: `https://vidlink.pro/tv/${tmdbId}/1/${epNum}`,
          provider: 'vidlink',
          isNative: false
        });

        // VidSrc.to — most stable TMDB mirror
        servers.push({
          name: 'Mirror 4 (VidSrc.to)',
          url: `https://vidsrc.to/embed/tv/${tmdbId}/1/${epNum}`,
          provider: 'mirror',
          isNative: false
        });

        // Embed.su (Backup)
        servers.push({
          name: 'Mirror 5 (Embed.su)',
          url: `https://embed.su/embed/tv/${tmdbId}/1/${epNum}`,
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
            new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 12000))
          ]);
          if (nativeServers.length > 0) {
            // In v11, we still keep native sources near the top if they work
            servers.unshift(...nativeServers); 
          }
        } catch (e) {}
      }

      this.logger.log(`Nuclear Mesh v11: Returning ${servers.length} servers for EP${epNum}`);

      return {
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
    } catch (error) {
      this.logger.error(`Mesh v11 CRITICAL: ${error.message}`);
      return { provider: "mesh-v11-error", servers: [], headers: {} };
    }
  }

  /**
   * Internal: try to extract native .m3u8 sources via consumet providers.
   * All CDN URLs are rewritten through the backend proxy to bypass browser CORS restrictions.
   */
  private async extractNativeSources(title: string, epNum: number, anilistId: number, proxyBaseUrl?: string): Promise<any[]> {
    const nativeServers: any[] = [];

    /**
     * Rewrites a raw CDN URL to go through the backend proxy.
     * This is the key fix for CORS errors: instead of the browser fetching
     * hls.krussdomi.com or kwik.cx directly (which they block), all
     * requests go through our server which can set the correct Referer.
     */
    const toProxiedUrl = (rawUrl: string, referer: string): string => {
      if (!proxyBaseUrl || !rawUrl) return rawUrl;
      // Pass referer as query param so the proxy knows which headers to use
      return `${proxyBaseUrl}/${rawUrl}?referer=${encodeURIComponent(referer)}`;
    };

    try {
      this.logger.debug(`Native extraction attempt: "${title}" EP${epNum}`);

      // Search across all consumet providers simultaneously
      const searchResults = await Promise.race([
        this.consumetService.search(title),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 8000))
      ]).catch(() => []);

      if (!searchResults?.length) return [];

      // Try AnimePahe first (most reliable native source)
      const paheResult = searchResults.find(r => r.provider === 'animepahe');
      if (paheResult) {
        try {
          const paheEpId = await this.consumetService.resolveEpisodeId(paheResult.id, epNum, 'animepahe');
          if (paheEpId) {
            const sources = await Promise.race([
              this.consumetService.getEpisodeSources(paheEpId, 'animepahe'),
              new Promise<any>((resolve) => setTimeout(() => resolve(null), 10000))
            ]);
            if (sources?.sources?.length) {
              const paheReferer = sources.headers?.Referer || 'https://animepahe.com/';
              const proxiedSources = sources.sources.map((s: any) => ({
                ...s,
                url: toProxiedUrl(s.url, paheReferer)
              }));
              nativeServers.push({
                name: 'Native 1 (AnimePahe - HQ)',
                url: proxiedSources[0].url,
                sources: proxiedSources,
                provider: 'animepahe',
                isNative: true,
                headers: sources.headers
              });
              this.logger.log(`Native AnimePahe extraction SUCCESS for EP${epNum}`);
            }
          }
        } catch (e) {
          this.logger.warn(`AnimePahe native extraction failed: ${e.message}`);
        }
      }

      // Try KickAssAnime as secondary native source
      const kaaResult = searchResults.find(r => r.provider === 'kickassanime');
      if (kaaResult) {
        try {
          const kaaEpId = await this.consumetService.resolveEpisodeId(kaaResult.id, epNum, 'kickassanime');
          if (kaaEpId) {
            const sources = await Promise.race([
              this.consumetService.getEpisodeSources(kaaEpId, 'kickassanime'),
              new Promise<any>((resolve) => setTimeout(() => resolve(null), 10000))
            ]);
            if (sources?.sources?.length) {
              const kaaReferer = sources.headers?.Referer || 'https://kaa.lt/';
              const proxiedSources = sources.sources.map((s: any) => ({
                ...s,
                url: toProxiedUrl(s.url, kaaReferer)
              }));
              nativeServers.push({
                name: 'Native 2 (KickAssAnime)',
                url: proxiedSources[0].url,
                sources: proxiedSources,
                provider: 'kickassanime',
                isNative: true,
                headers: sources.headers
              });
              this.logger.log(`Native KAA extraction SUCCESS for EP${epNum}`);
            }
          }
        } catch (e) {
          this.logger.warn(`KAA native extraction failed: ${e.message}`);
        }
      }

      // Try Anify as tertiary native source (fastest .m3u8 provider)
      const anifyResult = searchResults.find(r => r.provider === 'anify');
      if (anifyResult) {
        try {
          this.logger.debug(`Trying Anify native for: ${anifyResult.id}`);
          const res = await axios.get(`https://api.anify.tv/sources?id=${anifyResult.id}&episodeNumber=${epNum}&providerId=gogoanime&watchId=${anifyResult.id}&subType=sub`, { timeout: 6000 });
          if (res.data?.sources?.length) {
            const sources = res.data.sources.map((s: any) => ({
              url: toProxiedUrl(s.url, 'https://anify.tv/'),
              quality: s.quality,
              isM3U8: s.url.includes('.m3u8')
            }));
            nativeServers.push({
              name: 'Native 3 (Anify - Fast)',
              url: sources[0].url,
              sources,
              provider: 'anify',
              isNative: true,
              headers: { Referer: 'https://anify.tv/' }
            });
            this.logger.log(`Native Anify extraction SUCCESS for EP${epNum}`);
          }
        } catch (e) {
          this.logger.warn(`Anify native extraction failed: ${e.message}`);
        }
      }
    } catch (e) {
      this.logger.warn(`Native extraction failed: ${e.message}`);
    }

    return nativeServers;
  }
}
