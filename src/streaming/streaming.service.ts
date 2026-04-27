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
   * Resilience Mesh v6.1: Unified Streaming Resolver
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
      this.logger.debug(`Mesh-v6.1 Call: ID=${episodeId}, MAL=${malId}, TMDB=${tmdbId}`);
      
      // Try to resolve TMDB ID if missing (Critical for VidSrc mirrors)
      let finalTmdbId = tmdbId;
      if (!finalTmdbId || finalTmdbId === 'undefined' || finalTmdbId === 'null') {
        const info = await this.consumetService.getAnimeInfo(episodeId);
        const searchTitle = typeof info?.title === 'string' ? info.title : info?.title?.english || info?.title?.romaji;
        if (searchTitle) {
          finalTmdbId = await this.getTmdbId(searchTitle);
        }
      }

      const streamData = await this.consumetService.getEpisodeSources(episodeId, "hianime");
      const servers: any[] = [];
      
      // 1. Primary Node (HLS via Proxy)
      if (streamData && streamData.sources.length > 0) {
        const referer = streamData.headers.Referer || 'https://hianime.to/';
        const updatedSources = streamData.sources.map((s: any) => {
          if (s.url && !s.url.includes("/streaming/proxy")) {
            const baseUrl = proxyBaseUrl || "/api/v1/streaming/proxy";
            s.url = `${baseUrl}?url=${encodeURIComponent(s.url)}&referer=${encodeURIComponent(referer)}`;
          }
          return s;
        });

        servers.push({
          name: 'Main (High Speed)',
          sources: updatedSources,
          provider: "hianime",
          isNative: true
        });
      }

      // 2. Verified 2026 Mirror Cluster (Solid Solution)
      if (episodeNumber) {
        const mirrors = [
          // VIDLINK: NO /embed in the path! Correct: vidlink.pro/anime/{malId}/{ep}
          { name: 'Mirror 1 (VidLink)', url: `https://vidlink.pro/anime/${malId || episodeId}/${episodeNumber}/sub?fallback=true` },
          { name: 'Mirror 2 (VidSrc.su)', url: `https://vidsrc-embed.su/embed/tv/${finalTmdbId || ''}/1-${episodeNumber}` },
          { name: 'Mirror 3 (Vsrc.su)', url: `https://vsrc.su/embed/tv/${finalTmdbId || ''}/1-${episodeNumber}` },
          { name: 'Mirror 4 (Vidsrc.to)', url: `https://vidsrc.to/embed/anime/${malId || episodeId}/${episodeNumber}` },
          { name: 'Mirror 5 (VidSrc.pm)', url: `https://vidsrc.pm/embed/tv/${finalTmdbId || ''}/1-${episodeNumber}` },
        ];

        mirrors.forEach(m => {
          // Skip broken mirrors if ID is missing
          if (m.url.includes('/tv//') && !m.url.includes('vidlink')) return;
          
          servers.push({
            name: m.name,
            url: m.url,
            provider: 'mirror',
            isNative: false
          });
        });
      }

      return {
        provider: "mesh-v6.1",
        sources: streamData?.sources || [],
        servers: servers,
        headers: streamData?.headers
      };
    } catch (error) {
      this.logger.error(`Mesh-v6.1 failure: ${error.message}`);
      
      // Emergency Mirror Cluster (VidLink is most reliable for MAL)
      if (malId && episodeNumber) {
        return {
          provider: "emergency-mesh",
          sources: [],
          servers: [
            { name: 'Emergency 1 (VidLink)', url: `https://vidlink.pro/anime/${malId}/${episodeNumber}/sub?fallback=true`, provider: 'mirror' },
            { name: 'Emergency 2 (VidSrc.to)', url: `https://vidsrc.to/embed/anime/${malId}/${episodeNumber}`, provider: 'mirror' }
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
