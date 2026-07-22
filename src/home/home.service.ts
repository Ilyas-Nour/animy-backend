import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { AnimeService } from "../anime/anime.service";
import { MangaService } from "../manga/manga.service";

@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly animeService: AnimeService,
    private readonly mangaService: MangaService,
  ) {}

  async getHomeData() {
    const cacheKey = "home_data_v2";

    try {
      const cached = await this.prisma.discoveryCache.findUnique({
        where: { key: cacheKey },
      });

      const now = new Date();
      const staleThreshold = 1000 * 60 * 30; // 30 minutes

      if (cached) {
        const isStale =
          now.getTime() - cached.updatedAt.getTime() > staleThreshold;

        if (isStale) {
          this.logger.debug("Home data stale, triggering background refresh");
          // Non-blocking refresh, pass the old data so we can fallback to it if the fetch fails
          this.refreshHomeData(cacheKey, cached.data).catch((err) =>
            this.logger.error(`Background refresh failed: ${err.message}`),
          );
        }

        return cached.data;
      }

      this.logger.debug("Home data cache miss, fetching fresh");
      return await this.refreshHomeData(cacheKey);
    } catch (err) {
      this.logger.error(`Failed to get home data from cache: ${err.message}`);
      return this.fetchFreshHomeData();
    }
  }

  async refreshHomeData(key: string, oldData?: any) {
    const data = await this.fetchFreshHomeData(oldData);

    try {
      await this.prisma.discoveryCache.upsert({
        where: { key },
        update: { data: data as any, updatedAt: new Date() },
        create: { key, data: data as any },
      });
      this.logger.debug("Home data cache updated successfully");
    } catch (err) {
      this.logger.error(`Failed to save home data to DB cache: ${err.message}`);
    }

    return data;
  }

  private async fetchFreshHomeData(oldData?: any) {
    this.logger.debug("Fetching fresh home data from providers...");

    // Parallel fetch with timeouts handled by individual services
    // Execute sequentially with a small delay to avoid AniList rate limits / timeouts
    const trending = await Promise.allSettled([this.animeService.getTopAnime(undefined, "trending")]);
    await new Promise((r) => setTimeout(r, 500));
    const popular = await Promise.allSettled([this.animeService.getTopAnime(undefined, "airing")]);
    await new Promise((r) => setTimeout(r, 500));
    const upcoming = await Promise.allSettled([this.animeService.getUpcomingNextSeason()]);
    await new Promise((r) => setTimeout(r, 500));
    const topManga = await Promise.allSettled([
      this.mangaService.searchManga({
        order_by: "popularity",
        sort: "desc",
        limit: 15,
      }),
    ]);
    await new Promise((r) => setTimeout(r, 500));
    const publishingManga = await Promise.allSettled([
      this.mangaService.searchManga({
        order_by: "popularity",
        sort: "desc",
        limit: 15,
      }),
    ]);

    const extractData = (res: any, fallbackKey: string) => {
      // If the fetch succeeded and returned data, use it
      if (
        res.status === "fulfilled" &&
        res.value?.data &&
        Array.isArray(res.value.data) &&
        res.value.data.length > 0
      ) {
        return res.value;
      }

      // If fetch failed or returned empty array, try to fallback to old data
      if (
        oldData &&
        oldData[fallbackKey] &&
        Array.isArray(oldData[fallbackKey]) &&
        oldData[fallbackKey].length > 0
      ) {
        this.logger.warn(
          `Provider failed or returned empty for ${fallbackKey}, falling back to stale cache.`,
        );
        return { data: oldData[fallbackKey] };
      }

      // Complete failure and no fallback
      this.logger.error(
        `Complete failure for ${fallbackKey} and no fallback data available.`,
      );
      return { data: [] };
    };

    const trendingData = extractData(trending[0], "trendingAnime");
    const popularData = extractData(popular[0], "popularAnime");
    const upcomingData = extractData(upcoming[0], "upcomingAnime");
    const topMangaData = extractData(topManga[0], "topManga");
    const publishingMangaData = extractData(publishingManga[0], "publishingManga");

    return {
      trendingAnime: trendingData.data || [],
      popularAnime: popularData.data || [],
      upcomingAnime: upcomingData.data || [],
      topManga: topMangaData.data || [],
      publishingManga: publishingMangaData.data || [],
      timestamp: new Date().toISOString(),
    };
  }
}
