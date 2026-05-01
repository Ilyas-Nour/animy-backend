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
   * Nuclear Mesh v10.0 — "Always Streaming"
   *
   * Builds a large set of working mirrors across multiple strategies:
   *  Tier 1 — Iframe embeds using AniList ID (no extra lookup needed, instant)
   *  Tier 2 — Iframe embeds using TMDB ID (high quality)
   *  Tier 3 — Native .m3u8 extraction via consumet (best quality, sometimes fails)
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

      this.logger.log(`Nuclear Mesh v10: AL=${anilistId}, EP=${epNum}, Title="${title}"`);

      const servers: any[] = [];

      // ──────────────────────────────────────────────────────────────────────
      // TIER 1: AniList-based embeds (INSTANT — no lookup needed)
      // ──────────────────────────────────────────────────────────────────────
      if (!isNaN(anilistId) && anilistId > 0) {

        // 2anime.ru — supports AniList IDs natively
        servers.push({
          name: 'Mirror 1 (2anime)',
          url: `https://2anime.xyz/embed/ep?anilist=${anilistId}&ep=${epNum}`,
          provider: 'mirror',
          isNative: false
        });

        // Anivibe embed
        servers.push({
          name: 'Mirror 2 (Anivibe)',
          url: `https://anivibe.net/embed?anilist=${anilistId}&ep=${epNum}`,
          provider: 'mirror',
          isNative: false
        });

        // VidSrc.me — correct working format for anime (uses anilist param)
        servers.push({
          name: 'Mirror 3 (VidSrc.me)',
          url: `https://vidsrc.me/embed/anime?anilist=${anilistId}&episode=${epNum}`,
          provider: 'mirror',
          isNative: false
        });

        // Miruro embed (anilist-based)
        servers.push({
          name: 'Mirror 4 (Miruro)',
          url: `https://www.miruro.tv/watch?id=${anilistId}&ep=${epNum}`,
          provider: 'mirror',
          isNative: false
        });

        // AniWave embed (anilist)
        servers.push({
          name: 'Mirror 5 (AniWave)',
          url: `https://aniwave.to/watch/anime.${anilistId}/ep-${epNum}`,
          provider: 'mirror',
          isNative: false
        });
      }

      // ──────────────────────────────────────────────────────────────────────
      // TIER 2: TMDB-based embeds (lookup in parallel, don't block Tier 1)
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

        // VidSrc.to — most stable TMDB mirror
        servers.push({
          name: 'Mirror 6 (VidSrc.to)',
          url: `https://vidsrc.to/embed/tv/${tmdbId}/1/${epNum}`,
          provider: 'mirror',
          isNative: false
        });

        // VidLink.pro
        servers.push({
          name: 'Mirror 7 (VidLink)',
          url: `https://vidlink.pro/tv/${tmdbId}/1/${epNum}`,
          provider: 'mirror',
          isNative: false
        });

        // Embed.su
        servers.push({
          name: 'Mirror 8 (Embed.su)',
          url: `https://embed.su/embed/tv/${tmdbId}/1/${epNum}`,
          provider: 'mirror',
          isNative: false
        });

        // SuperEmbed
        servers.push({
          name: 'Mirror 9 (SuperEmbed)',
          url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=1&e=${epNum}`,
          provider: 'mirror',
          isNative: false
        });
      }

      // ──────────────────────────────────────────────────────────────────────
      // TIER 3: Native .m3u8 extraction via consumet (best quality)
      // All raw CDN URLs are rewritten through our backend proxy to bypass CORS
      // ──────────────────────────────────────────────────────────────────────
      if (title) {
        try {
          const nativeServers = await Promise.race([
            this.extractNativeSources(title, epNum, anilistId, proxyBaseUrl),
            new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 8000))
          ]);
          if (nativeServers.length > 0) {
            servers.unshift(...nativeServers); // Native sources go FIRST (best quality)
          }
        } catch (e) {}
      }

      this.logger.log(`Nuclear Mesh v10: Returning ${servers.length} servers for EP${epNum}`);

      return {
        provider: "mesh-v10-nuclear",
        servers,
        anilistId,
        tmdbId: tmdbId || null,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://animepahe.com/'
        }
      };
    } catch (error) {
      this.logger.error(`Mesh v10 CRITICAL: ${error.message}`);
      return { provider: "mesh-v10-error", servers: [], headers: {} };
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
      return `${proxyBaseUrl}?url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent(referer)}`;
    };

    try {
      this.logger.debug(`Native extraction attempt: "${title}" EP${epNum}`);

      // Search across all consumet providers simultaneously
      const searchResults = await Promise.race([
        this.consumetService.search(title),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 5000))
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
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000))
            ]);
            if (sources?.sources?.length) {
              const paheReferer = 'https://animepahe.com/';
              // Rewrite all source URLs through the backend proxy to bypass CORS
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
                headers: {} // Headers no longer needed — proxy handles them
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
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000))
            ]);
            if (sources?.sources?.length) {
              const kaaReferer = 'https://kaa.lt/';
              // Rewrite all source URLs through the backend proxy to bypass CORS
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
                headers: {} // Headers no longer needed — proxy handles them
              });
              this.logger.log(`Native KAA extraction SUCCESS for EP${epNum}`);
            }
          }
        } catch (e) {
          this.logger.warn(`KAA native extraction failed: ${e.message}`);
        }
      }
    } catch (e) {
      this.logger.warn(`Native extraction failed: ${e.message}`);
    }

    return nativeServers;
  }

  /**
   * Proxy Stream to bypass CORS and 403s
   */
  async proxyStream(url: string, referer: string, res: any, req: any) {
    try {
      // Auto-detect Referer based on the target domain
      let finalReferer = referer;
      if (!finalReferer) {
        if (url.includes('krussdomi.com') || url.includes('kaa.lt') || url.includes('kickassanime')) finalReferer = 'https://kaa.lt/';
        else if (url.includes('kwik.cx')) finalReferer = 'https://kwik.cx/';
        else if (url.includes('animepahe')) finalReferer = 'https://animepahe.com/';
        else if (url.includes('megaup')) finalReferer = 'https://megaup.nl/';
        else finalReferer = 'https://animy.xyz/';
      } else {
        if (url.includes('krussdomi.com') || url.includes('kaa.lt')) finalReferer = 'https://kaa.lt/';
        if (url.includes('kwik.cx')) finalReferer = 'https://kwik.cx/';
        if (url.includes('animepahe')) finalReferer = 'https://animepahe.com/';
        if (url.includes('megaup')) finalReferer = 'https://megaup.nl/';
      }

      const response = await axios.get(url, {
        headers: {
          Referer: finalReferer,
          "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Origin: new URL(finalReferer || 'https://animepahe.com').origin,
        },
        responseType: "stream",
        timeout: 15000,
      });

      // Forward headers
      res.set("Content-Type", response.headers["content-type"]);
      if (response.headers["content-length"]) {
        res.set("Content-Length", response.headers["content-length"]);
      }
      res.set("Access-Control-Allow-Origin", "*");

      response.data.pipe(res);
    } catch (error) {
      this.logger.error(`Proxy failed for ${url}: ${error.message}`);
      res.status(500).send("Proxy error");
    }
  }
}
