import { Injectable, Logger } from "@nestjs/common";
import { AnilistService } from "../common/services/anilist.service";
import { JikanService } from "../common/services/jikan.service";

@Injectable()
export class SeasonsService {
  private readonly logger = new Logger(SeasonsService.name);

  constructor(
    private readonly anilistService: AnilistService,
    private readonly jikanService: JikanService,
  ) {}

  async getCurrentSeason() {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    let season: "WINTER" | "SPRING" | "SUMMER" | "FALL";
    if (month >= 0 && month <= 2) season = "WINTER";
    else if (month >= 3 && month <= 5) season = "SPRING";
    else if (month >= 6 && month <= 8) season = "SUMMER";
    else season = "FALL";

    try {
      this.logger.log(`Fetching current season: ${season} ${year}`);
      const data = await this.anilistService.getThisSeason(season, year);

      return {
        data: data.map(this.mapAnilistToResponse),
        season,
        year,
      };
    } catch (e) {
      this.logger.warn(`AniList Current Season failed: ${e.message}`);
      const data = await this.jikanService.getSeason(year, season);
      return {
        data: data.map(r => this.mapJikanToResponse(r)),
        season,
        year,
      };
    }
  }

  async getUpcomingSeason() {
    try {
      const data = await this.anilistService.getNextSeason();
      return {
        data: data.map(this.mapAnilistToResponse),
      };
    } catch (e) {
      this.logger.warn(`AniList Upcoming Season failed: ${e.message}`);
      const data = await this.jikanService.getUpcoming();
      return {
        data: data.map(r => this.mapJikanToResponse(r)),
      };
    }
  }

  async getSeasonAnime(year: number, season: string, page: number = 1) {
    const seasonUpper = season.toUpperCase() as
      | "WINTER"
      | "SPRING"
      | "SUMMER"
      | "FALL";
    const validSeasons = ["WINTER", "SPRING", "SUMMER", "FALL"];

    if (!validSeasons.includes(seasonUpper)) {
      throw new Error("Invalid season");
    }

    try {
      const data = await this.anilistService.getThisSeason(
        seasonUpper,
        year,
        page,
      );
      return {
        pagination: { last_visible_page: 100, has_next_page: true },
        data: data.map(this.mapAnilistToResponse),
      };
    } catch (e) {
      this.logger.warn(`AniList Season ${year} ${season} failed: ${e.message}`);
      const data = await this.jikanService.getSeason(year, seasonUpper);
      return {
        pagination: { last_visible_page: 1, has_next_page: false },
        data: data.map(r => this.mapJikanToResponse(r)),
      };
    }
  }

  async getSeasonsList() {
    // Generate a list of seasons from 1960 to current year + 2
    const currentYear = new Date().getFullYear();
    const seasonsList = [];

    for (let year = currentYear + 1; year >= 1960; year--) {
      seasonsList.push({
        year: year,
        seasons: ["winter", "spring", "summer", "fall"],
      });
    }
    return seasonsList;
  }

  private mapAnilistToResponse(data: any) {
    if (!data) return null;
    return {
      mal_id: data.id, // Use AniList ID
      title: data.title.romaji || data.title.english || data.title.native,
      title_english: data.title.english,
      title_japanese: data.title.native,
      synopsis: data.description
        ? data.description.replace(/<[^>]*>?/gm, "")
        : "",
      type: data.format,
      episodes: data.episodes,
      status: data.status,
      score: data.averageScore ? data.averageScore / 10 : null,
      popularity: data.popularity,
      duration: data.duration ? `${data.duration} min` : null,
      source: data.source || "Original",
      images: {
        jpg: {
          image_url: data.coverImage.large,
          large_image_url: data.coverImage.extraLarge,
          small_image_url: data.coverImage.medium,
        },
        webp: {
          image_url: data.coverImage.large,
          large_image_url: data.coverImage.extraLarge,
          small_image_url: data.coverImage.medium,
        },
      },
      year: data.startDate?.year,
      season: data.season,
      genres: data.genres?.map((g: string) => ({ name: g, mal_id: 0 })) || [],
      studios:
        data.studios?.nodes?.map((s: any) => ({ name: s.name, mal_id: 0 })) ||
        [],
    };
  }

  private mapJikanToResponse(jikan: any) {
    if (!jikan) return null;
    return {
      mal_id: jikan.mal_id,
      title: jikan.title,
      title_english: jikan.title_english,
      title_japanese: jikan.title_japanese,
      synopsis: jikan.synopsis || "No synopsis available.",
      type: jikan.type,
      episodes: jikan.episodes,
      status: jikan.status,
      score: jikan.score,
      popularity: jikan.popularity,
      duration: jikan.duration,
      source: jikan.source || "Original",
      images: {
        jpg: {
          image_url: jikan.images?.jpg?.image_url,
          large_image_url: jikan.images?.jpg?.large_image_url,
          small_image_url: jikan.images?.jpg?.small_image_url,
        },
        webp: {
          image_url: jikan.images?.webp?.image_url,
          large_image_url: jikan.images?.webp?.large_image_url,
          small_image_url: jikan.images?.webp?.small_image_url,
        },
      },
      year: jikan.year,
      season: jikan.season,
      genres: jikan.genres?.map((g: any) => ({ name: g.name, mal_id: g.mal_id })) || [],
      studios: jikan.studios?.map((s: any) => ({ name: s.name, mal_id: s.mal_id })) || [],
    };
  }
}
