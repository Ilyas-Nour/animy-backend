import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";

@Injectable()
export class JikanService {
  private readonly logger = new Logger(JikanService.name);
  private readonly baseUrl = process.env.JIKAN_API_URL || 'https://api.jikan.moe/v4';

  async getTopAnime() {
    try {
      const res = await axios.get(`${this.baseUrl}/top/anime`, { timeout: 5000 });
      return res.data?.data || [];
    } catch (e) {
      this.logger.error('Jikan Top Anime failed', e.message);
      return [];
    }
  }

  async getUpcoming() {
    try {
      const res = await axios.get(`${this.baseUrl}/seasons/upcoming`, { timeout: 5000 });
      return res.data?.data || [];
    } catch (e) {
      this.logger.error('Jikan Upcoming failed', e.message);
      return [];
    }
  }

  async getSeason(year: number, season: string) {
    try {
      const res = await axios.get(`${this.baseUrl}/seasons/${year}/${season.toLowerCase()}`, { timeout: 5000 });
      return res.data?.data || [];
    } catch (e) {
      this.logger.error(`Jikan Season ${year} ${season} failed`, e.message);
      return [];
    }
  }
}
