import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ANIME } from "@consumet/extensions";

@Injectable()
export class ConsumetService {
  private readonly logger = new Logger(ConsumetService.name);
  
  private readonly animekai = new ANIME.AnimeKai();
  private readonly animepahe = new ANIME.AnimePahe();
  private readonly hianime = new ANIME.Hianime();

  /**
   * Search across top providers with a strict timeout to prevent 524s
   */
  async search(query: string) {
    try {
      this.logger.debug(`Timed Search: ${query}`);
      
      const searchWithTimeout = async (provider: any) => {
        return Promise.race([
          provider.search(query),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000))
        ]);
      };

      // Try AnimePahe first (Currently faster)
      try {
        const res: any = await searchWithTimeout(this.animepahe);
        if (res?.results?.length > 0) return res.results;
      } catch (e) {
        this.logger.warn(`AnimePahe node slow/offline: ${e.message}`);
      }

      // Try AnimeKai secondary
      try {
        const res: any = await searchWithTimeout(this.animekai);
        if (res?.results?.length > 0) return res.results;
      } catch (e) {
        this.logger.warn(`AnimeKai node slow/offline: ${e.message}`);
      }

      return [];
    } catch (error) {
      this.logger.error(`Search mesh stalled: ${error.message}`);
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
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000))
        ]);
      };

      try {
        const info = await fetchWithTimeout(this.animepahe);
        if (info) return info;
      } catch (e) {
        try {
          const info = await fetchWithTimeout(this.animekai);
          if (info) return info;
        } catch (e2) {
          this.logger.warn(`Info mesh stalled`);
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get Episode Sources
   */
  async getEpisodeSources(episodeId: string, provider: string = 'animepahe') {
    try {
      const extractWithTimeout = async (target: any) => {
        return Promise.race([
          target.fetchEpisodeSources(episodeId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 12000))
        ]);
      };

      let sources: any = null;
      try {
        if (provider === 'animepahe') {
          sources = await extractWithTimeout(this.animepahe);
        } else if (provider === 'animekai') {
          sources = await extractWithTimeout(this.animekai);
        } else {
          sources = await extractWithTimeout(this.hianime);
        }
      } catch (e) {
        this.logger.warn(`Extraction timeout on ${provider}`);
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
          Referer: provider === 'animepahe' ? 'https://animepahe.ru/' : 'https://animekai.to/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        }
      };
    } catch (error) {
      return null;
    }
  }
}
