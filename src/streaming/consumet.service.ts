import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ANIME } from "@consumet/extensions";
import axios from "axios";

@Injectable()
export class ConsumetService {
  private readonly logger = new Logger(ConsumetService.name);
  
  private readonly animekai = new ANIME.AnimeKai();
  private readonly animepahe = new ANIME.AnimePahe();
  private readonly kickass = new ANIME.KickAssAnime();
  private readonly hianime = new ANIME.Hianime();
  private readonly animekai = new ANIME.AnimeKai();

  constructor() {
    // Override domains for 2026 stability
    (this.animepahe as any).baseUrl = 'https://animepahe.ru';
    (this.kickass as any).baseUrl = 'https://kickassanime.am';
    (this.hianime as any).baseUrl = 'https://hianime.to';
    (this.animekai as any).baseUrl = 'https://animekai.to';
  }

  /**
   * Resilience Search Mesh v6.0: "Solid Solution"
   */
  async search(query: string) {
    try {
      this.logger.debug(`Resilience Search Mesh v6.0: ${query}`);
      
      // 1. Anify.tv (Professional 2026 Choice)
      try {
        const anifyUrl = `https://api.anify.tv/search/anime/${encodeURIComponent(query)}`;
        const anifyRes = await axios.get(anifyUrl, { timeout: 4000 }).catch(() => null);
        if (anifyRes?.data && Array.isArray(anifyRes.data)) {
          return anifyRes.data.map((a: any) => ({
            id: a.id,
            title: a.title.english || a.title.romaji,
            image: a.coverImage,
            provider: 'anify'
          }));
        }
      } catch (e) {}

      return [];
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

      // 2. Traditional Fallback
      try {
        const info = await Promise.race([
          this.hianime.fetchAnimeInfo(id),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]).catch(() => null);
        if (info) return info;
      } catch (e) {}

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
      let targetProvider: any = this.animepahe;
      let referer = 'https://animepahe.ru/';

      if (provider === 'kickassanime' || provider === 'kickass') {
        targetProvider = this.kickass;
        referer = 'https://kickassanime.am/';
      } else if (provider === 'animekai') {
        targetProvider = this.animekai;
        referer = 'https://animekai.to/';
      } else if (provider === 'hianime' || provider === 'zoro') {
        targetProvider = this.hianime;
        referer = 'https://hianime.to/';
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

  /**
   * Get Episode Sources from AnimeKai (MegaUp)
   */
  async getAnimeKaiSources(episodeId: string) {
    try {
      this.logger.debug(`Fetching AnimeKai (MegaUp) sources for: ${episodeId}`);
      const sources = await this.animekai.fetchEpisodeSources(episodeId).catch(() => null);
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
