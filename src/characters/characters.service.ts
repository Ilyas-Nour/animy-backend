import { Injectable, Logger } from "@nestjs/common";
import { AnilistService } from "../common/services/anilist.service";

@Injectable()
export class CharactersService {
  private readonly logger = new Logger(CharactersService.name);

  constructor(private readonly anilistService: AnilistService) { }

  async getTopCharacters(limit: number = 10) {
    const data = await this.anilistService.searchCharacters("", 1, limit);
    return {
      data: data.characters.map(this.mapAnilistToResponse)
    };
  }

  async getCharacterById(id: number) {
    const data = await this.anilistService.getCharacterById(id);
    return this.mapAnilistToResponse(data);
  }

  async getBirthdays() {
    // Simulate by shuffling top characters, as strict birthday query isn't simple
    const data = await this.anilistService.searchCharacters("", 1, 50); // Fetch more to shuffle
    const characters = data.characters || [];

    const shuffled = characters.sort(() => 0.5 - Math.random()).slice(0, 10);
    return {
      data: shuffled.map(this.mapAnilistToResponse)
    };
  }

  private mapAnilistToResponse(data: any) {
    if (!data) return null;
    return {
      mal_id: data.id,
      name: data.name.full,
      name_kanji: data.name.native,
      about: data.description ? data.description.replace(/<[^>]*>?/gm, '') : '',
      images: {
        jpg: {
          image_url: data.image?.large,
        },
        webp: {
          image_url: data.image?.large,
        }
      },
      favorites: data.favourites
    };
  }
}
