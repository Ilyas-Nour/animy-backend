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
      provider: "consumet",
      results: results || [],
    };
  }

  /**
   * Get detailed anime info (episodes, etc)
   */
  async getAnimeInfo(animeId: string) {
    try {
      this.logger.debug(`Fetching info for ${animeId} from Consumet Mesh`);
      const info = await this.consumetService.getAnimeInfo(animeId);

      if (!info) {
        throw new NotFoundException(`Anime not found on current nodes`);
      }

      return {
        provider: "consumet",
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
    provider: string = "hianime",
    proxyBaseUrl?: string,
    malId?: string,
    episodeNumber?: string,
  ) {
    try {
      this.logger.debug(`Fetching sources for ${episodeId} (MAL: ${malId}, EP: ${episodeNumber})`);
      
      const streamData = await this.consumetService.getEpisodeSources(episodeId, provider as any);

      // Build the servers list for the frontend
      const servers: any[] = [];
      
      // 1. Add Consumet Native HLS Sources (Ultra-Low Latency)
      if (streamData && streamData.sources.length > 0) {
        const referer = streamData.headers.Referer || '';
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
          provider: 'consumet',
          isNative: true
        });
      }

      // 2. Add Industry-Standard External Backups (2026 Resilience)
      if (malId && episodeNumber) {
        let resolvedMalId = malId;
        if (parseInt(malId, 10) > 100000) {
           const mapping = await this.idMappingService.getMalId(parseInt(malId, 10));
           if (mapping) resolvedMalId = mapping.toString();
        }

        // Vidsrc.me - The most stable backup for MAL IDs
        servers.push({
          name: 'Mirror (Vidsrc.me)',
          url: `https://vidsrc.me/embed/anime?mal=${resolvedMalId}&episode=${episodeNumber}`,
          provider: 'vidsrc-me'
        });

        // VidLink - Good secondary fallback
        servers.push({ 
          name: 'Mirror (VidLink)', 
          url: `https://vidlink.pro/anime/${resolvedMalId}/${episodeNumber}/sub?primaryColor=6366f1&fallback=true`,
          provider: 'vidlink'
        });
      }

      return {
        provider: "mesh",
        sources: streamData?.sources || [],
        servers: servers,
        headers: streamData?.headers
      };
    } catch (error) {
      this.logger.error(`Node Mesh failure: ${error.message}`);
      
      // Critical Failover
      if (malId && episodeNumber) {
        return {
          provider: "failover",
          sources: [],
          servers: [
            { name: 'Emergency (Vidsrc)', url: `https://vidsrc.me/embed/anime?mal=${malId}&episode=${episodeNumber}`, provider: 'vidsrc-me' },
            { name: 'Emergency (VidLink)', url: `https://vidlink.pro/anime/${malId}/${episodeNumber}/sub?primaryColor=6366f1&fallback=true`, provider: 'vidlink' }
          ]
        };
      }

      throw new HttpException("Mesh Offline - No active nodes", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async proxyStream(url: string, referer: string, res: any, req?: any) {
    return this.streamingProxyService.proxy(url, referer, res, req);
  }

  async findAnimeByTitle(title: string, titleEnglish?: string, anilistId?: number) {
    try {
      if (anilistId) {
        const resolvedId = await this.idMappingService.resolveHiAnimeId(anilistId, title, titleEnglish);
        if (resolvedId) return [{ id: resolvedId, title: title, image: "" }];
      }

      const results = await this.consumetService.search(title);
      return results;
    } catch (error) {
      this.logger.error(`Search failed for ${title}`, error.message);
      return [];
    }
  }
}
