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
   * Resilience Mesh v5: Unified Streaming Resolver
   */
  async getEpisodeLinks(
    episodeId: string,
    provider: string = "animepahe",
    proxyBaseUrl?: string,
    malId?: string,
    episodeNumber?: string,
    tmdbId?: string
  ) {
    try {
      this.logger.debug(`Mesh-v5 Call: ID=${episodeId}, MAL=${malId}, TMDB=${tmdbId}`);
      
      const streamData = await this.consumetService.getEpisodeSources(episodeId, provider);
      const servers: any[] = [];
      
      // 1. Primary Node (HLS via Proxy)
      if (streamData && streamData.sources.length > 0) {
        const referer = streamData.headers.Referer || 'https://animepahe.ru/';
        const updatedSources = streamData.sources.map((s: any) => {
          if (s.url && !s.url.includes("/streaming/proxy")) {
            const baseUrl = proxyBaseUrl || "/api/v1/streaming/proxy";
            s.url = `${baseUrl}?url=${encodeURIComponent(s.url)}&referer=${encodeURIComponent(referer)}`;
          }
          return s;
        });

        servers.push({
          name: 'VidStreaming (HLS)',
          sources: updatedSources,
          provider: provider,
          isNative: true
        });
      }

      // 2. Verified Mirror Cluster (Solid 2026 Solution)
      if (episodeNumber) {
        const cleanTitle = encodeURIComponent(malId ? '' : 'search'); // Title search fallback logic
        const mirrors = [
          { name: 'Mirror 1 (VidSrc.to)', url: `https://vidsrc.to/embed/anime/${malId || episodeId}/${episodeNumber}` },
          { name: 'Mirror 2 (VidSrc.su)', url: `https://vidsrc.su/embed/anime/${malId || episodeId}/${episodeNumber}` },
          { name: 'Mirror 3 (VidLink)', url: `https://vidlink.pro/embed/anime/${malId || episodeId}/${episodeNumber}?primaryColor=6366f1` },
          { name: 'Mirror 4 (Vidsrc.pm)', url: `https://vidsrc.pm/embed/anime/${malId || episodeId}/${episodeNumber}` },
          { name: 'Mirror 5 (Vidsrc.xyz)', url: `https://vidsrc.xyz/embed/anime/${malId || episodeId}/${episodeNumber}` },
        ];

        mirrors.forEach(m => {
          servers.push({
            name: m.name,
            url: m.url,
            provider: 'mirror',
            isNative: false
          });
        });
      }

      return {
        provider: "mesh-v5",
        sources: streamData?.sources || [],
        servers: servers,
        headers: streamData?.headers
      };
    } catch (error) {
      this.logger.error(`Mesh-v5 failure: ${error.message}`);
      
      // Emergency Mirror Cluster
      if (malId && episodeNumber) {
        return {
          provider: "emergency-mesh",
          sources: [],
          servers: [
            { name: 'Emergency 1 (VidSrc.to)', url: `https://vidsrc.to/embed/anime/${malId}/${episodeNumber}`, provider: 'mirror' },
            { name: 'Emergency 2 (VidLink)', url: `https://vidlink.pro/embed/anime/${malId}/${episodeNumber}`, provider: 'mirror' }
          ]
        };
      }
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
          "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
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
