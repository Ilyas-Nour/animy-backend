import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ANIME } from "@consumet/extensions";

@Injectable()
export class ConsumetService {
  private readonly logger = new Logger(ConsumetService.name);
  
  // The "Last Stand" nodes of April 2026
  private readonly allanime = new ANIME.AllAnime();
  private readonly hianime = new ANIME.Hianime();
  private readonly animepahe = new ANIME.AnimePahe();

  /**
   * Search across top providers with emergency failover
   */
  async search(query: string) {
    try {
      this.logger.debug(`Emergency Search: ${query}`);
      
      // AllAnime - The most stable node in April 2026
      try {
        const res = await this.allanime.search(query);
        if (res.results.length > 0) return res.results;
      } catch (e) {
        this.logger.warn(`AllAnime node failed: ${e.message}`);
      }

      // AnimePahe fallback
      try {
        const res = await this.animepahe.search(query);
        if (res.results.length > 0) return res.results;
      } catch (e) {
        this.logger.warn(`AnimePahe node failed: ${e.message}`);
      }

      return [];
    } catch (error) {
      this.logger.error(`Search engine failure: ${error.message}`);
      return [];
    }
  }

  /**
   * Get Anime Info & Episodes
   */
  async getAnimeInfo(id: string) {
    try {
      this.logger.debug(`Fetching info for ID: ${id}`);
      
      // Try AllAnime first
      try {
        const info = await this.allanime.fetchAnimeInfo(id);
        if (info) return info;
      } catch (e) {
        this.logger.warn(`AllAnime info node failure: ${e.message}`);
      }

      return null;
    } catch (error) {
      this.logger.error(`Info engine failure: ${error.message}`);
      return null;
    }
  }

  /**
   * Get Streaming Sources
   */
  async getEpisodeSources(episodeId: string, provider: string = 'allanime') {
    try {
      this.logger.debug(`Fetching transmission via: ${provider}`);
      
      let sources: any = null;
      
      // AllAnime is the king of 2026 uptime
      if (provider === 'allanime' || true) { 
        try {
          sources = await this.allanime.fetchEpisodeSources(episodeId);
        } catch (e) {
          this.logger.warn(`AllAnime transmission failed. Mesh destabilized.`);
          return null; 
        }
      }

      if (!sources || !sources.sources) return null;

      return {
        sources: sources.sources.map((s: any) => ({
          url: s.url,
          quality: s.quality || 'default',
          isM3U8: true
        })),
        subtitles: sources.subtitles || [],
        headers: {
          Referer: 'https://allanime.site/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        }
      };
    } catch (error) {
      this.logger.error(`Transmission engine failure: ${error.message}`);
      return null;
    }
  }
}
