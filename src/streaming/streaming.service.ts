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
   * Resilience Mesh v6.2: "Solid Solution" (Mirror-First)
   */
  async getEpisodeLinks(
    episodeId: string,
    provider: string = "hianime",
    proxyBaseUrl?: string,
    malId?: string,
    episodeNumber?: string,
    tmdbId?: string
  ) {
    try {
      this.logger.debug(`Mesh-v6.2 Call: ID=${episodeId}, MAL=${malId}, EP=${episodeNumber}`);
      
      const servers: any[] = [];
      const epNum = episodeNumber || "1";

      // 1. Mirror Cluster (IMMEDIATE - No waiting for scrapers)
      // We resolve TMDB ID in the background or use Title Fallbacks
      const mirrors = [
        { name: 'Mirror 1 (VidLink)', url: `https://vidlink.pro/anime/${malId || ''}/${epNum}/sub?fallback=true` },
        { name: 'Mirror 2 (VidSrc.me)', url: `https://vidsrc.me/embed/anime?mal_id=${malId || ''}&episode=${epNum}` },
        { name: 'Mirror 3 (VidSrc.su)', url: `https://vidsrc.su/embed/anime/${malId || ''}/${epNum}` },
        { name: 'Mirror 4 (Vidsrc.xyz)', url: `https://vidsrc.xyz/embed/anime/${malId || ''}/${epNum}` },
        { name: 'Mirror 5 (VidSrc.pm)', url: `https://vidsrc.pm/embed/anime/${malId || ''}/${epNum}` },
      ];

      mirrors.forEach(m => {
        if (m.url.includes('undefined') || (!malId && m.url.includes('mal_id='))) return;
        servers.push({
          name: m.name,
          url: m.url,
          provider: 'mirror',
          isNative: false
        });
      });

      // 2. Primary Node (Attempt in parallel/background to avoid blocking)
      // For now, we attempt it but don't let it block the mirrors if it fails
      try {
        const streamData = await this.consumetService.getEpisodeSources(episodeId, "hianime").catch(() => null);
        if (streamData && streamData.sources.length > 0) {
          const referer = streamData.headers.Referer || 'https://hianime.to/';
          const updatedSources = streamData.sources.map((s: any) => {
            if (s.url && !s.url.includes("/streaming/proxy")) {
              const baseUrl = proxyBaseUrl || "/api/v1/streaming/proxy";
              s.url = `${baseUrl}?url=${encodeURIComponent(s.url)}&referer=${encodeURIComponent(referer)}`;
            }
            return s;
          });

          servers.unshift({
            name: 'Main Node (HLS)',
            sources: updatedSources,
            provider: "hianime",
            isNative: true
          });
        }
      } catch (e) {
        this.logger.warn(`Primary node failed: ${e.message}`);
      }

      return {
        provider: "mesh-v6.2",
        sources: [],
        servers: servers,
        headers: {}
      };
    } catch (error) {
      this.logger.error(`Mesh-v6.2 failure: ${error.message}`);
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
