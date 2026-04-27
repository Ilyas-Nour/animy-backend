import {
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { ConsumetService } from "./consumet.service";
import { StreamingProxyService } from "./streaming.proxy.service";
import { IdMappingService } from "./id-mapping.service";

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);

  constructor(
    private readonly consumetService: ConsumetService,
    private readonly streamingProxyService: StreamingProxyService,
    private readonly idMappingService: IdMappingService,
  ) {}

  /**
   * Search for an anime on the streaming provider
   */
  async searchAnime(query: string) {
    const results = await this.consumetService.search(query);
    return {
      provider: "mesh-v4",
      results: results || [],
    };
  }

  /**
   * Get detailed anime info (episodes, etc)
   */
  async getAnimeInfo(animeId: string) {
    try {
      this.logger.debug(`Fetching info for ${animeId} from AllAnime Mesh`);
      const info = await this.consumetService.getAnimeInfo(animeId);

      if (!info) {
        throw new NotFoundException(`Anime not found on stable nodes`);
      }

      return {
        provider: "mesh-v4",
        ...info,
      };
    } catch (error) {
      this.logger.error(`Error fetching anime info: ${error.message}`);
      throw new HttpException(
        `Failed to fetch info: ${error.message}`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /**
   * Get streaming links for an episode
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
      this.logger.debug(`Fetching sources for ${episodeId} (MAL: ${malId}, TMDB: ${tmdbId})`);
      
      const streamData = await this.consumetService.getEpisodeSources(episodeId, provider);

      // Build the servers list for the frontend
      const servers: any[] = [];
      
      // 1. Add High-Speed HLS (Primary Node)
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
          name: 'Main (High Speed)',
          sources: updatedSources,
          provider: provider,
          isNative: true
        });
      }

      // 2. Add New Verified 2026 Mirrors (TMDB + MAL Hybrid)
      if ((malId || tmdbId) && episodeNumber) {
        // Use TMDB ID if available (it's more stable for VidSrc 2026)
        const primaryId = tmdbId || malId;
        
        servers.push({
          name: 'Mirror (VidSrc.su)',
          url: `https://vidsrc-embed.su/embed/tv/${primaryId}/1-${episodeNumber}`,
          provider: 'vidsrc-su'
        });

        servers.push({ 
          name: 'Mirror (VidLink)', 
          url: `https://vidlink.pro/anime/${primaryId}/${episodeNumber}/sub?primaryColor=6366f1&fallback=true`,
          provider: 'vidlink'
        });
        
        // If we have both, add the other one as a backup
        if (tmdbId && malId && tmdbId !== malId) {
             servers.push({
                name: 'Mirror (MAL ID)',
                url: `https://vidsrc-embed.su/embed/tv/${malId}/1-${episodeNumber}`,
                provider: 'vidsrc-mal'
            });
        }
      }

      return {
        provider: "mesh-v4",
        sources: streamData?.sources || [],
        servers: servers,
        headers: streamData?.headers
      };
    } catch (error) {
      this.logger.error(`Mesh-v4 failure: ${error.message}`);
      
      const primaryId = tmdbId || malId;
      if (primaryId && episodeNumber) {
        return {
          provider: "failover",
          sources: [],
          servers: [
            { name: 'Emergency (VidSrc)', url: `https://vidsrc-embed.su/embed/tv/${primaryId}/1-${episodeNumber}`, provider: 'vidsrc-su' },
            { name: 'Emergency (VidLink)', url: `https://vidlink.pro/anime/${primaryId}/${episodeNumber}/sub?primaryColor=6366f1&fallback=true`, provider: 'vidlink' }
          ]
        };
      }

      throw new HttpException("Mesh Offline", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async proxyStream(url: string, referer: string, res: any, req?: any) {
    return this.streamingProxyService.proxy(url, referer, res, req);
  }

  async findAnimeByTitle(title: string, titleEnglish?: string, anilistId?: number) {
    try {
      const results = await this.consumetService.search(title);
      return results;
    } catch (error) {
      this.logger.error(`Search failed for ${title}`, error.message);
      return [];
    }
  }
}
