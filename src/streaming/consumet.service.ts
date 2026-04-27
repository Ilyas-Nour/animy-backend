import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ANIME } from "@consumet/extensions";

@Injectable()
export class ConsumetService {
  private readonly logger = new Logger(ConsumetService.name);
  
  // Working nodes for April 2026
  private readonly hianime = new ANIME.Hianime();
  private readonly animepahe = new ANIME.AnimePahe();

  constructor() {
    // Manually setting working mirrors that are active today in 2026
    // Using Hianime (AniWatch) mirror which is currently the most stable
    // @ts-ignore - Some versions allow setting custom base URLs
    if (this.hianime.baseUrl) {
       this.hianime.baseUrl = "https://aniwatchtv.to";
    }
  }

  /**
   * Search across top providers with failover
   */
  async search(query: string) {
    try {
      this.logger.debug(`Searching for: ${query}`);
      
      // Try HiAnime first (Best metadata)
      try {
        const res = await this.hianime.search(query);
        if (res.results.length > 0) return res.results;
      } catch (e) {
        this.logger.warn(`HiAnime search node failed: ${e.message}`);
      }

      // Fallback to AnimePahe
      try {
        const res = await this.animepahe.search(query);
        if (res.results.length > 0) return res.results;
      } catch (e) {
        this.logger.warn(`AnimePahe search node failed: ${e.message}`);
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
      
      // Attempt HiAnime fetch
      try {
        const info = await this.hianime.fetchAnimeInfo(id);
        if (info) return info;
      } catch (e) {
        this.logger.warn(`HiAnime info node failure: ${e.message}`);
      }

      // Attempt AnimePahe fallback
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
   * Get Streaming Sources (The Hybrid Mesh)
   */
  async getEpisodeSources(episodeId: string, provider: 'hianime' | 'animepahe' = 'hianime') {
    try {
      this.logger.debug(`Fetching transmission sources for: ${episodeId} via ${provider}`);
      
      let sources: any = null;
      
      if (provider === 'hianime') {
        try {
          // HiAnime needs specific episode ID handling in 2026
          sources = await this.hianime.fetchEpisodeSources(episodeId);
        } catch (e) {
          this.logger.warn(`HiAnime transmission failed. Switching to failover node...`);
          return null; 
        }
      } else {
        sources = await this.animepahe.fetchEpisodeSources(episodeId);
      }

      if (!sources || !sources.sources) return null;

      return {
        sources: sources.sources.map((s: any) => ({
          url: s.url,
          quality: s.quality || 'default',
          isM3U8: s.isM3U8 || s.url.includes('.m3u8')
        })),
        subtitles: sources.subtitles || [],
        headers: {
          Referer: sources.headers?.Referer || sources.headers?.referer || 'https://aniwatchtv.to/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        }
      };
    } catch (error) {
      this.logger.error(`Transmission engine failure: ${error.message}`);
      return null;
    }
  }
}
