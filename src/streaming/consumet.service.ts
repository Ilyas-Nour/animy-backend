import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ANIME } from "@consumet/extensions";
import axios from "axios";

@Injectable()
export class ConsumetService {
  private readonly logger = new Logger(ConsumetService.name);

  private readonly animepahe = new ANIME.AnimePahe();
  private readonly kickass = new ANIME.KickAssAnime();
  private readonly animekai = new ANIME.AnimeKai();

  constructor() {
    // Override base URLs to working 2025/2026 domains
    (this.animepahe as any).baseUrl = 'https://animepahe.com';
    (this.kickass as any).baseUrl = 'https://kaa.lt';
    (this.animekai as any).baseUrl = 'https://animekai.to';

    // Override internal cookie domains used by AnimePahe scraper
    try {
      (this.animepahe as any).domainName = 'https://animepahe.com';
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
   * Get Anime Info — tries KickAssAnime then AnimePahe then AnimeKai
   */
  async getAnimeInfo(id: string) {
    try {
      // Try KickAssAnime first
      try {
        const info = await Promise.race([
          this.kickass.fetchAnimeInfo(id),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 6000))
        ]).catch(() => null);
        if (info) return info;
      } catch (e) {}

      // Fallback to AnimePahe
      try {
        const info = await Promise.race([
          this.animepahe.fetchAnimeInfo(id),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 6000))
        ]).catch(() => null);
        if (info) return info;
      } catch (e) {}

      // Fallback to AnimeKai
      try {
        const info = await Promise.race([
          this.animekai.fetchAnimeInfo(id),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 6000))
        ]).catch(() => null);
        if (info) return info;
      } catch (e) {}

      return null;
    } catch (error) {
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
      }

      let sources: any = null;

      try {
        sources = await Promise.race([
          targetProvider.fetchEpisodeSources(episodeId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
        ]);
      } catch (e) {
        this.logger.warn(`Source extraction timeout on ${provider} for ${episodeId}`);

        // If primary provider fails, try others
        if (provider === 'animepahe') {
          try {
            sources = await Promise.race([
              this.kickass.fetchEpisodeSources(episodeId),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000))
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
