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
   * Resilience Mesh v7.6: "The Deep-Resolve Engine"
   * Fixes issues where episodeId is virtual (e.g. "1") or Anify is down.
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
      const isVirtualId = episodeId.length < 5 || !isNaN(Number(episodeId));
      const activeAniListId = !isNaN(aniListId) ? aniListId : null;
      
      this.logger.debug(`Mesh-v7.6 deep-resolve: ID=${episodeId}, Title=${title}, EP=${epNum}, isVirtual=${isVirtualId}`);
      
      const servers: any[] = [];
      const malId = activeAniListId ? await this.mappingService.getMalId(activeAniListId) : null;
      const targetId = malId || activeAniListId;

      this.logger.debug(`Mesh-v7.7 True-ID: AniList=${activeAniListId} -> MAL=${malId}`);

      // --- LAYER 1: CACHE CHECK ---
      if (activeAniListId) {
        const cachedAnify = await this.cacheService.getCachedLinks(activeAniListId, epNum, 'anify');
        if (cachedAnify) {
          servers.push({ name: 'Main (High Speed - Cached)', ...(cachedAnify as any), isNative: true });
        }
      }

      // --- LAYER 2: VERIFIED MIRRORS (ID-BASED) - PRIORITIZED FOR STABILITY ---
      if (targetId) {
        // A. VidLink (Ultra Reliable)
        servers.push({
          name: 'Mirror 1 (VidLink)',
          url: `https://vidlink.pro/anime/${targetId}/${epNum}?fallback=true`,
          provider: 'mirror',
          isNative: false
        });

        // B. VidSrc.me (Classic)
        servers.push({
          name: 'Mirror 2 (VidSrc.me)',
          url: `https://vidsrc.me/embed/anime?mal_id=${targetId}&episode=${epNum}`,
          provider: 'mirror',
          isNative: false
        });

        // C. VidSrc.su (Premium)
        servers.push({
          name: 'Mirror 3 (VidSrc.su)',
          url: `https://vidsrc.su/embed/anime/${targetId}/${epNum}`,
          provider: 'mirror',
          isNative: false
        });
      }

      // --- LAYER 3: PRIMARY RESOLVER (ANIFY) ---
      if (servers.length < 4 && activeAniListId) {
        try {
          const anifyId = await this.mappingService.resolveAnifyId(activeAniListId);
          if (anifyId) {
            let watchId = episodeId;
            if (isVirtualId) {
              const info: any = await this.consumetService.getAnimeInfo(anifyId).catch(() => null);
              const ep = info?.episodes?.find((e: any) => e.number === epNum);
              if (ep) watchId = ep.id;
            }

            const anifyUrl = `https://api.anify.tv/sources?providerId=gogoanime&watchId=${encodeURIComponent(watchId)}&episodeNumber=${epNum}&id=${anifyId}&subType=sub`;
            const anifyRes = await axios.get(anifyUrl, { timeout: 3500 }).catch(() => null);
            if (anifyRes?.data?.sources) {
              const streamData = {
                sources: anifyRes.data.sources.map((s: any) => ({ url: s.url, quality: s.quality || 'auto', isM3U8: true })),
                provider: "anify"
              };
              servers.push({ name: 'Main (High Speed)', ...streamData, isNative: true });
              await this.cacheService.cacheLinks(activeAniListId, epNum, 'anify', streamData);
            }
          }
        } catch (e) {}
      }

      // --- LAYER 4: NATIVE MIRROR (ANIKAI/MEGAUP) ---
      if (servers.length < 5 && activeAniListId && title) {
        try {
          const kaiId = await this.mappingService.resolveAnikaiId(activeAniListId, title);
          if (kaiId) {
            // Resolve actual episode ID for Anikai
            const watchId = await this.consumetService.resolveEpisodeId(kaiId, epNum, 'animekai');
            if (watchId) {
              const kaiSources = await this.consumetService.getAnimeKaiSources(watchId).catch(() => null);
              if (kaiSources?.sources?.length) {
                servers.push({ name: 'Mirror 4 (MegaUp/Native)', sources: kaiSources.sources, provider: "animekai", isNative: true });
              }
            }
          }
        } catch (e) {}
      }

      // --- LAYER 5: EMERGENCY SCRAPER (HI-ANIME) ---
      if (servers.length < 3) {
        try {
          let targetAnimeId = episodeId;
          if (activeAniListId && title) {
            targetAnimeId = await this.mappingService.resolveHiAnimeId(activeAniListId, title) || episodeId;
          }

          const watchId = await this.consumetService.resolveEpisodeId(targetAnimeId, epNum, 'hianime');
          if (watchId) {
            const streamData = await this.consumetService.getEpisodeSources(watchId, "hianime").catch(() => null);
            if (streamData?.sources?.length) {
              servers.push({
                name: 'Mirror 5 (Direct)',
                sources: streamData.sources,
                provider: "hianime",
                isNative: true
              });
            }
          }
        } catch (e) {}
      }

      return {
        provider: "mesh-v7.6-deep",
        servers: servers,
        headers: {}
      };
    } catch (error) {
      this.logger.error(`Mesh-v7.6 failure: ${error.message}`);
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
