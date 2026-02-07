import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) { }

  async getStats() {
    try {
      const [
        totalUsers,
        totalFavorites,
        totalWatchlist,
        totalManga,
        unreadMessages,
        watchlistStats,
        mangaStats,
      ] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.favorite.count(),
        this.prisma.watchlist.count(),
        this.prisma.userManga.count(),
        this.prisma.contact.count({ where: { isRead: false } }),
        this.prisma.watchlist.groupBy({
          by: ["status"],
          _count: { _all: true },
        }),
        this.prisma.userManga.groupBy({
          by: ["status"],
          _count: { _all: true },
        }),
      ]);

      // Logger
      console.log(
        `[AdminStats] Users: ${totalUsers}, Favorites: ${totalFavorites}, Watchlist: ${totalWatchlist}, Manga: ${totalManga}`,
      );
      console.log(
        `[AdminStats] Distribution - Watchlist: ${JSON.stringify(watchlistStats)}, Manga: ${JSON.stringify(mangaStats)}`,
      );

      // Get Top 5 Favorited Anime
      const topFavorites = await this.prisma.favorite.groupBy({
        by: ["animeId", "animeTitle", "animeImage"],
        _count: {
          id: true,
        },
        orderBy: {
          _count: {
            id: "desc",
          },
        },
        take: 5,
      });

      // Get Top 5 Watchlisted Anime
      const topWatchlist = await this.prisma.watchlist.groupBy({
        by: ["animeId", "animeTitle", "animeImage"],
        _count: {
          id: true,
        },
        orderBy: {
          _count: {
            id: "desc",
          },
        },
        take: 5,
      });

      // Get Top 5 Favorited Manga
      const topMangaFavorites = await this.prisma.favoriteManga.groupBy({
        by: ["mangaId", "mangaTitle", "mangaImage"],
        _count: {
          id: true,
        },
        orderBy: {
          _count: {
            id: "desc",
          },
        },
        take: 5,
      });

      // Get Top 5 User Manga (Most Read/Planned)
      const topMangaList = await this.prisma.userManga.groupBy({
        by: ["mangaId", "mangaTitle", "mangaImage"],
        _count: {
          id: true,
        },
        orderBy: {
          _count: {
            id: "desc",
          },
        },
        take: 5,
      });

      // Get Top 5 Users (Level/XP)
      const topUsers = await this.prisma.user.findMany({
        take: 5,
        orderBy: [{ level: "desc" }, { xp: "desc" }],
        select: {
          id: true,
          username: true,
          email: true,
          level: true,
          xp: true,
          avatar: true,
        },
      });

      // Get recent registrations
      const recentUsers = await this.prisma.user.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          username: true,
          createdAt: true,
          avatar: true,
          role: true,
        },
      });

      return {
        totalUsers,
        totalFavorites,
        totalWatchlist,
        totalManga,
        unreadMessages,
        watchlistStats: watchlistStats.reduce((acc, curr: any) => {
          acc[curr.status] =
            typeof curr._count === "number"
              ? curr._count
              : curr._count?._all || 0;
          return acc;
        }, {}),
        mangaStats: mangaStats.reduce((acc, curr: any) => {
          acc[curr.status] =
            typeof curr._count === "number"
              ? curr._count
              : curr._count?._all || 0;
          return acc;
        }, {}),
        topFavorites: topFavorites.map((item) => ({
          id: item.animeId,
          title: item.animeTitle,
          image: item.animeImage,
          count: item._count.id,
        })),
        topWatchlist: topWatchlist.map((item) => ({
          id: item.animeId,
          title: item.animeTitle,
          image: item.animeImage,
          count: item._count.id,
        })),
        topMangaFavorites: topMangaFavorites.map((item) => ({
          id: item.mangaId,
          title: item.mangaTitle,
          image: item.mangaImage,
          count: item._count.id,
        })),
        topMangaList: topMangaList.map((item) => ({
          id: item.mangaId,
          title: item.mangaTitle,
          image: item.mangaImage,
          count: item._count.id,
        })),
        topUsers,
        recentUsers,
      };
    } catch (error) {
      console.error("[AdminStats Error]", error);
      // Return empty stats instead of crashing the dashboard
      return {
        totalUsers: 0,
        totalFavorites: 0,
        totalWatchlist: 0,
        totalManga: 0,
        unreadMessages: 0,
        watchlistStats: {},
        mangaStats: {},
        topFavorites: [],
        topWatchlist: [],
        topMangaFavorites: [],
        topMangaList: [],
        topUsers: [],
        recentUsers: [],
      };
    }
  }

  async getMessages() {
    return this.prisma.contact.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  async markMessageAsRead(messageId: string) {
    return this.prisma.contact.update({
      where: { id: messageId },
      data: { isRead: true },
    });
  }

  async deleteMessage(messageId: string) {
    return this.prisma.contact.delete({
      where: { id: messageId },
    });
  }

  async getAllUsers() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        emailVerified: true,
        createdAt: true,
        avatar: true,
      },
    });
  }

  async updateUserRole(userId: string, role: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { role: role as any },
    });
  }

  async deleteUser(userId: string) {
    return this.prisma.user.delete({
      where: { id: userId },
    });
  }

  async getUserById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        emailVerified: true,
        createdAt: true,
        avatar: true,
        bio: true,
        level: true,
        xp: true,
      },
    });
  }

  async updateUser(userId: string, data: any) {
    // Remove sensitive fields if present
    const { id, password, createdAt, ...updateData } = data;
    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
  }

  async getMediaReport(type: "anime" | "manga", metric: string) {
    const model =
      type === "anime"
        ? metric === "favorites"
          ? this.prisma.favorite
          : this.prisma.watchlist
        : metric === "favorites"
          ? this.prisma.favoriteManga
          : this.prisma.userManga;

    const idField = type === "anime" ? "animeId" : "mangaId";
    const titleField = type === "anime" ? "animeTitle" : "mangaTitle";
    const imageField = type === "anime" ? "animeImage" : "mangaImage";

    const where: any = {};
    if (metric !== "favorites") {
      where.status = metric;
    }

    const stats = await (model as any).groupBy({
      by: [idField, titleField, imageField],
      where,
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: "desc",
        },
      },
    });

    return stats.map((s: any) => ({
      id: s[idField],
      title: s[titleField],
      image: s[imageField],
      count: s._count.id,
    }));
  }

  async getMediaItemAnalytics(
    type: "anime" | "manga",
    metric: string,
    mediaId: number,
  ) {
    const modelName =
      type === "anime"
        ? metric === "favorites"
          ? "favorite"
          : "watchlist"
        : metric === "favorites"
          ? "favoriteManga"
          : "userManga";

    const idField = type === "anime" ? "animeId" : "mangaId";
    const where: any = { [idField]: mediaId };
    if (metric !== "favorites") {
      where.status = metric.toUpperCase();
    }

    // Get daily growth (last 30 days)
    const entries = await (this.prisma as any)[modelName].findMany({
      where,
      select: {
        addedAt: true,
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            avatar: true,
            level: true,
          },
        },
      },
      orderBy: { addedAt: "asc" },
    });

    // Group by date
    const growth = entries.reduce((acc: any, curr: any) => {
      const date = curr.addedAt.toISOString().split("T")[0];
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {});

    const dailyGrowth = Object.entries(growth).map(([date, count]) => ({
      date,
      count,
    }));

    return {
      dailyGrowth,
      users: entries.map((e: any) => e.user),
    };
  }
}
