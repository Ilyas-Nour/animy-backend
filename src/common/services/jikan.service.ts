import {
  Injectable,
  Logger,
  Inject,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { firstValueFrom } from "rxjs";
import Bottleneck from "bottleneck";

@Injectable()
export class JikanService {
  private readonly logger = new Logger(JikanService.name);
  private readonly baseUrl: string = "https://api.jikan.moe/v4";
  private readonly limiter: Bottleneck;

  constructor(
    private readonly httpService: HttpService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    // 1. Rate Limiter: 3 req/sec max (Jikan limit). We use 2/sec to be safe.
    // minTime = 500ms (1000ms / 2 requests) = 1 request every 500ms
    // reservoir: 2 per second? Bottleneck handles 'minTime' which is gap between requests.
    this.limiter = new Bottleneck({
      minTime: 500, // Minimum 500ms between requests (max 2 req/sec)
      maxConcurrent: 1, // Optional: Serialize requests if overly cautious
    });

    this.logger.log(
      "JikanService initialized with Rate Limiting (2 req/s) and Caching.",
    );
  }

  /**
   * Universal fetch method with Caching & Rate Limiting
   * @param endpoint API endpoint (e.g. '/anime/1')
   * @param ttl Cache TTL in seconds (default: 24 hours = 86400)
   */
  async get<T>(endpoint: string, ttl: number = 86400): Promise<T> {
    const cacheKey = `jikan:${endpoint}`;

    // 2. Cache Check
    const cachedData = await this.cacheManager.get<T>(cacheKey);
    if (cachedData) {
      this.logger.debug(`Cache HIT: ${cacheKey}`);
      return cachedData;
    }

    this.logger.debug(`Cache MISS: ${cacheKey} -> Fetching...`);

    // 3. Rate Limited Fetch with Retry for 429
    const fetchData = async (isRetry = false): Promise<any> => {
      try {
        return await this.limiter.schedule(async () => {
          const url = `${this.baseUrl}${endpoint}`;
          const response = await firstValueFrom(this.httpService.get(url));
          const body = response.data;

          // 4. Cache Set
          if (body) {
            await this.cacheManager.set(cacheKey, body, ttl * 1000);
          }

          return body;
        });
      } catch (error) {
        if (error.response?.status === 429 && !isRetry) {
          this.logger.warn(`Rate Limit Hit for ${endpoint}. Retrying in 1.5s...`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
          return fetchData(true);
        }
        this.handleError(error, endpoint);
      }
    };

    return fetchData();
  }

  private handleError(error: any, endpoint: string) {
    if (error.response?.status === 429) {
      throw new HttpException(
        "Jikan API Rate Limit - Please wait a moment before refreshing.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.logger.error(`Jikan Error [${endpoint}]: ${error.message}`);
    throw new HttpException("External API Error", HttpStatus.BAD_GATEWAY);
  }
}
