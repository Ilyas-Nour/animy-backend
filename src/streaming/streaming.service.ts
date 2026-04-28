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
      // Use a more robust search endpoint
      const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=5220615c4f292398606c4068305f8841&query=${encodeURIComponent(title)}&language=en-US&page=1&include_adult=false`;
      const res = await axios.get(searchUrl);
      const results = res.data.results || [];
      const bestMatch = results.find((r: any) => r.media_type === 'tv' || r.media_type === 'movie');
      return bestMatch ? bestMatch.id.toString() : null;
    } catch (e) {
      this.logger.warn(`TMDB Resolve Failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Resilience Mesh v7.5: "The Solid Solution" (Caching & Mapping Layer)
   */
  async getEpisodeLinks(
    episodeId: string,
    provider: string = "hianime",
    proxyBaseUrl?: string,
    malIdParam?: string,
    episodeNumber?: string,
    tmdbId?: string,
    title?: string
  ) {
    try {
      const aniListId = parseInt(malIdParam || episodeId, 10);
      const epNum = parseInt(episodeNumber || "1", 10);
      const isNumericId = !isNaN(aniListId);
      
      this.logger.debug(`Mesh-v7.5 resolving: ID=${episodeId}, Title=${title}, EP=${epNum}`);
      
      const servers: any[] = [];

      // --- LAYER 1: CACHE CHECK ---
      if (isNumericId) {
        const cachedAnify = await this.cacheService.getCachedLinks(aniListId, epNum, 'anify');
        if (cachedAnify) {
          servers.push({ name: 'Main (High Speed - Cached)', ...(cachedAnify as any), isNative: true });
        }
        
        const cachedKai = await this.cacheService.getCachedLinks(aniListId, epNum, 'animekai');
        if (cachedKai) {
          servers.push({ name: 'Mirror 2 (MegaUp - Cached)', ...(cachedKai as any), isNative: true });
        }
      }

      // --- LAYER 2: PRIMARY RESOLVER (ANIFY) ---
      if (servers.length === 0 && isNumericId) {
        try {
          const anifyId = await this.mappingService.resolveAnifyId(aniListId);
          if (anifyId) {
            const anifyUrl = `https://api.anify.tv/sources?providerId=gogoanime&watchId=${episodeId}&episodeNumber=${epNum}&id=${anifyId}&subType=sub`;
            const anifyRes = await axios.get(anifyUrl, { timeout: 3500 }).catch(() => null);
            if (anifyRes?.data?.sources) {
              const streamData = {
                sources: anifyRes.data.sources.map((s: any) => ({ url: s.url, quality: s.quality || 'auto', isM3U8: true })),
                provider: "anify"
              };
              servers.push({ name: 'Main (High Speed)', ...streamData, isNative: true });
              await this.cacheService.cacheLinks(aniListId, epNum, 'anify', streamData);
            }
          }
        } catch (e) {
          this.logger.warn(`Anify Resolver failed: ${e.message}`);
        }
      }

      // --- LAYER 3: VERIFIED MIRRORS (MAPPINGS) ---
      if (isNumericId) {
        // A. VidLink (Native Support for MAL IDs)
        servers.push({
          name: 'Mirror 1 (VidLink)',
          url: `https://vidlink.pro/anime/${aniListId}/${epNum}/sub?fallback=true`,
          provider: 'mirror',
          isNative: false
        });

        // B. AnimeKai (MegaUp) - Using Mapping Fallback
        if (!servers.some(s => s.provider === 'animekai')) {
          try {
            const kaiId = title ? await this.mappingService.resolveAnikaiId(aniListId, title) : episodeId;
            const kaiSources = await this.consumetService.getAnimeKaiSources(kaiId, title).catch(() => null);
            if (kaiSources?.sources?.length) {
              const streamData = { sources: kaiSources.sources, provider: "animekai" };
              servers.push({ name: 'Mirror 2 (MegaUp/Anikai)', ...streamData, isNative: true });
              await this.cacheService.cacheLinks(aniListId, epNum, 'animekai', streamData);
            }
          } catch (e) {}
        }

        // C. Standard Mirrors
        servers.push({
          name: 'Mirror 3 (VidSrc.me)',
          url: `https://vidsrc.me/embed/anime?mal_id=${aniListId}&episode=${epNum}`,
          provider: 'mirror',
          isNative: false
        });
      }

      // --- LAYER 4: SCRAPER FALLBACK (HI-ANIME) ---
      if (servers.length < 3) {
        try {
          let targetEpisodeId = episodeId;
          if (isNumericId && title) {
            targetEpisodeId = await this.mappingService.resolveHiAnimeId(aniListId, title) || episodeId;
          }

          const streamData = await this.consumetService.getEpisodeSources(targetEpisodeId, "hianime").catch(() => null);
          if (streamData?.sources?.length) {
            servers.push({
              name: 'Mirror 5 (Legacy)',
              sources: streamData.sources,
              provider: "hianime",
              isNative: true
            });
          }
        } catch (e) {}
      }

      return {
        provider: "mesh-v7.5-solid",
        servers: servers,
        headers: {}
      };
    } catch (error) {
      this.logger.error(`Mesh-v7.5 failure: ${error.message}`);
      return null;
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
