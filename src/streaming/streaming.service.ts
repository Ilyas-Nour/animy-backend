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
      const results = await this.findAnimeByTitle(query);
      return {
        provider: "hianime",
        results: results || [],
      };
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

      // If we're here, it means HiAnime is likely down or the ID is invalid
      // We can't do much without more context here, but we can return a hint
      // that we're failing so the frontend can try its own fallback.
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

      // HIGH-RELIABILITY IFRAME GENERATION (Multi-Server)
      // This is the most stable way to stream today
      let iframeUrl = (sources as any)?.iframeUrl || null;
      const servers: any[] = [];

      // 1. Add HiAnime Native (if sources exist)
      if (updatedSources.length > 0) {
        servers.push({ name: 'HiAnime (Native)', provider: 'hianime' });
      }

      if (malId && episodeNumber) {
        let resolvedMalId = malId;
        if (parseInt(malId, 10) > 100000) { 
           const mapping = await this.idMappingService.getMalId(parseInt(malId, 10));
           if (mapping) resolvedMalId = mapping.toString();
        }

        iframeUrl = `https://vidlink.pro/anime/${resolvedMalId}/${episodeNumber}?primaryColor=6366f1`;
        
        // Add VidLink as Primary Stable
        servers.push({ 
          name: 'VidLink (Stable)', 
          url: iframeUrl,
          provider: 'vidlink'
        });

        // Add Vidsrc.to
        servers.push({
          name: 'Vidsrc.to (Fast)',
          url: `https://vidsrc.to/embed/anime/${resolvedMalId}/${episodeNumber}`,
          provider: 'vidsrc'
        });

        // Add Vidsrc.me
        servers.push({
          name: 'Vidsrc.me (Alternative)',
          url: `https://vidsrc.me/embed/anime/${resolvedMalId}/${episodeNumber}`,
          provider: 'vidsrc'
        });
      }

      return {
        provider: "hianime",
        ...sources,
        sources: updatedSources,
        iframeUrl: iframeUrl,
        servers: servers,
      };
    } catch (error) {
      this.logger.error(
        `Error fetching episode sources from HiAnime: ${error.message}`,
      );

      // HIGH-RELIABILITY FALLBACK: If HiAnime fails, but we have MAL ID and EP, use VidLink
      if (malId && episodeNumber) {
        let resolvedMalId = malId;
        if (parseInt(malId, 10) > 100000) {
           const mapping = await this.idMappingService.getMalId(parseInt(malId, 10));
           if (mapping) resolvedMalId = mapping.toString();
        }
        
        this.logger.log(`Using Multi-Server fallback for MAL ID: ${resolvedMalId}, EP: ${episodeNumber}`);
        return {
          provider: "fallback",
          sources: [],
          iframeUrl: `https://vidlink.pro/anime/${resolvedMalId}/${episodeNumber}?primaryColor=6366f1`,
          servers: [
             { name: 'VidLink (Stable)', url: `https://vidlink.pro/anime/${resolvedMalId}/${episodeNumber}?primaryColor=6366f1`, provider: 'vidlink' },
             { name: 'Vidsrc.to (Fast)', url: `https://vidsrc.to/embed/anime/${resolvedMalId}/${episodeNumber}`, provider: 'vidsrc' },
             { name: 'Vidsrc.me (Alternative)', url: `https://vidsrc.me/embed/anime/${resolvedMalId}/${episodeNumber}`, provider: 'vidsrc' }
          ]
        };
      }

      throw new HttpException(
        `Failed to fetch links from HiAnime: ${error.message}`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /**
   * Proxies a stream request
   */
  async proxyStream(url: string, referer: string, res: any, req?: any) {
    return this.streamingProxyService.proxy(url, referer, res, req);
  }

  /**
   * Search and get best match for anime by MAL title (from AniList)
   */
  async findAnimeByTitle(title: string, titleEnglish?: string, anilistId?: number) {
    try {
      this.logger.debug(
        `Finding HiAnime match for: ${title} / ${titleEnglish} (AniList: ${anilistId})`,
      );

      // 1. If we have an AniList ID, try the robust mapping service first
      if (anilistId) {
        const resolvedId = await this.idMappingService.resolveHiAnimeId(
          anilistId,
          title,
          titleEnglish,
        );
        if (resolvedId) {
          // Wrap in a format similar to search results
          return [{ id: resolvedId, title: title, image: "" }];
        }
      }

      // 2. Fallback to basic search
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
