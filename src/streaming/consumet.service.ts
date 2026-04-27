import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ANIME } from "@consumet/extensions";

@Injectable()
export class ConsumetService {
  private readonly logger = new Logger(ConsumetService.name);
  
  // The "Stable Mesh" nodes of April 2026
  private readonly animekai = new ANIME.AnimeKai();
  private readonly animepahe = new ANIME.AnimePahe();
  private readonly hianime = new ANIME.Hianime();

  /**
   * Search across top providers with failover
   */
  async search(query: string) {
    try {
      this.logger.debug(`Searching Mesh: ${query}`);
      
      // AnimeKai - Extremely stable in 2026
      try {
        const res = await this.animekai.search(query);
        if (res.results.length > 0) return res.results;
      } catch (e) {
        this.logger.warn(`AnimeKai node failed: ${e.message}`);
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
      
      // Try AnimeKai first
      try {
        const info = await this.animekai.fetchAnimeInfo(id);
        if (info) return info;
      } catch (e) {
        this.logger.warn(`AnimeKai info node failure: ${e.message}`);
      }

      // Fallback to AnimePahe
      try {
        const info = await this.animepahe.fetchAnimeInfo(id);
        if (info) return info;
      } catch (e) {
        this.logger.warn(`AnimePahe info node failure: ${e.message}`);
      }

      return null;
    } catch (error) {
      this.logger.error(`Info engine failure: ${error.message}`);
      return null;
    }
  }

  /**
   * Get Streaming Sources (High Performance Mesh)
   */
  async getEpisodeSources(episodeId: string, provider: string = 'animekai') {
    try {
      this.logger.debug(`Fetching transmission via: ${provider}`);
      
      let sources: any = null;
      
      try {
        // Try the requested provider (Default AnimeKai)
        if (provider === 'animekai' || !provider) {
          sources = await this.animekai.fetchEpisodeSources(episodeId);
        } else if (provider === 'animepahe') {
          sources = await this.animepahe.fetchEpisodeSources(episodeId);
        } else {
          sources = await this.hianime.fetchEpisodeSources(episodeId);
        }
      } catch (e) {
        this.logger.warn(`${provider} transmission failed. Trying secondary mesh...`);
        // We return null so the StreamingService can handle the mirror failover
        return null;
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
          Referer: 'https://animekai.to/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        }
      };
    } catch (error) {
      this.logger.error(`Transmission engine failure: ${error.message}`);
      return null;
    }
  }
}
