import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ANIME } from "@consumet/extensions";
import axios from "axios";

@Injectable()
export class ConsumetService {
  private readonly logger = new Logger(ConsumetService.name);

  private readonly animepahe = new ANIME.AnimePahe();
  private readonly kickass = new ANIME.KickAssAnime();
  private readonly gogoanime = new ANIME.Gogoanime();
  private readonly animekai = new ANIME.AnimeKai();

  constructor() {
    // Override domains for 2026 stability
    (this.animepahe as any).baseUrl = 'https://animepahe.ru';
    (this.gogoanime as any).baseUrl = 'https://gogoanime3.co';
    (this.animekai as any).baseUrl = 'https://animekai.to';
  }

  /**
   * Resilience Search Mesh v8.3: "Surgical Clean"
   */
  async search(query: string) {
    try {
      this.logger.debug(`Resilience Search Mesh v8.3: ${query}`);

      const results = await Promise.race([
        Promise.all([
          // GogoAnime (Very Stable)
          (async () => {
            try {
              const res = await this.gogoanime.search(query).catch(() => null);
              return res?.results?.map((r: any) => ({
                id: r.id,
                title: r.title,
                image: r.image,
                provider: 'gogoanime'
              })) || [];
            } catch (e) { return []; }
          })(),
          // AnimePahe (Verified Working)
          (async () => {
            try {
              const res = await this.animepahe.search(query).catch(() => null);
              return res?.results?.map((r: any) => ({
                id: r.id,
                title: r.title,
                image: r.image,
                provider: 'animepahe'
              })) || [];
            } catch (e) { return []; }
          })()
        ]),
        new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('Mesh Timeout')), 5000))
      ]).catch(() => [[]]);

      // Flatten and prioritize
      const flattened = results.flat();
      return flattened.length > 0 ? flattened : [];
    } catch (error) {
      this.logger.error(`Search mesh failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Get Anime Info (Anify First)
   */
  async getAnimeInfo(id: string) {
    try {
      // 1. If it's a numeric ID, use Anify
      if (!isNaN(Number(id))) {
        const anifyUrl = `https://api.anify.tv/info/${id}`;
        const anifyRes = await axios.get(anifyUrl, { timeout: 5000 }).catch(() => null);
        if (anifyRes?.data) {
          return {
            id: anifyRes.data.id,
            title: anifyRes.data.title,
            episodes: anifyRes.data.episodes?.data?.map((e: any) => ({
              id: e.id,
              episodeId: e.id,
              number: e.number,
              title: e.title
            })) || []
          };
        }
      }

      // 2. Traditional Fallback (GogoAnime)
      try {
        const info = await Promise.race([
          this.gogoanime.fetchAnimeInfo(id),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]).catch(() => null);
        if (info) return info;
      } catch (e) { }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Resolves a generic episode number to a provider-specific episode ID
   */
  async resolveEpisodeId(animeId: string, episodeNum: number, provider: string = 'hianime'): Promise<string | null> {
    try {
      this.logger.debug(`Resolving episode ${episodeNum} for ${animeId} on ${provider}`);

      const info: any = await this.getAnimeInfo(animeId).catch(() => null);
      if (info?.episodes?.length) {
        const ep = info.episodes.find((e: any) => e.number === episodeNum);
        return ep ? ep.id : null;
      }

      // If info fetch failed, try searching if animeId is numeric
      if (!isNaN(Number(animeId))) {
        const searchResults = await this.search(animeId);
        if (searchResults.length > 0) {
          const firstId = searchResults[0].id;
          const info: any = await this.getAnimeInfo(firstId).catch(() => null);
          if (info?.episodes?.length) {
            const ep = info.episodes.find((e: any) => e.number === episodeNum);
            return ep ? ep.id : null;
          }
        }
      }

      return null;
    } catch (e) {
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
      let targetProvider: any = this.animepahe;
      let referer = 'https://animepahe.ru/';

      if (provider === 'kickassanime' || provider === 'kickass') {
        targetProvider = this.kickass;
        referer = 'https://kickassanime.am/';
      } else if (provider === 'animekai') {
        targetProvider = this.animekai;
        referer = 'https://animekai.to/';
      } else if (provider === 'hianime' || provider === 'zoro' || provider === 'gogoanime') {
        targetProvider = this.gogoanime;
        referer = 'https://gogoanime3.co/';
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

  /**
   * Get Episode Sources from AnimeKai (MegaUp)
   */
  async getAnimeKaiSources(episodeId: string, title?: string) {
    try {
      this.logger.debug(`Fetching AnimeKai (MegaUp) sources for: ${episodeId}`);

      let targetId = episodeId;

      // If ID is numeric (AniList) and search is needed
      if (!isNaN(Number(episodeId)) && title) {
        this.logger.debug(`Numeric ID detected for AnimeKai, searching by title: ${title}`);
        const searchRes = await this.animekai.search(title).catch(() => null);
        if (searchRes?.results?.length) {
          targetId = searchRes.results[0].id;
          this.logger.debug(`Found AnimeKai mapping: ${targetId}`);
        }
      }

      const sources = await this.animekai.fetchEpisodeSources(targetId).catch(() => null);
      if (!sources || !sources.sources) return null;

      return {
        sources: sources.sources.map((s: any) => ({
          url: s.url,
          quality: s.quality || 'auto',
          isM3U8: s.url.includes('.m3u8')
        })),
        subtitles: sources.subtitles || [],
        headers: {
          Referer: 'https://anikai.to/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        }
      };
    } catch (error) {
      this.logger.error(`AnimeKai source fetch failed: ${error.message}`);
      return null;
    }
  }
}

