import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";

@Injectable()
export class JikanService {
  private readonly logger = new Logger(JikanService.name);
  private readonly baseUrl = process.env.JIKAN_API_URL || 'https://api.jikan.moe/v4';

  async getTopAnime() {
    try {
      const res = await axios.get(`${this.baseUrl}/top/anime`, { timeout: 10000 });
      return res.data?.data || [];
    } catch (e) {
      this.logger.error('Jikan Top Anime failed', e.message);
      return [];
    }
  }

  async getUpcoming() {
    try {
      const res = await axios.get(`${this.baseUrl}/seasons/upcoming`, { timeout: 10000 });
      return res.data?.data || [];
    } catch (e) {
      this.logger.error('Jikan Upcoming failed', e.message);
      return [];
    }
  }

  async getSeason(year: number, season: string) {
    try {
      const res = await axios.get(`${this.baseUrl}/seasons/${year}/${season.toLowerCase()}`, { timeout: 10000 });
      return res.data?.data || [];
    } catch (e) {
      this.logger.error(`Jikan Season ${year} ${season} failed`, e.message);
      return [];
    }
  }

  async searchAnime(query: string, page = 1, limit = 25, type?: string) {
    try {
      const params: any = { q: query, page, limit };
      if (type) params.type = type.toLowerCase();
      
      const res = await axios.get(`${this.baseUrl}/anime`, { params, timeout: 10000 });
      return res.data?.data || [];
    } catch (e) {
      this.logger.error(`Jikan Search failed for "${query}"`, e.message);
      return [];
    }
  }

  async getAnimeById(id: number) {
    try {
      const res = await axios.get(`${this.baseUrl}/anime/${id}/full`, { timeout: 10000 });
      return res.data?.data || null;
    } catch (e) {
      this.logger.error(`Jikan GetById failed for ${id}`, e.message);
      return null;
    }
  }

  async getAnimeCharacters(id: number) {
    try {
      const res = await axios.get(`${this.baseUrl}/anime/${id}/characters`, { timeout: 10000 });
      return res.data?.data || [];
    } catch (e) {
      this.logger.error(`Jikan GetCharacters failed for ${id}`, e.message);
      return [];
    }
  }

  async getAnimeRecommendations(id: number) {
    try {
      const res = await axios.get(`${this.baseUrl}/anime/${id}/recommendations`, { timeout: 10000 });
      return res.data?.data || [];
    } catch (e) {
      this.logger.error(`Jikan GetRecommendations failed for ${id}`, e.message);
      return [];
    }
  }
}
