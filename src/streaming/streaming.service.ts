import { Injectable, Logger } from "@nestjs/common";
import { ConsumetService } from "./consumet.service";
import axios from "axios";

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);

  constructor(private readonly consumetService: ConsumetService) {}

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
   * Resilience Mesh v7.3: MegaUp/Anikai Edition
   */
  async getEpisodeLinks(
    episodeId: string,
    provider: string = "hianime",
    proxyBaseUrl?: string,
    malIdParam?: string,
    episodeNumber?: string,
    tmdbId?: string
  ) {
    try {
      const malId = (malIdParam && malIdParam !== 'undefined' && malIdParam !== 'null' && malIdParam !== '0') ? malIdParam : null;
      const epNum = episodeNumber || "1";
      this.logger.debug(`Mesh-v7.2 Call: ID=${episodeId}, MAL=${malId}, EP=${epNum}`);
      
      const servers: any[] = [];

      // 1. ANIFY.TV (Primary Resolver)
      // If we have a malId/anilistId, this is the most reliable way to get sources
      const anilistId = malId || ((episodeId.length > 5 && !episodeId.includes('-')) ? episodeId : tmdbId);
      if (anilistId && anilistId !== 'undefined') {
        try {
          const anifyUrl = `https://api.anify.tv/sources?providerId=gogoanime&watchId=${episodeId}&episodeNumber=${epNum}&id=${anilistId}&subType=sub`;
          const anifyRes = await axios.get(anifyUrl, { timeout: 4000 }).catch(() => null);
          if (anifyRes?.data?.sources) {
            servers.push({
              name: 'Main (High Speed)',
              sources: anifyRes.data.sources.map((s: any) => ({ url: s.url, quality: s.quality || 'auto', isM3U8: true })),
              provider: "anify",
              isNative: true
            });
          }
        } catch (e) {}
      }

      // 2. VERIFIED MIRRORS (The Solid Backup)
      if (malId) {
        servers.push({
          name: 'Mirror 1 (VidLink)',
          url: `https://vidlink.pro/anime/${malId}/${epNum}/sub?fallback=true`,
          provider: 'mirror',
          isNative: false
        });

        // 🚀 AnimeKai (MegaUp) - NEW PREMIUM MIRROR
        try {
          const kaiSources = await this.consumetService.getAnimeKaiSources(episodeId).catch(() => null);
          if (kaiSources?.sources?.length) {
            servers.push({
              name: 'Mirror 2 (MegaUp/Anikai)',
              sources: kaiSources.sources,
              provider: "animekai",
              isNative: true
            });
          }
        } catch (e) {}

        servers.push({
          name: 'Mirror 3 (VidSrc.me)',
          url: `https://vidsrc.me/embed/anime?mal_id=${malId}&episode=${epNum}`,
          provider: 'mirror',
          isNative: false
        });
        servers.push({
          name: 'Mirror 4 (VidSrc.su)',
          url: `https://vidsrc.su/embed/anime/${malId}/${epNum}`,
          provider: 'mirror',
          isNative: false
        });
      }

      // 3. LEGACY NODE (Consumet)
      if (servers.length < 2) {
        try {
          const streamData = await this.consumetService.getEpisodeSources(episodeId, "hianime").catch(() => null);
          if (streamData?.sources?.length) {
            servers.push({
              name: 'Mirror 4 (Legacy)',
              sources: streamData.sources,
              provider: "hianime",
              isNative: true
            });
          }
        } catch (e) {}
      }

      return {
        provider: "mesh-v7.3",
        sources: [],
        servers: servers,
        headers: {}
      };
    } catch (error) {
      this.logger.error(`Mesh-v7.3 failure: ${error.message}`);
      return null;
    }
  }

  /**
   * Proxy Stream to bypass CORS and 403s
   */
  async proxyStream(url: string, referer: string, res: any, req: any) {
    try {
      const response = await axios.get(url, {
        headers: {
          Referer: referer,
          "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        },
        responseType: "stream",
        timeout: 10000,
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
