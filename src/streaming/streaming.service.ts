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
   * Resolve TMDB ID from title (Fallback for mirrors)
   */
  async getTmdbId(title: string): Promise<string | null> {
    try {
      this.logger.debug(`Resolving TMDB ID for: ${title}`);
      
      // 1. Try Anify Mapping First (Fast & Keyless)
      try {
        const anifyUrl = `https://api.anify.tv/search/anime/${encodeURIComponent(title)}`;
        const anifyRes = await axios.get(anifyUrl, { timeout: 3000 }).catch(() => null);
        const match = anifyRes?.data?.results?.find((r: any) => r.mappings?.tmdb);
        if (match) return match.mappings.tmdb.toString();
      } catch (e) {}

      // 2. TMDB Search API (Fallback)
      const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=5220615c4f292398606c4068305f8841&query=${encodeURIComponent(title)}&language=en-US&page=1&include_adult=false`;
      const res = await axios.get(searchUrl).catch(() => null);
      if (res?.data?.results?.length) {
        const bestMatch = res.data.results.find((r: any) => r.media_type === 'tv' || r.media_type === 'movie');
        if (bestMatch) return bestMatch.id.toString();
      }
      
      return null;
    } catch (e) {
      this.logger.warn(`TMDB Resolve Failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Resilience Mesh v8.1: "Stable Discovery"
   * Finds anime info without relying on dead providers.
   */
  /**
   * Resilience Mesh v8.2: "Instant Discovery"
   * Immediately returns the AniList ID to keep the UI responsive.
   */
  async findAnime(title: string, titleEnglish: string, anilistId: string) {
    try {
      this.logger.debug(`Mesh-v8.2 Discovery: ${title} (AL: ${anilistId})`);
      
      // 1. INSTANT FALLBACK (Primary strategy for stability)
      const fallback = {
        id: anilistId,
        title: titleEnglish || title,
        provider: "anilist"
      };

      // 2. SILENT SEARCH (2s Cutoff)
      // We try to find a better provider ID, but we don't wait forever.
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
   * Resilience Mesh v8.2: "Final Revival"
   * Zero-Wait mirror generation.
   */
  /**
   * Resilience ID Mapper: AniList -> MAL
   */
  async resolveMalId(anilistId: number): Promise<number | null> {
    try {
      this.logger.debug(`Resolving MAL ID for AniList: ${anilistId}`);
      const res = await axios.get(`https://api.malsync.moe/mal/anime/anilist:${anilistId}`, { timeout: 3000 });
      return res.data?.id || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Resilience Mesh v8.8: "Omni-Mirror"
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
      
      this.logger.debug(`Resilience Mesh v8.8: AL=${anilistId}, EP=${epNum}, Title=${title}`);
      
      const servers: any[] = [];

      // 1. RESOLVE MAPPINGS
      let resolvedMalId = anilistId;
      if (!isNaN(anilistId)) {
        const mapping = await this.resolveMalId(anilistId).catch(() => null);
        if (mapping) resolvedMalId = mapping;
      }

      let resolvedTmdbId = tmdbIdParam;
      if (!resolvedTmdbId && title) {
        resolvedTmdbId = await this.getTmdbId(title).catch(() => null);
      }

      // 2. PARALLEL RESOLUTION (Native + High-Stability Mirrors)
      const resolutionResults = await Promise.all([
        // Mirror 1: Anikai (Verified)
        (async () => {
          try {
            const kaiId = await this.mappingService.resolveAnikaiId(anilistId, title).catch(() => null);
            if (!kaiId) return null;
            const watchId = await this.consumetService.resolveEpisodeId(kaiId, epNum, 'animekai').catch(() => null);
            if (!watchId) return null;
            const res = await this.consumetService.getAnimeKaiSources(watchId).catch(() => null);
            return res?.sources?.length ? { name: 'Mirror 1 (MegaUp - Anikai)', sources: res.sources, provider: 'animekai', isNative: true } : null;
          } catch (e) { return null; }
        })(),
        // Mirror 2: KAA (Verified)
        (async () => {
          try {
            const kaaId = await this.consumetService.search(title).then(results => results.find(r => r.provider === 'kickassanime')?.id).catch(() => null);
            if (!kaaId) return null;
            const kaaEpId = await this.consumetService.resolveEpisodeId(kaaId, epNum, 'kickassanime').catch(() => null);
            if (!kaaEpId) return null;
            const res = await this.consumetService.getEpisodeSources(kaaEpId, 'kickassanime').catch(() => null);
            return res?.sources?.length ? { name: 'Mirror 2 (VidStreaming - KAA)', sources: res.sources, provider: 'kickassanime', isNative: true } : null;
          } catch (e) { return null; }
        })(),
        // Mirror 3: Anify (Ultra Stable Meta)
        (async () => {
          try {
            const res = await axios.get(`https://api.anify.tv/sources?id=${anilistId}&episodeNumber=${epNum}&subType=sub`, { timeout: 5000 });
            const sources = res.data?.sources?.map((s: any) => ({ url: s.url, quality: 'auto' })) || [];
            return sources.length ? { name: 'Mirror 3 (Anify - Multi)', sources: sources, provider: 'anify', isNative: true } : null;
          } catch (e) { return null; }
        })()
      ]);

      resolutionResults.filter(r => r !== null).forEach(r => servers.push(r));

      // 3. ID-ALIGNED STATIC MIRRORS
      if (!isNaN(anilistId)) {
        servers.push({
          name: 'Mirror 4 (VidSrc.icu)',
          url: `https://vidsrc.icu/embed/anime/${anilistId}/${epNum}/0`,
          provider: 'mirror',
          isNative: false
        });

        servers.push({
          name: 'Mirror 5 (VidSrc.pm)',
          url: `https://vidsrc.pm/embed/anime/${anilistId}/${epNum}/0`,
          provider: 'mirror',
          isNative: false
        });
      }

      if (resolvedTmdbId) {
        servers.push({
          name: 'Mirror 6 (VidSrc.to)',
          url: `https://vidsrc.to/embed/tv/${resolvedTmdbId}/1/${epNum}`,
          provider: 'mirror',
          isNative: false
        });
      }

      return {
        provider: "mesh-v8.9-anify",
        servers: servers,
        anilistId,
        resolvedMalId,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        }
      };
    } catch (error) {
      this.logger.error(`Mesh v8.9 critical error: ${error.message}`);
      return { provider: "mesh-v8.9-error", servers: [], headers: {} };
    }
  }

  /**
   * Proxy Stream to bypass CORS and 403s
   */
  async proxyStream(url: string, referer: string, res: any, req: any) {
    try {
      // Auto-detect Referer if not provided or for specific domains
      let finalReferer = referer;
      if (url.includes('kwik.cx')) finalReferer = 'https://kwik.cx/';
      if (url.includes('animepahe')) finalReferer = 'https://animepahe.ru/';
      if (url.includes('megaup')) finalReferer = 'https://megaup.nl/';

      const response = await axios.get(url, {
        headers: {
          Referer: finalReferer,
          "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
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
