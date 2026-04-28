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
      // Priority: malIdParam (AniList ID)
      const aniListId = parseInt(malIdParam || (!isNaN(Number(episodeId)) ? episodeId : ""), 10);
      const epNum = parseInt(episodeNumber || "1", 10);
      const activeAniListId = !isNaN(aniListId) ? aniListId : null;
      
      this.logger.debug(`Mesh-v8.2 streaming: AL=${activeAniListId}, EP=${epNum}`);
      
      const servers: any[] = [];

      // 1. INDESTRUCTIBLE MIRRORS (Zero-Wait)
      if (activeAniListId) {
        // A. VidLink
        servers.push({
          name: 'Mirror 1 (VidLink)',
          url: `https://vidlink.pro/embed/anime/${activeAniListId}/${epNum}?primaryColor=6366f1`,
          provider: 'mirror',
          isNative: false
        });

        // B. VidSrc.me
        servers.push({
          name: 'Mirror 2 (VidSrc.me)',
          url: `https://vidsrc.me/embed/anime?mal_id=${activeAniListId}&episode=${epNum}`,
          provider: 'mirror',
          isNative: false
        });

        // C. VidSrc.su
        servers.push({
          name: 'Mirror 3 (VidSrc.su)',
          url: `https://vidsrc.su/embed/anime/${activeAniListId}/${epNum}`,
          provider: 'mirror',
          isNative: false
        });
      }

      // 2. NATIVE MIRROR (ANIKAI) - Background resolve
      if (activeAniListId && title) {
        try {
          const kaiSources = await Promise.race([
            (async () => {
              const kaiId = await this.mappingService.resolveAnikaiId(activeAniListId, title).catch(() => null);
              if (!kaiId) return null;
              const watchId = await this.consumetService.resolveEpisodeId(kaiId, epNum, 'animekai').catch(() => null);
              if (!watchId) return null;
              return this.consumetService.getAnimeKaiSources(watchId).catch(() => null);
            })(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000))
          ]).catch(() => null);

          if (kaiSources?.sources?.length) {
            servers.push({ 
              name: 'Mirror 4 (MegaUp)', 
              sources: kaiSources.sources, 
              provider: "animekai", 
              isNative: true 
            });
          }
        } catch (e) {}
      }

      return {
        provider: "mesh-v8.2-final",
        servers: servers,
        headers: {}
      };
    } catch (error) {
      this.logger.error(`Mesh v8.2 critical error: ${error.message}`);
      return { provider: "mesh-v8.2-error", servers: [], headers: {} };
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
