import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import axios from "axios";
import * as cheerio from "cheerio";

@Injectable()
export class HiAnimeService {
  private readonly logger = new Logger(HiAnimeService.name);

  // Working HiAnime API (unofficial community-hosted APIs — no Cloudflare)
  private readonly hiAnimeApiHosts = [
    'https://hianime-api.vercel.app/anime',
    'https://aniwatch-api-net.vercel.app/api/v2/hianime',
    'https://aniwatch-api-v1.vercel.app/api/v2/hianime',
    'https://aniwatch.ameyg.me/api/v2/hianime',
  ];

  // GogoAnime working mirror
  private readonly gogoMirror = "https://gogoanime.by";

  private readonly headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
  };

  /**
   * Universal Search — tries HiAnime API then GogoAnime
   */
  async search(query: string) {
    try {
      // 1. Try HiAnime unofficial API first
      const hianimeResults = await this.searchHiAnimeApi(query);
      if (hianimeResults.length > 0) {
        return { results: hianimeResults };
      }

      // 2. Fallback to GogoAnime scraper
      const gogoResults = await this.searchGogo(query);
      return { results: gogoResults };
    } catch (error) {
      this.logger.error(`Search failed: ${error.message}`);
      return { results: [] };
    }
  }

  /**
   * Search via HiAnime unofficial API (no scraping, no Cloudflare)
   */
  private async searchHiAnimeApi(query: string): Promise<any[]> {
    for (const host of this.hiAnimeApiHosts) {
      try {
        const url = `${host}/search?q=${encodeURIComponent(query)}&page=1`;
        const { data } = await axios.get(url, { timeout: 5000, headers: this.headers });
        const animes = data?.data?.animes || data?.animes || [];
        if (animes.length > 0) {
          this.logger.debug(`HiAnime API found ${animes.length} results from ${host}`);
          return animes.map((a: any) => ({
            id: a.id,
            title: a.name || a.title,
            image: a.poster || a.image,
            url: `/anime/${a.id}`,
            provider: 'hianime'
          }));
        }
      } catch (e) {
        this.logger.warn(`HiAnime API host failed: ${host} — ${e.message}`);
      }
    }
    return [];
  }

  /**
   * Search GogoAnime — scrapes gogoanime.by
   */
  private async searchGogo(query: string): Promise<any[]> {
    try {
      const { data } = await axios.get(
        `${this.gogoMirror}/search.html?keyword=${encodeURIComponent(query)}`,
        { headers: this.headers, timeout: 6000 }
      );
      const $ = cheerio.load(data);
      const results: any[] = [];
      $(".last_episodes ul.items li").each((_, el) => {
        const item = $(el);
        const href = item.find("a").first().attr("href");
        const id = href?.split("/").filter(Boolean).pop();
        if (id) {
          results.push({
            id,
            title: item.find(".name a").text().trim(),
            image: item.find("img").attr("src"),
            url: `/anime/${id}`,
            provider: 'gogo'
          });
        }
      });
      return results;
    } catch (e) {
      this.logger.warn(`GogoAnime search failed: ${e.message}`);
      return [];
    }
  }

  /**
   * Get anime info — tries HiAnime API then GogoAnime
   */
  async fetchAnimeInfo(id: string) {
    const info = await this.fetchHiAnimeInfoApi(id);
    if (info) return info;

    return this.fetchGogoInfo(id);
  }

  /**
   * HiAnime info via unofficial API
   */
  private async fetchHiAnimeInfoApi(id: string) {
    for (const host of this.hiAnimeApiHosts) {
      try {
        const url = `${host}/info?id=${encodeURIComponent(id)}`;
        const { data } = await axios.get(url, { timeout: 6000, headers: this.headers });
        const anime = data?.data?.anime?.info || data?.anime?.info || data?.info;
        const episodes = data?.data?.seasons || data?.data?.episodes || data?.episodes || [];

        if (anime) {
          return {
            id,
            title: anime.name || anime.title,
            image: anime.poster || anime.image,
            episodes: (Array.isArray(episodes) ? episodes : []).map((e: any) => ({
              id: e.episodeId || e.id,
              number: e.number,
              title: e.title || `Episode ${e.number}`,
              provider: 'hianime'
            }))
          };
        }
      } catch (e) {
        this.logger.warn(`HiAnime API info failed: ${host} — ${e.message}`);
      }
    }
    return null;
  }

  /**
   * GogoAnime info via scraping
   */
  private async fetchGogoInfo(id: string) {
    try {
      const { data } = await axios.get(`${this.gogoMirror}/category/${id}`, {
        headers: this.headers,
        timeout: 6000
      });
      const $ = cheerio.load(data);
      const movie_id = $("#movie_id").val();
      const alias = $("#alias_anime").val();

      if (!movie_id) return null;

      const { data: epData } = await axios.get(
        `https://ajax.gogocdn.net/ajax/load-list-episode?ep_start=0&ep_end=2000&id=${movie_id}&default_ep=0&alias=${alias}`,
        { timeout: 6000 }
      );
      const $eps = cheerio.load(epData);
      const episodes: any[] = [];
      $eps("#episode_related li").each((_, el) => {
        const item = $eps(el);
        const epNum = item.find(".name").text().replace("EP ", "").trim();
        const epId = item.find("a").attr("href")?.trim().split("/").pop();
        episodes.push({
          id: epId,
          number: parseFloat(epNum),
          title: `Episode ${epNum}`,
          provider: 'gogo'
        });
      });

      return {
        id,
        title: $(".anime_info_body_bg h1").text().trim(),
        image: $(".anime_info_body_bg img").attr("src"),
        episodes: episodes.reverse()
      };
    } catch (e) {
      this.logger.warn(`GogoAnime info failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Get streaming sources for an episode
   */
  async fetchEpisodeSources(episodeId: string) {
    // 1. Try GogoAnime first (fast, works well)
    const gogoSource = await this.fetchGogoSources(episodeId);
    if (gogoSource) return gogoSource;

    // 2. Try HiAnime API
    const hianimeSource = await this.fetchHiAnimeSourcesApi(episodeId);
    if (hianimeSource) return hianimeSource;

    throw new HttpException("All providers offline", HttpStatus.SERVICE_UNAVAILABLE);
  }

  /**
   * GogoAnime episode sources via direct URL
   * Supports the format: {slug}-episode-{num}-english-subbed
   */
  private async fetchGogoSources(episodeId: string) {
    try {
      const { data } = await axios.get(`${this.gogoMirror}/${episodeId}`, {
        headers: this.headers,
        timeout: 6000
      });
      const $ = cheerio.load(data);

      // Try to find iframe source
      const iframeSrc = $("div.anime_video_body iframe").attr("src")
        || $(".play-video iframe").attr("src")
        || $("iframe").first().attr("src");

      if (iframeSrc) {
        const embedUrl = iframeSrc.startsWith("//") ? `https:${iframeSrc}` : iframeSrc;
        return {
          iframeUrl: embedUrl,
          servers: [{ name: 'GogoAnime', url: embedUrl, provider: 'gogo' }]
        };
      }

      return null;
    } catch (e) {
      this.logger.warn(`GogoAnime sources failed for ${episodeId}: ${e.message}`);
      return null;
    }
  }

  /**
   * HiAnime episode sources via unofficial API
   */
  private async fetchHiAnimeSourcesApi(episodeId: string) {
    for (const host of this.hiAnimeApiHosts) {
      try {
        // episodeId format: anime-slug?ep=12345
        const url = `${host}/episode/sources?animeEpisodeId=${encodeURIComponent(episodeId)}&server=vidstreaming&category=sub`;
        const { data } = await axios.get(url, { timeout: 6000, headers: this.headers });
        const link = data?.data?.link || data?.link || data?.sources?.[0]?.url;

        if (link) {
          this.logger.debug(`HiAnime API sources found from ${host}`);
          return {
            iframeUrl: link,
            servers: [{ name: 'HiAnime (VidStreaming)', url: link, provider: 'hianime' }]
          };
        }
      } catch (e) {
        this.logger.warn(`HiAnime API sources failed: ${host} — ${e.message}`);
      }
    }
    return null;
  }

  /**
   * Build a GogoAnime episode URL slug from an anime slug + episode number
   * Example: "jujutsu-kaisen" + 1 -> "jujutsu-kaisen-episode-1-english-subbed"
   */
  buildGogoEpisodeId(animeSlug: string, episodeNum: number): string {
    return `${animeSlug}-episode-${episodeNum}-english-subbed`;
  }
}
