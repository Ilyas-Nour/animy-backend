import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ANIME } from "@consumet/extensions";

@Injectable()
export class ConsumetService {
  private readonly logger = new Logger(ConsumetService.name);
  
  private readonly animekai = new ANIME.AnimeKai();
  private readonly animepahe = new ANIME.AnimePahe();
  private readonly gogo = new ANIME.Gogoanime();
  private readonly hianime = new ANIME.Hianime();

  constructor() {
    // Override domains for 2026 stability
    (this.animepahe as any).baseUrl = 'https://animepahe.ru';
    (this.gogo as any).baseUrl = 'https://gogoanime3.co';
  }

  /**
   * Search across top providers with a very strict timeout to prevent 524s
   */
  async search(query: string) {
    try {
      this.logger.debug(`Fast Search: ${query}`);
      
      const searchWithTimeout = async (provider: any) => {
        return Promise.race([
          provider.search(query),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]);
      };

      // Try AnimePahe first
      try {
        const res: any = await searchWithTimeout(this.animepahe);
        if (res?.results?.length > 0) return res.results;
      } catch (e) {
        this.logger.warn(`AnimePahe search slow: ${e.message}`);
      }

      // Try Gogo secondary
      try {
        const res: any = await searchWithTimeout(this.gogo);
        if (res?.results?.length > 0) return res.results;
      } catch (e) {
        this.logger.warn(`Gogo search slow: ${e.message}`);
      }

      return [];
    } catch (error) {
      this.logger.error(`Search mesh failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Get Anime Info with timeout protection
   */
  async getAnimeInfo(id: string) {
    try {
      const fetchWithTimeout = async (provider: any) => {
        return Promise.race([
          provider.fetchAnimeInfo(id),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]);
      };

      // Detect provider from ID format
      const isGogo = !id.includes('$') && id.split('-').length > 1;

      try {
        const info = await fetchWithTimeout(isGogo ? this.gogo : this.animepahe);
        if (info) return info;
      } catch (e) {
        try {
          const info = await fetchWithTimeout(this.animekai);
          if (info) return info;
        } catch (e2) {
          this.logger.warn(`Info fetch failed`);
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get Episode Sources with aggressive timeout
   */
  async getEpisodeSources(episodeId: string, provider: string = 'animepahe') {
    try {
      const extractWithTimeout = async (target: any) => {
        return Promise.race([
          target.fetchEpisodeSources(episodeId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000))
        ]);
      };

      let sources: any = null;
      let targetProvider = this.animepahe;
      let referer = 'https://animepahe.ru/';

      if (provider === 'gogoanime' || provider === 'gogo') {
        targetProvider = this.gogo;
        referer = 'https://gogoanime3.co/';
      } else if (provider === 'animekai') {
        targetProvider = this.animekai;
        referer = 'https://animekai.to/';
      }

      try {
        sources = await extractWithTimeout(targetProvider);
      } catch (e) {
        this.logger.warn(`Extraction timeout on ${provider}`);
        return null;
      }

      if (!sources || !sources.sources) return null;

      return {
        sources: sources.sources.map((s: any) => ({
          url: s.url,
          quality: s.quality || 'default',
          isM3U8: s.url.includes('.m3u8')
        })),
        subtitles: sources.subtitles || [],
        headers: {
          Referer: referer,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        }
      };
    } catch (error) {
      return null;
    }
  }
}
