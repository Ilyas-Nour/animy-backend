import {
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { HiAnimeService } from "./hianime.service";
import { StreamingProxyService } from "./streaming.proxy.service";
import { IdMappingService } from "./id-mapping.service";

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);

  constructor(
    private readonly hiAnimeService: HiAnimeService,
    private readonly streamingProxyService: StreamingProxyService,
    private readonly idMappingService: IdMappingService,
  ) {}

  /**
   * Search for an anime on the streaming provider
   */
  async searchAnime(query: string) {
    const results = await this.findAnimeByTitle(query);
    return {
      provider: "universal",
      results: results || [],
    };
  }

  /**
   * Get detailed anime info (episodes, etc)
   */
  async getAnimeInfo(animeId: string) {
    try {
      this.logger.debug(`Fetching info for ${animeId} from Universal Scraper`);
      const info = await this.hiAnimeService.fetchAnimeInfo(animeId);

      if (!info) {
        throw new NotFoundException(`Anime not found on any provider`);
      }

      return {
        provider: "universal",
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
      
      const scraperResult = await this.hiAnimeService.fetchEpisodeSources(episodeId);

      // Build the servers list for the frontend
      const servers: any[] = [];
      
      // 1. Add Scraper Servers (Gogo, AniWatch Mirror)
      if (scraperResult.servers && scraperResult.servers.length > 0) {
        servers.push(...scraperResult.servers);
      }

      // 2. Add External Aggregator Fallbacks if we have MAL ID
      if (malId && episodeNumber) {
        let resolvedMalId = malId;
        if (parseInt(malId, 10) > 100000) {
           const mapping = await this.idMappingService.getMalId(parseInt(malId, 10));
           if (mapping) resolvedMalId = mapping.toString();
        }

        servers.push({ 
          name: 'VidLink (External)', 
          url: `https://vidlink.pro/anime/${resolvedMalId}/${episodeNumber}/sub?primaryColor=6366f1&fallback=true`,
          provider: 'vidlink'
        });

        servers.push({
          name: 'Vidsrc.to',
          url: `https://vidsrc.to/embed/anime/${resolvedMalId}/${episodeNumber}`,
          provider: 'vidsrc'
        });
      }

      return {
        provider: "universal",
        sources: scraperResult.sources || [],
        iframeUrl: scraperResult.iframeUrl || (servers.length > 0 ? servers[0].url : null),
        servers: servers,
        headers: scraperResult.headers
      };
    } catch (error) {
      this.logger.error(`Error fetching sources: ${error.message}`);
      
      // Ultimate Fallback
      if (malId && episodeNumber) {
        return {
          provider: "fallback",
          sources: [],
          iframeUrl: `https://vidlink.pro/anime/${malId}/${episodeNumber}/sub?primaryColor=6366f1&fallback=true`,
          servers: [
            { name: 'VidLink (Safe)', url: `https://vidlink.pro/anime/${malId}/${episodeNumber}/sub?primaryColor=6366f1&fallback=true`, provider: 'vidlink' },
            { name: 'Vidsrc.to', url: `https://vidsrc.to/embed/anime/${malId}/${episodeNumber}`, provider: 'vidsrc' }
          ]
        };
      }

      throw new HttpException("All nodes unreachable", HttpStatus.SERVICE_UNAVAILABLE);
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

      let results = await this.hiAnimeService.search(title);
      if (results.results.length === 0 && titleEnglish) {
        results = await this.hiAnimeService.search(titleEnglish);
      }
      return results.results;
    } catch (error) {
      this.logger.error(`Search failed for ${title}`, error.message);
      return [];
    }
  }
}
