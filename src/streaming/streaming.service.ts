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
   * Resilience Mesh v7.8: "The Surgical Clean"
   * Only uses providers that are verified working TODAY.
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
      const aniListId = parseInt(malIdParam || (episodeId.length > 5 ? episodeId : ""), 10);
      const epNum = parseInt(episodeNumber || "1", 10);
      const activeAniListId = !isNaN(aniListId) ? aniListId : null;
      
      this.logger.debug(`Mesh-v7.8 surgical-clean: ID=${episodeId}, EP=${epNum}`);
      
      // 1. Instant MAL ID Resolution (with 1s Cutoff)
      const malId = await Promise.race([
        this.mappingService.getMalId(activeAniListId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200))
      ]).catch(() => null);

      const targetId = malId || activeAniListId;
      const servers: any[] = [];

      // 2. VERIFIED WORKING TODAY MIRRORS
      if (targetId) {
        // A. VidLink (Current #1 Leader)
        servers.push({
          name: 'Mirror 1 (VidLink)',
          url: `https://vidlink.pro/anime/${targetId}/${epNum}?fallback=true`,
          provider: 'mirror',
          isNative: false
        });

        // B. VidSrc.me (High Stability)
        servers.push({
          name: 'Mirror 2 (VidSrc.me)',
          url: `https://vidsrc.me/embed/anime?mal_id=${targetId}&episode=${epNum}`,
          provider: 'mirror',
          isNative: false
        });

        // C. VidSrc.su (Premium Fallback)
        servers.push({
          name: 'Mirror 3 (VidSrc.su)',
          url: `https://vidsrc.su/embed/anime/${targetId}/${epNum}`,
          provider: 'mirror',
          isNative: false
        });
      }

      // 3. NATIVE MIRROR (ANIKAI/MEGAUP) - ONLY IF TITLE EXISTS
      if (activeAniListId && title) {
        try {
          const kaiId = await this.mappingService.resolveAnikaiId(activeAniListId, title).catch(() => null);
          if (kaiId) {
            const watchId = await this.consumetService.resolveEpisodeId(kaiId, epNum, 'animekai').catch(() => null);
            if (watchId) {
              const kaiSources = await this.consumetService.getAnimeKaiSources(watchId).catch(() => null);
              if (kaiSources?.sources?.length) {
                servers.push({ 
                  name: 'Mirror 4 (MegaUp/Native)', 
                  sources: kaiSources.sources, 
                  provider: "animekai", 
                  isNative: true 
                });
              }
            }
          }
        } catch (e) {}
      }

      return {
        provider: "mesh-v7.8-clean",
        servers: servers,
        headers: {}
      };
    } catch (error) {
      this.logger.error(`Mesh-v7.8 failure: ${error.message}`);
      return { provider: "mesh-v7.8-error", servers: [], headers: {} };
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
