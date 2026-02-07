import { Injectable, Logger } from "@nestjs/common";
import { JikanService } from "../common/services/jikan.service";

@Injectable()
export class CharactersService {
  private readonly logger = new Logger(CharactersService.name);

  constructor(private readonly jikanService: JikanService) {}

  async getTopCharacters(limit: number = 10) {
    return this.jikanService.get<any>(`/top/characters?limit=${limit}`, 3600);
  }

  async getCharacterById(id: number) {
    const res = await this.jikanService.get<any>(
      `/characters/${id}/full`,
      86400,
    );
    return res.data;
  }

  async getBirthdays() {
    // Since Jikan doesn't support "today's birthdays" directly,
    // we simulate it or fetch a list.
    // For now, let's keep the logic of returning some characters.
    // Or better, fetch top characters and shuffle.

    // Cache key handled by JikanService url? No, complex logic needs manual cache or just rely on JikanService cache.
    // We actally want to cache the *result* of the shuffle?
    // JikanService caches the *request*.

    // Let's just fetch top characters and let the controller/frontend handle display?
    // Or implement the logic here calling jikanService.

    const response = await this.jikanService.get<any>(
      "/top/characters?limit=25",
      86400,
    );
    const characters = response.data || [];

    // Shuffle
    const shuffled = characters.sort(() => 0.5 - Math.random()).slice(0, 10);
    return shuffled;
  }
}
