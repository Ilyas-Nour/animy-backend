import { Injectable, Logger } from "@nestjs/common";
import { ConsumetService } from "./consumet.service";

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);

  constructor(private readonly consumetService: ConsumetService) {}

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
        // Most anime mirrors in 2026 use MAL IDs for /embed/anime/ paths
        // or TMDB IDs for /embed/tv/ paths.
        const mirrors = [
          { name: 'Mirror 1 (VidSrc.to)', url: `https://vidsrc.to/embed/anime/${malId || episodeId}/${episodeNumber}` },
          { name: 'Mirror 2 (VidSrc.su)', url: `https://vidsrc.su/embed/anime/${malId || episodeId}/${episodeNumber}` },
          { name: 'Mirror 3 (VidLink)', url: `https://vidlink.pro/embed/anime/${malId || episodeId}/${episodeNumber}` },
          { name: 'Mirror 4 (Vsrc.cc)', url: `https://vidsrc.cc/v2/embed/anime/${malId || episodeId}/${episodeNumber}` },
          { name: 'Mirror 5 (Vidsrc.pm)', url: `https://vidsrc.pm/embed/anime/${malId || episodeId}/${episodeNumber}` },
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

  async findAnime(title: string, titleEnglish?: string, anilistId?: string) {
    this.logger.debug(`Finding Anime: ${title}`);
    
    // Check cache first (implementation omitted for brevity, but recommended)
    
    const results = await this.consumetService.search(title);
    if (results.length > 0) return results;

    if (titleEnglish) {
      const resultsEng = await this.consumetService.search(titleEnglish);
      if (resultsEng.length > 0) return resultsEng;
    }

    return [];
  }
}
