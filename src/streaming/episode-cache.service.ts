import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { Redis } from "@upstash/redis";

@Injectable()
export class EpisodeCacheService {
  private readonly logger = new Logger(EpisodeCacheService.name);
  private redis: Redis | null = null;

  constructor(private readonly prisma: PrismaService) {
    if (
      process.env.UPSTASH_REDIS_REST_URL &&
      process.env.UPSTASH_REDIS_REST_TOKEN
    ) {
      this.redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      this.logger.log("Upstash Redis initialized for Episode Cache");
    } else {
      this.logger.warn(
        "Upstash Redis credentials missing. Falling back to PostgreSQL caching.",
      );
    }
  }

  /**
   * Retrieves cached streaming data for an episode if it hasn't expired.
   */
  async getCachedLinks(animeId: number, episodeNum: number, provider: string) {
    const cacheKey = `streams:${provider}:${animeId}:${episodeNum}`;

    try {
      // 1. Try Redis first (Primary Cache Layer)
      if (this.redis) {
        const cachedData = await this.redis.get(cacheKey);
        if (cachedData) {
          this.logger.debug(
            `REDIS HIT: ${provider} - ${animeId} EP ${episodeNum}`,
          );
          // @upstash/redis automatically parses JSON if it was saved as an object
          return cachedData;
        }
      }

      // 2. Fallback to PostgreSQL (Legacy Cache Layer)
      const cached = await this.prisma.episodeCache.findUnique({
        where: {
          animeId_episodeNum_provider: {
            animeId,
            episodeNum,
            provider,
          },
        },
      });

      if (cached && cached.expiresAt > new Date()) {
        this.logger.debug(
          `POSTGRES HIT: ${provider} - ${animeId} EP ${episodeNum}`,
        );
        return cached.streamData;
      }

      // Cleanup expired postgres cache
      if (cached) {
        this.logger.debug(
          `POSTGRES EXPIRED: ${provider} - ${animeId} EP ${episodeNum}`,
        );
        await this.prisma.episodeCache
          .delete({ where: { id: cached.id } })
          .catch(() => null);
      }

      return null;
    } catch (e) {
      this.logger.error(`Cache retrieval failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Caches streaming data for an episode.
   * Default expiry is 4 hours (streaming links often expire after this).
   */
  async cacheLinks(
    animeId: number,
    episodeNum: number,
    provider: string,
    streamData: any,
    expiryHours: number = 4,
  ) {
    const cacheKey = `streams:${provider}:${animeId}:${episodeNum}`;
    const expirySeconds = expiryHours * 3600;

    try {
      // 1. Save to Redis (Primary Cache)
      if (this.redis) {
        // Ex (seconds) sets the TTL
        await this.redis.set(cacheKey, streamData, { ex: expirySeconds });
        this.logger.debug(
          `REDIS CACHED: ${provider} - ${animeId} EP ${episodeNum} (${expiryHours}h)`,
        );
      } else {
        // 2. Fallback to PostgreSQL
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + expiryHours);

        await this.prisma.episodeCache.upsert({
          where: {
            animeId_episodeNum_provider: {
              animeId,
              episodeNum,
              provider,
            },
          },
          update: {
            streamData,
            expiresAt,
          },
          create: {
            animeId,
            episodeNum,
            provider,
            streamData,
            expiresAt,
          },
        });
        this.logger.debug(
          `POSTGRES CACHED: ${provider} - ${animeId} EP ${episodeNum} (${expiryHours}h)`,
        );
      }
    } catch (e) {
      this.logger.error(`Failed to cache links: ${e.message}`);
    }
  }
}
