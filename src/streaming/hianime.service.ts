import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import axios from "axios";
import * as cheerio from "cheerio";
import * as CryptoJS from "crypto-js";
import * as qs from "qs";

@Injectable()
export class HiAnimeService {
  private readonly logger = new Logger(HiAnimeService.name);
  private readonly baseUrl = "https://hianime.sx";
  
  // Headers to mimic a real browser
  private readonly headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://hianime.to/",
    "X-Requested-With": "XMLHttpRequest"
  };

  /**
   * Search for anime directly on HiAnime
   */
  async search(query: string) {
    try {
      const url = `${this.baseUrl}/search?keyword=${encodeURIComponent(query)}`;
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);
      const results: any[] = [];

      $(".film_list-wrap .flw-item").each((_, el) => {
        const item = $(el);
        const id = item.find(".film-detail .film-name a").attr("href")?.split("/").pop()?.split("?")[0];
        const title = item.find(".film-detail .film-name a").text().trim();
        const image = item.find(".film-poster img").attr("data-src");

        if (id) {
          results.push({ id, title, image, url: `/anime/${id}` });
        }
      });

      return { results };
    } catch (error) {
      this.logger.error(`Search failed: ${error.message}`);
      return { results: [] };
    }
  }

  /**
   * Get episodes for a specific anime
   */
  async fetchAnimeInfo(id: string) {
    try {
      // 1. Get the anime page to find the numeric ID
      const animeUrl = `${this.baseUrl}/${id}`;
      const { data: pageData } = await axios.get(animeUrl, { headers: this.headers });
      const $page = cheerio.load(pageData);
      
      const title = $page(".an-info-block .film-name").text().trim();
      const image = $page(".film-poster img").attr("src");
      const description = $page(".film-description .text").text().trim();

      // Extract the numeric ID from the page (needed for episodes AJAX)
      const numericId = $page("#wrapper").attr("data-id") || id.split("-").pop();

      // 2. Fetch episodes via AJAX
      const epUrl = `${this.baseUrl}/ajax/v2/episode/list/${numericId}`;
      const { data: epData } = await axios.get(epUrl, { headers: this.headers });
      const $eps = cheerio.load(epData.html);
      
      const episodes: any[] = [];
      $eps(".detail-en-list .ep-item").each((_, el) => {
        const item = $eps(el);
        const epId = item.attr("href")?.split("/").pop();
        const number = parseInt(item.attr("data-number") || "0");
        const epTitle = item.attr("title");

        if (epId) {
          episodes.push({
            id: epId,
            number,
            title: epTitle,
            url: `/watch/${epId}`
          });
        }
      });

      return { id, title, image, description, episodes };
    } catch (error) {
      this.logger.error(`Info fetch failed for ${id}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get streaming sources
   */
  async fetchEpisodeSources(episodeId: string) {
    try {
      // 1. Get Servers
      const serversUrl = `${this.baseUrl}/ajax/v2/episode/servers?episodeId=${episodeId.split("?ep=").pop() || episodeId}`;
      const { data: serversData } = await axios.get(serversUrl, { headers: this.headers });
      const $ = cheerio.load(serversData.html);

      const servers: any[] = [];
      $(".server-item").each((_, el) => {
        const item = $(el);
        const sType = item.closest(".pswp-col").find(".type").text().toLowerCase();
        servers.push({
          id: item.attr("data-id"),
          serverId: item.attr("data-server-id"),
          name: item.text().trim(),
          type: sType.includes("sub") ? "sub" : "dub"
        });
      });

      // 2. Pick a server (Default to HD-1/Vidstreaming)
      const targetServer = servers.find(s => s.name.includes("HD-1") || s.name.includes("Vidstreaming")) || servers[0];
      if (!targetServer) throw new Error("No servers found");

      // 3. Get the Embed ID
      const sourceUrl = `${this.baseUrl}/ajax/v2/episode/sources?id=${targetServer.id}`;
      const { data: sourceData } = await axios.get(sourceUrl, { headers: this.headers });
      
      const embedUrl = sourceData.link;
      if (!embedUrl) throw new Error("No embed link found");

      return {
        headers: { Referer: this.baseUrl },
        sources: [], 
        iframeUrl: embedUrl,
        servers: servers.map(s => ({ name: s.name, type: s.type, id: s.id }))
      };
    } catch (error) {
      this.logger.error(`Source fetch failed for ${episodeId}: ${error.message}`);
      throw new HttpException("Failed to get sources", HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
