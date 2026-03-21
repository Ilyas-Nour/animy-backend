import {
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import axios from "axios";
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
   * @param query - Anime title to search
   */
  async searchAnime(query: string) {
    try {
      this.logger.debug(`Searching for "${query}" on HiAnime`);
      const results = await this.hiAnimeService.search(query);
      return {
        provider: "hianime",
        results: results.results || [],
      };
    } catch (error) {
      this.logger.error(`Error searching anime on HiAnime:`, error);
      return { provider: "hianime", results: [] };
    }
  }

  /**
   * Get detailed anime info (episodes, etc)
   * @param animeId - Provider-specific anime ID
   */
  async getAnimeInfo(animeId: string) {
    try {
      this.logger.debug(`Fetching info for ${animeId} from HiAnime`);
      const info = await this.hiAnimeService.fetchAnimeInfo(animeId);

      if (!info) {
        throw new NotFoundException(`Anime not found on HiAnime`);
      }

      return {
        provider: "hianime",
        ...info,
      };
    } catch (error) {
      this.logger.error(
        `Error fetching anime info from HiAnime:`,
        error.message,
      );
      throw new HttpException(
        `Failed to fetch info from HiAnime: ${error.message}`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /**
   * Get streaming links for an episode
   * @param episodeId - Provider-specific episode ID
   * @param provider - Ignored, always HiAnime
   * @param proxyBaseUrl - Optional backend proxy URL for M3U8 rewriting
   */
  async getEpisodeLinks(
    episodeId: string,
    provider: string = "hianime",
    proxyBaseUrl?: string,
    malId?: string,
    episodeNumber?: string,
  ) {
    try {
      this.logger.debug(
        `Fetching links for ${episodeId} (MAL: ${malId}, EP: ${episodeNumber})`,
      );
      const sources = await this.hiAnimeService.fetchEpisodeSources(episodeId);

      if (!sources || !sources.sources || sources.sources.length === 0) {
        this.logger.warn(
          `No sources found on HiAnime for episode ${episodeId}`,
        );
        // Don't throw yet, we might still have an iframe fallback
      }

      // Always proxy these sources as they usually have CORS/403 issues
      const referer = sources?.headers?.Referer || "https://megacloud.tv";

      const updatedSources = (sources?.sources || []).map((source: any) => {
        // Proxy everything that isn't already proxied
        if (source.url && !source.url.includes("/streaming/proxy")) {
          const originalUrl = source.url;
          const baseUrl = proxyBaseUrl || "/api/v1/streaming/proxy";
          source.url = `${baseUrl}?url=${encodeURIComponent(originalUrl)}&referer=${encodeURIComponent(referer)}`;
        }
        return source;
      });

      // HIGH-RELIABILITY IFRAME GENERATION (VidLink)
      // This is the most stable way to stream today
      let iframeUrl = (sources as any)?.iframeUrl || null;
      if (malId && episodeNumber) {
        // VidLink is the primary stable provider
        iframeUrl = `https://vidlink.pro/anime/${malId}/${episodeNumber}?primaryColor=6366f1`;
      }

      return {
        provider: "hianime",
        ...sources,
        sources: updatedSources,
        iframeUrl: iframeUrl,
      };
    } catch (error) {
      this.logger.error(
        `Error fetching episode sources from HiAnime: ${error.message}`,
      );
      throw new HttpException(
        `Failed to fetch links from HiAnime: ${error.message}`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /**
   * Proxies a stream request
   */
  async proxyStream(url: string, referer: string, res: any) {
    return this.streamingProxyService.proxy(url, referer, res);
  }

  /**
   * Search and get best match for anime by MAL title (from AniList)
   */
  async findAnimeByTitle(title: string, titleEnglish?: string) {
    try {
      this.logger.debug(
        `Finding HiAnime match for: ${title} / ${titleEnglish}`,
      );
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
