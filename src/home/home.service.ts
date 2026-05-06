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
    const cacheKey = "home_data_v1";
    
    try {
      const cached = await this.prisma.discoveryCache.findUnique({
        where: { key: cacheKey },
      });

      const now = new Date();
      const staleThreshold = 1000 * 60 * 30; // 30 minutes

      if (cached) {
        const isStale = now.getTime() - cached.updatedAt.getTime() > staleThreshold;
        
        if (isStale) {
          this.logger.debug("Home data stale, triggering background refresh");
          // Non-blocking refresh
          this.refreshHomeData(cacheKey).catch(err => 
            this.logger.error(`Background refresh failed: ${err.message}`)
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

  async refreshHomeData(key: string) {
    const data = await this.fetchFreshHomeData();
    
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

  private async fetchFreshHomeData() {
    this.logger.debug("Fetching fresh home data from providers...");
    
    // Parallel fetch with timeouts handled by individual services
    const [trending, popular, upcoming, topManga, publishingManga] = await Promise.allSettled([
      this.animeService.getTopAnime(undefined, "trending"),
      this.animeService.getTopAnime(undefined, "bypopularity"),
      this.animeService.getUpcomingNextSeason(),
      this.mangaService.searchManga({ order_by: "popularity", sort: "desc", limit: 15 }),
      this.mangaService.searchManga({ order_by: "popularity", sort: "desc", limit: 15 }),
    ]);

    const extractData = (res: any) => (res.status === "fulfilled" ? res.value : { data: [] });

    const trendingData = extractData(trending);
    const popularData = extractData(popular);
    const upcomingData = extractData(upcoming);
    const topMangaData = extractData(topManga);
    const publishingMangaData = extractData(publishingManga);

    return {
      trendingAnime: trendingData.data || [],
      popularAnime: popularData.data || [],
      upcomingAnime: upcomingData.data || [],
      topManga: topMangaData.data || [],
      publishingManga: publishingMangaData.data || [],
      timestamp: new Date().toISOString()
    };
  }
}
