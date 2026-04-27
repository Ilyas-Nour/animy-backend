import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ANIME } from "@consumet/extensions";

@Injectable()
export class ConsumetService {
  private readonly logger = new Logger(ConsumetService.name);
  
  // Providers list - Industry Standard 2026
  private readonly zoro = new ANIME.Zoro();
  private readonly gogo = new ANIME.Gogoanime();
  private readonly enime = new ANIME.Enime();
  private readonly animepahe = new ANIME.AnimePahe();

  /**
   * Search across all top providers
   */
  async search(query: string) {
    try {
      this.logger.debug(`Searching for: ${query}`);
      
      // Try Zoro (HiAnime) first - Best metadata/images
      try {
        const zoroRes = await this.zoro.search(query);
        if (zoroRes.results.length > 0) return zoroRes.results;
      } catch (e) {
        this.logger.warn(`Zoro search failed: ${e.message}`);
      }

      // Fallback to GogoAnime
      try {
        const gogoRes = await this.gogo.search(query);
        if (gogoRes.results.length > 0) return gogoRes.results;
      } catch (e) {
        this.logger.warn(`Gogo search failed: ${e.message}`);
      }

      return [];
    } catch (error) {
      this.logger.error(`Search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Get Anime Info & Episodes
   */
  async getAnimeInfo(id: string) {
    try {
      this.logger.debug(`Fetching info for ID: ${id}`);
      
      // Try Zoro first
      try {
        const info = await this.zoro.fetchAnimeInfo(id);
        if (info) return info;
      } catch (e) {
        this.logger.warn(`Zoro info failed for ${id}: ${e.message}`);
      }

      // Try Gogo fallback
      try {
        const info = await this.gogo.fetchAnimeInfo(id);
        if (info) return info;
      } catch (e) {
        this.logger.warn(`Gogo info failed for ${id}: ${e.message}`);
      }

      return null;
    } catch (error) {
      this.logger.error(`Info fetch failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get Streaming Sources (The Gold Standard)
   */
  async getEpisodeSources(episodeId: string, provider: 'zoro' | 'gogo' = 'zoro') {
    try {
      this.logger.debug(`Fetching sources for EP: ${episodeId} using ${provider}`);
      
      let sources: any = null;
      
      if (provider === 'zoro') {
        try {
          sources = await this.zoro.fetchEpisodeSources(episodeId);
        } catch (e) {
          this.logger.warn(`Zoro sources failed: ${e.message}. Trying Gogo...`);
          // Note: In real life, episode IDs are different between providers,
          // but we return this so the StreamingService can handle it.
          return null; 
        }
      } else {
        sources = await this.gogo.fetchEpisodeSources(episodeId);
      }

      if (!sources) return null;

      // Map Consumet format to our unified format
      return {
        sources: sources.sources.map((s: any) => ({
          url: s.url,
          quality: s.quality || 'default',
          isM3U8: s.isM3U8 || s.url.includes('.m3u8')
        })),
        subtitles: sources.subtitles || [],
        headers: {
          Referer: sources.headers?.Referer || sources.headers?.referer || '',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        }
      };
    } catch (error) {
      this.logger.error(`Sources fetch failed: ${error.message}`);
      return null;
    }
  }
}
