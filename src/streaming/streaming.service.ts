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
      this.logger.debug(`Fetching info for ${animeId} from Consumet`);
      const info = await this.consumetService.getAnimeInfo(animeId);

      if (!info) {
        throw new NotFoundException(`Anime not found on Consumet`);
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
      
      // 1. Add Consumet Native HLS Sources (Best for Mobile/Speed)
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
          name: 'HLS (Ultra Speed)',
          sources: updatedSources,
          provider: 'consumet',
          isNative: true
        });
      }

      // 2. Add External Aggregator Fallbacks (WidLink, VidSrc)
      if (malId && episodeNumber) {
        let resolvedMalId = malId;
        if (parseInt(malId, 10) > 100000) {
           const mapping = await this.idMappingService.getMalId(parseInt(malId, 10));
           if (mapping) resolvedMalId = mapping.toString();
        }

        servers.push({ 
          name: 'Mirror (VidLink)', 
          url: `https://vidlink.pro/anime/${resolvedMalId}/${episodeNumber}/sub?primaryColor=6366f1&fallback=true`,
          provider: 'vidlink'
        });

        servers.push({
          name: 'Mirror (Vidsrc)',
          url: `https://vidsrc.to/embed/anime/${resolvedMalId}/${episodeNumber}`,
          provider: 'vidsrc'
        });
      }

      return {
        provider: "consumet",
        sources: streamData?.sources || [],
        servers: servers,
        headers: streamData?.headers
      };
    } catch (error) {
      this.logger.error(`Error fetching sources: ${error.message}`);
      
      // Ultimate Fallback
      if (malId && episodeNumber) {
        return {
          provider: "fallback",
          sources: [],
          servers: [
            { name: 'VidLink (Mirror)', url: `https://vidlink.pro/anime/${malId}/${episodeNumber}/sub?primaryColor=6366f1&fallback=true`, provider: 'vidlink' },
            { name: 'Vidsrc (Mirror)', url: `https://vidsrc.to/embed/anime/${malId}/${episodeNumber}`, provider: 'vidsrc' }
          ]
        };
      }

      throw new HttpException("All nodes offline", HttpStatus.SERVICE_UNAVAILABLE);
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
