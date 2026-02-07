import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { AxiosResponse } from "axios";

// Helper to add delay between API calls
const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

@Injectable()
export class SeasonsService {
  private readonly logger = new Logger(SeasonsService.name);
  private readonly jikanApiUrl: string;
  private lastRequestTime: number = 0;
  private readonly MIN_REQUEST_INTERVAL = 350; // 350ms between requests

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.jikanApiUrl = this.configService.get<string>("jikan.apiUrl");
  }

  // Rate limit protection wrapper
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
      const waitTime = this.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
      this.logger.log(`Rate limit protection: waiting ${waitTime}ms`);
      await delay(waitTime);
    }

    this.lastRequestTime = Date.now();
  }

  async getCurrentSeason() {
    try {
      await this.waitForRateLimit();

      // Get current date to determine correct season
      const now = new Date();
      const month = now.getMonth() + 1; // 1-12
      const year = now.getFullYear();

      let season = "winter";
      if (month >= 1 && month <= 3) season = "winter";
      else if (month >= 4 && month <= 6) season = "spring";
      else if (month >= 7 && month <= 9) season = "summer";
      else if (month >= 10 && month <= 12) season = "fall";

      this.logger.log(`Fetching current season: ${season} ${year}`);

      // Use specific season endpoint instead of /seasons/now
      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(`${this.jikanApiUrl}/seasons/${year}/${season}`, {
          params: {
            sfw: "true",
            genres_exclude: "9",
          },
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error("Error fetching current season:", error.message);
      if (error.response?.status === 429) {
        throw new HttpException(
          "Rate limit exceeded. Please try again in a moment.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new HttpException(
        "Failed to fetch current season",
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getUpcomingSeason() {
    try {
      await this.waitForRateLimit(); // Add rate limit protection

      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(`${this.jikanApiUrl}/seasons/upcoming`, {
          params: {
            sfw: "true",
            genres_exclude: "9",
          },
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error("Error fetching upcoming season:", error.message);
      if (error.response?.status === 429) {
        throw new HttpException(
          "Rate limit exceeded. Please try again in a moment.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new HttpException(
        "Failed to fetch upcoming season",
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getSeasonAnime(year: number, season: string, page: number = 1) {
    try {
      await this.waitForRateLimit(); // Add rate limit protection

      const validSeasons = ["winter", "spring", "summer", "fall"];
      if (!validSeasons.includes(season.toLowerCase())) {
        throw new HttpException("Invalid season", HttpStatus.BAD_REQUEST);
      }

      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(
          `${this.jikanApiUrl}/seasons/${year}/${season.toLowerCase()}`,
          {
            params: {
              page,
              sfw: "true",
              genres_exclude: "9",
            },
          },
        ),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Error fetching ${season} ${year} anime:`,
        error.message,
      );
      if (error.response?.status === 429) {
        throw new HttpException(
          "Rate limit exceeded. Please try again in a moment.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new HttpException(
        `Failed to fetch ${season} ${year} anime`,
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getSeasonsList() {
    try {
      await this.waitForRateLimit(); // Add rate limit protection

      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(`${this.jikanApiUrl}/seasons`),
      );

      return response.data.data;
    } catch (error) {
      this.logger.error("Error fetching seasons list:", error.message);
      if (error.response?.status === 429) {
        throw new HttpException(
          "Rate limit exceeded. Please try again in a moment.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new HttpException(
        "Failed to fetch seasons list",
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
