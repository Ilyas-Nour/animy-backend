import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class EpisodeCacheService {
  private readonly logger = new Logger(EpisodeCacheService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves cached streaming data for an episode if it hasn't expired.
   */
  async getCachedLinks(animeId: number, episodeNum: number, provider: string) {
    try {
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
        this.logger.debug(`CACHE HIT: ${provider} - ${animeId} EP ${episodeNum}`);
        return cached.streamData;
      }

      if (cached) {
        this.logger.debug(`CACHE EXPIRED: ${provider} - ${animeId} EP ${episodeNum}`);
        await this.prisma.episodeCache.delete({ where: { id: cached.id } }).catch(() => null);
      }

      return null;
    } catch (e) {
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
    expiryHours: number = 4
  ) {
    try {
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
      this.logger.debug(`CACHED: ${provider} - ${animeId} EP ${episodeNum} (Expires in ${expiryHours}h)`);
    } catch (e) {
      this.logger.error(`Failed to cache links: ${e.message}`);
    }
  }
}
