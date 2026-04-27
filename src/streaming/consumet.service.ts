import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ANIME } from "@consumet/extensions";

@Injectable()
export class ConsumetService {
  private readonly logger = new Logger(ConsumetService.name);
  
  // Providers list - Industry Standard 2026 (Updated Naming)
  private readonly hianime = new ANIME.Hianime();
  private readonly animepahe = new ANIME.AnimePahe();
  private readonly animekai = new ANIME.AnimeKai();

  /**
   * Search across all top providers
   */
  async search(query: string) {
    try {
      this.logger.debug(`Searching for: ${query}`);
      
      // Try HiAnime first - Best metadata/images
      try {
        const hianimeRes = await this.hianime.search(query);
        if (hianimeRes.results.length > 0) return hianimeRes.results;
      } catch (e) {
        this.logger.warn(`HiAnime search failed: ${e.message}`);
      }

      // Fallback to AnimePahe (Very stable in 2026)
      try {
        const paheRes = await this.animepahe.search(query);
        if (paheRes.results.length > 0) return paheRes.results;
      } catch (e) {
        this.logger.warn(`AnimePahe search failed: ${e.message}`);
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
      
      // Try HiAnime first
      try {
        const info = await this.hianime.fetchAnimeInfo(id);
        if (info) return info;
      } catch (e) {
        this.logger.warn(`HiAnime info failed for ${id}: ${e.message}`);
      }

      // Try AnimePahe fallback
      try {
        const info = await this.animepahe.fetchAnimeInfo(id);
        if (info) return info;
      } catch (e) {
        this.logger.warn(`AnimePahe info failed for ${id}: ${e.message}`);
      }

      return null;
    } catch (error) {
      this.logger.error(`Info fetch failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get Streaming Sources
   */
  async getEpisodeSources(episodeId: string, provider: 'hianime' | 'animepahe' = 'hianime') {
    try {
      this.logger.debug(`Fetching sources for EP: ${episodeId} using ${provider}`);
      
      let sources: any = null;
      
      if (provider === 'hianime') {
        try {
          sources = await this.hianime.fetchEpisodeSources(episodeId);
        } catch (e) {
          this.logger.warn(`HiAnime sources failed: ${e.message}. Trying AnimePahe...`);
          return null; 
        }
      } else {
        sources = await this.animepahe.fetchEpisodeSources(episodeId);
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
