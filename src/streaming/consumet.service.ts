import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ANIME } from "@consumet/extensions";
import axios from "axios";

@Injectable()
export class ConsumetService {
  private readonly logger = new Logger(ConsumetService.name);

  private readonly animepahe = new ANIME.AnimePahe();
  private readonly kickass = new ANIME.KickAssAnime();
  private readonly animekai = new ANIME.AnimeKai();
  private readonly hianime = new ANIME.Hianime();

  constructor() {
    // Override base URLs to working 2025/2026 domains
    (this.animepahe as any).baseUrl = 'https://animepahe.ru';
    (this.kickass as any).baseUrl = 'https://kaas.am';
    (this.animekai as any).baseUrl = 'https://animekai.to';
    (this.hianime as any).baseUrl = 'https://hianime.me';

    // Override internal cookie domains used by AnimePahe scraper
    try {
      (this.animepahe as any).domainName = 'https://animepahe.ru';
    } catch (e) {}
  }

  /**
   * Resilience Search Mesh v10 — searches available providers
   */
  async search(query: string) {
    try {
      this.logger.debug(`Searching consumet mesh: "${query}"`);

      const results = await Promise.allSettled([
        // 1. AnimePahe
        this.animepahe.search(query)
          .then(res => (res.results || []).map((r: any) => ({ ...r, provider: 'animepahe' })))
          .catch(() => [] as any[]),

        // 2. KickAssAnime (kaa.lt)
        this.kickass.search(query)
          .then(res => (res.results || []).map((r: any) => ({ ...r, provider: 'kickassanime' })))
          .catch(() => [] as any[]),

        // 3. AnimeKai
        this.animekai.search(query)
          .then(res => (res.results || []).map((r: any) => ({ ...r, provider: 'animekai' })))
          .catch(() => [] as any[]),

        // 4. HiAnime (via Consumet)
        this.hianime.search(query)
          .then(res => (res.results || []).map((r: any) => ({ ...r, provider: 'hianime' })))
          .catch(() => [] as any[]),

        // 5. Anify (Fast & Stable)
        axios.get(`https://api.anify.tv/search/anime/${encodeURIComponent(query)}`, { timeout: 3000 })
          .then(res => (res.data || []).map((r: any) => ({ 
              id: r.id, 
              title: r.title.english || r.title.romaji, 
              image: r.coverImage, 
              provider: 'anify' 
          })))
          .catch(() => [] as any[]),
      ]);

      const flattened = results
        .filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled')
        .flatMap(r => r.value);

      this.logger.debug(`Search mesh found ${flattened.length} results for "${query}"`);
      return flattened;
    } catch (error) {
      this.logger.error(`Search mesh failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Get Anime Info — races multiple providers for the fastest response
   */
  async getAnimeInfo(id: string) {
    try {
      this.logger.debug(`Fetching anime info for ID: ${id}`);
      
      // Race all providers for the fastest response
      return await Promise.any([
        this.kickass.fetchAnimeInfo(id),
        this.animepahe.fetchAnimeInfo(id),
        this.animekai.fetchAnimeInfo(id),
        this.hianime.fetchAnimeInfo(id),
        // Global safety timeout to prevent hanging the whole request
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Global Info Timeout')), 8000))
      ]);
    } catch (error) {
      if (error.name === 'AggregateError') {
        this.logger.warn(`All providers failed for anime info ${id}`);
        return null;
      }
      this.logger.warn(`Unified getAnimeInfo failed for ${id}: ${error.message}`);
      return null;
    }
  }

  /**
   * Resolves episode number to a provider-specific episode ID
   */
  async resolveEpisodeId(animeId: string, episodeNum: number, provider: string = 'animepahe'): Promise<string | null> {
    try {
      this.logger.debug(`Resolving EP${episodeNum} for "${animeId}" on ${provider}`);

      const info: any = await this.getAnimeInfo(animeId).catch(() => null);
      if (info?.episodes?.length) {
        const ep = info.episodes.find((e: any) => e.number === episodeNum);
        if (ep) return ep.id || ep.episodeId || null;
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get Episode Sources from a specific provider
   */
  async getEpisodeSources(episodeId: string, provider: string = 'animepahe') {
    try {
      let targetProvider: any = this.animepahe;
      let referer = 'https://animepahe.com/';

      if (provider === 'kickassanime' || provider === 'kickass') {
        targetProvider = this.kickass;
        referer = 'https://kaa.lt/';
      } else if (provider === 'animekai') {
        targetProvider = this.animekai;
        referer = 'https://animekai.to/';
      } else if (provider === 'hianime') {
        targetProvider = this.hianime;
        referer = 'https://hianime.to/';
      }

      let sources: any = null;

      try {
        sources = await Promise.race([
          targetProvider.fetchEpisodeSources(episodeId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
        ]);
      } catch (e) {
        this.logger.warn(`Source extraction timeout on ${provider} for ${episodeId}`);

        // If primary provider fails, try others
        if (provider === 'animepahe') {
          try {
            sources = await Promise.race([
              this.kickass.fetchEpisodeSources(episodeId),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 12000))
            ]);
            referer = 'https://kaa.lt/';
          } catch (e2) {}
        }

        if (!sources) return null;
      }

      if (!sources || !sources.sources) return null;

      return {
        sources: sources.sources.map((s: any) => ({
          url: s.url,
          quality: s.quality || 'default',
          isM3U8: s.url?.includes('.m3u8') ?? false
        })),
        subtitles: sources.subtitles || [],
        headers: {
          Referer: referer,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        }
      };
    } catch (error) {
      this.logger.error(`Source fetch failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get Episode Sources from AnimeKai
   */
  async getAnimeKaiSources(episodeId: string, title?: string) {
    try {
      this.logger.debug(`Fetching AnimeKai sources for: ${episodeId}`);

      let targetId = episodeId;

      if (!isNaN(Number(episodeId)) && title) {
        this.logger.debug(`Searching AnimeKai by title: "${title}"`);
        const searchRes = await this.animekai.search(title).catch(() => null);
        if (searchRes?.results?.length) {
          targetId = searchRes.results[0].id;
          this.logger.debug(`AnimeKai mapping found: ${targetId}`);
        }
      }

      const sources = await this.animekai.fetchEpisodeSources(targetId).catch(() => null);
      if (!sources || !sources.sources) return null;

      return {
        sources: sources.sources.map((s: any) => ({
          url: s.url,
          quality: s.quality || 'auto',
          isM3U8: s.url?.includes('.m3u8') ?? false
        })),
        subtitles: sources.subtitles || [],
        headers: {
          Referer: 'https://animekai.to/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        }
      };
    } catch (error) {
      this.logger.error(`AnimeKai source fetch failed: ${error.message}`);
      return null;
    }
  }
}
