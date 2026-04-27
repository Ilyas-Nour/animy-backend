import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import axios from "axios";
import * as cheerio from "cheerio";

@Injectable()
export class HiAnimeService {
  private readonly logger = new Logger(HiAnimeService.name);
  
  // Working mirrors for 2026
  private readonly hianimeMirror = "https://aniwatchtv.to";
  private readonly gogoMirror = "https://gogoanime3.co";

  private readonly headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  };

  /**
   * Universal Search (Tries multiple providers)
   */
  async search(query: string) {
    try {
      // Try HiAnime Mirror First
      const hianimeResults = await this.searchHiAnime(query);
      if (hianimeResults.length > 0) return { results: hianimeResults };

      // Fallback to GogoAnime
      const gogoResults = await this.searchGogo(query);
      return { results: gogoResults };
    } catch (error) {
      this.logger.error(`Search failed: ${error.message}`);
      return { results: [] };
    }
  }

  private async searchHiAnime(query: string) {
    try {
      const { data } = await axios.get(`${this.hianimeMirror}/search?keyword=${encodeURIComponent(query)}`, { headers: this.headers, timeout: 5000 });
      const $ = cheerio.load(data);
      const results: any[] = [];
      $(".film_list-wrap .flw-item").each((_, el) => {
        const item = $(el);
        const id = item.find(".film-detail .film-name a").attr("href")?.split("/").pop()?.split("?")[0];
        if (id) results.push({ id, title: item.find(".film-name").text().trim(), image: item.find("img").attr("data-src"), url: `/anime/${id}`, provider: 'hianime' });
      });
      return results;
    } catch { return []; }
  }

  private async searchGogo(query: string) {
    try {
      const { data } = await axios.get(`${this.gogoMirror}/search.html?keyword=${encodeURIComponent(query)}`, { headers: this.headers, timeout: 5000 });
      const $ = cheerio.load(data);
      const results: any[] = [];
      $(".last_episodes ul.items li").each((_, el) => {
        const item = $(el);
        const id = item.find("a").attr("href")?.split("/").pop();
        if (id) results.push({ id, title: item.find(".name").text().trim(), image: item.find("img").attr("src"), url: `/anime/${id}`, provider: 'gogo' });
      });
      return results;
    } catch { return []; }
  }

  /**
   * Universal Info
   */
  async fetchAnimeInfo(id: string) {
    // If it looks like a Gogo ID (doesn't have the hianime suffix pattern) or if hianime fails
    const info = await this.fetchHiAnimeInfo(id);
    if (info) return info;

    return this.fetchGogoInfo(id);
  }

  private async fetchHiAnimeInfo(id: string) {
    try {
      const { data } = await axios.get(`${this.hianimeMirror}/${id}`, { headers: this.headers, timeout: 5000 });
      const $ = cheerio.load(data);
      const numericId = $("#wrapper").attr("data-id") || id.split("-").pop();
      const { data: epData } = await axios.get(`${this.hianimeMirror}/ajax/v2/episode/list/${numericId}`, { headers: this.headers });
      const $eps = cheerio.load(epData.html);
      const episodes: any[] = [];
      $eps(".detail-en-list .ep-item").each((_, el) => {
        const item = $eps(el);
        episodes.push({ id: item.attr("href")?.split("/").pop(), number: parseInt(item.attr("data-number") || "0"), title: item.attr("title"), provider: 'hianime' });
      });
      return { id, title: $(".film-name").text().trim(), image: $(".film-poster img").attr("src"), episodes };
    } catch { return null; }
  }

  private async fetchGogoInfo(id: string) {
    try {
      const { data } = await axios.get(`${this.gogoMirror}/category/${id}`, { headers: this.headers, timeout: 5000 });
      const $ = cheerio.load(data);
      const movie_id = $("#movie_id").val();
      const alias = $("#alias_anime").val();
      const { data: epData } = await axios.get(`https://ajax.gogocdn.net/ajax/load-list-episode?ep_start=0&ep_end=2000&id=${movie_id}&default_ep=0&alias=${alias}`);
      const $eps = cheerio.load(epData);
      const episodes: any[] = [];
      $eps("#episode_related li").each((_, el) => {
        const item = $eps(el);
        const epNum = item.find(".name").text().replace("EP ", "").trim();
        const epId = item.find("a").attr("href")?.trim().split("/").pop();
        episodes.push({ id: epId, number: parseFloat(epNum), title: `Episode ${epNum}`, provider: 'gogo' });
      });
      return { id, title: $(".anime_info_body_bg h1").text().trim(), image: $(".anime_info_body_bg img").attr("src"), episodes: episodes.reverse() };
    } catch { return null; }
  }

  /**
   * Universal Sources
   */
  async fetchEpisodeSources(episodeId: string) {
    // 1. Try Gogo first for seasonal speed
    const gogoSource = await this.fetchGogoSources(episodeId);
    if (gogoSource) return gogoSource;

    // 2. Fallback to HiAnime mirror
    return this.fetchHiAnimeSources(episodeId);
  }

  private async fetchGogoSources(episodeId: string) {
    try {
      const { data } = await axios.get(`${this.gogoMirror}/${episodeId}`, { headers: this.headers, timeout: 5000 });
      const $ = cheerio.load(data);
      const embedUrl = "https:" + $(".anime_video_body_watch_items .streaming_source.active a").attr("data-video");
      return { iframeUrl: embedUrl, servers: [{ name: 'Gogo (Fast)', url: embedUrl, provider: 'gogo' }] };
    } catch { return null; }
  }

  private async fetchHiAnimeSources(episodeId: string) {
    try {
      const epNum = episodeId.split("?ep=").pop() || episodeId;
      const { data: sData } = await axios.get(`${this.hianimeMirror}/ajax/v2/episode/servers?episodeId=${epNum}`, { headers: this.headers });
      const $ = cheerio.load(sData.html);
      const serverId = $(".server-item").first().attr("data-id");
      const { data: srcData } = await axios.get(`${this.hianimeMirror}/ajax/v2/episode/sources?id=${serverId}`, { headers: this.headers });
      return { iframeUrl: srcData.link, servers: [{ name: 'AniWatch (Mirror)', url: srcData.link, provider: 'hianime' }] };
    } catch (e) {
      throw new HttpException("All providers offline", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
