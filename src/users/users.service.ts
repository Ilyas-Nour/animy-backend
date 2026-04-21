import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { Prisma, User, WatchStatus, MangaStatus } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { XpService, XP_REWARDS } from "./xp.service";
import { SupabaseService } from "../common/supabase.service";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly xpService: XpService,
    private readonly supabaseService: SupabaseService,
  ) {}
  // ... (start of methods)

  // ... skipping to getStats ...
  // Stats
  async getStats(userId: string) {
    try {
      // 1. Individual counts for simple tables
      const [favorites, mangaFavorites, totalFavoriteCharacters] =
        await Promise.all([
          this.prisma.favorite.count({ where: { userId } }),
          this.prisma.favoriteManga.count({ where: { userId } }),
          this.prisma.favoriteCharacter.count({ where: { userId } }),
        ]);

      // 2. Grouped counts for Watchlist (Anime)
      const watchlistGroups = await this.prisma.watchlist.groupBy({
        by: ["status"],
        where: { userId },
        _count: { _all: true },
      });

      // 3. Grouped counts for UserManga
      const userMangaGroups = await this.prisma.userManga.groupBy({
        by: ["status"],
        where: { userId },
        _count: { _all: true },
      });

      // Helper to extract count from groups
      const getCount = (groups: any[], status: string) =>
        groups.find((g) => g.status === status)?._count._all || 0;

      const stats = {
        totalFavorites: favorites,
        totalWatchlist: watchlistGroups.reduce(
          (acc, g) => acc + g._count._all,
          0,
        ),
        watching: getCount(watchlistGroups, WatchStatus.WATCHING),
        completed: getCount(watchlistGroups, WatchStatus.COMPLETED),
        onHold: getCount(watchlistGroups, WatchStatus.ON_HOLD),
        dropped: getCount(watchlistGroups, WatchStatus.DROPPED),
        planToWatch: getCount(watchlistGroups, WatchStatus.PLAN_TO_WATCH),

        // Manga Stats
        totalFavoriteManga: mangaFavorites,
        totalMangaList: userMangaGroups.reduce(
          (acc, g) => acc + g._count._all,
          0,
        ),
        reading: getCount(userMangaGroups, MangaStatus.READING),
        completedManga: getCount(userMangaGroups, MangaStatus.COMPLETED),
        onHoldManga: getCount(userMangaGroups, MangaStatus.ON_HOLD),
        droppedManga: getCount(userMangaGroups, MangaStatus.DROPPED),
        planToRead: getCount(userMangaGroups, MangaStatus.PLAN_TO_READ),
        totalFavoriteCharacters,
      };

      console.log(`[Stats Final] Optimized result for user ${userId}:`, stats);
      return stats;
    } catch (error) {
      console.error("[Stats Error] Failed to get stats:", error);
      throw error;
    }
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({
      data,
    });
  }

  async update(
    id: string,
    data: Prisma.UserUpdateInput,
  ): Promise<Omit<User, "password">> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (data.username && typeof data.username === "string") {
      const existingUser = await this.prisma.user.findUnique({
        where: { username: data.username },
      });

      if (existingUser && existingUser.id !== id) {
        throw new BadRequestException("Username is already taken");
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatar: true,
        bannerUrl: true,
        interests: true,
        provider: true,
        emailVerified: true,
        updatedAt: true,
        createdAt: true,
        providerId: true,
        xp: true,
        level: true,
        lastCheckIn: true,
        role: true,
        // Social Links
        instagram: true,
        github: true,
        linkedin: true,
        tiktok: true,
        whatsapp: true,
        facebook: true,
        snapchat: true,
      },
    });

    return {
      ...updatedUser,
      rank: this.xpService.getRankName(updatedUser.level),
      levelProgress: this.xpService.getLevelProgress(
        updatedUser.xp,
        updatedUser.level,
      ),
      nextLevelXp: this.xpService.getXpForLevel(updatedUser.level),
    } as any;
  }

  async findById(id: string): Promise<Omit<User, "password"> | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatar: true,
        bannerUrl: true,
        interests: true,
        provider: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        providerId: true,
        xp: true,
        level: true,
        lastCheckIn: true,
        role: true,
        password: false,
        // Social Links
        instagram: true,
        github: true,
        linkedin: true,
        tiktok: true,
        whatsapp: true,
        facebook: true,
        snapchat: true,
      },
    });

    if (!user) {
      return null;
    }

    return {
      ...user,
      rank: this.xpService.getRankName(user.level),
      levelProgress: this.xpService.getLevelProgress(user.xp, user.level),
      nextLevelXp: this.xpService.getXpForLevel(user.level),
    } as any;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  // Find by username
  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { username },
    });
  }

  // Get User Profile with Privacy Logic
  async getUserProfile(viewerId: string | null, username: string) {
    const targetUser = await this.findByUsername(username);

    if (!targetUser) {
      throw new NotFoundException("User not found");
    }

    // Auto-fix XP if needed
    if (targetUser.level === 1 && targetUser.xp === 0) {
      // We can recalculate here. But we need to use the recalculated user for the response.
      // Recalculate returns "findById" result.
      // However, we already fetched `targetUser` (raw prisma user).
      // We should run the update then fetch.
      await this.recalculateXp(targetUser.id);
      // Re-fetch standard user
      const updatedUser = await this.findByUsername(username);
      if (updatedUser) {
        Object.assign(targetUser, updatedUser);
      }
    }

    // Basic public info
    const publicProfile = {
      id: targetUser.id,
      username: targetUser.username,
      firstName: targetUser.firstName,
      lastName: targetUser.lastName,
      bio: targetUser.bio,
      avatar: targetUser.avatar,
      bannerUrl: targetUser.bannerUrl,
      interests: targetUser.interests,
      createdAt: targetUser.createdAt,
      xp: targetUser.xp,
      level: targetUser.level,
      rank: this.xpService.getRankName(targetUser.level),
      levelProgress: this.xpService.getLevelProgress(
        targetUser.xp,
        targetUser.level,
      ),
      nextLevelXp: this.xpService.getXpForLevel(targetUser.level),
    };

    let friendshipStatus: any = "NONE";
    let isFriend = false;

    if (viewerId) {
      // Check friendship status
      // We can inject FriendsService here or duplicate logic.
      // Since we can't easily inject FriendsService due to circular dependency (UsersModule <-> FriendsModule),
      // we'll implement the check here or use forwardRef.
      // However, Prisma makes it easy to check directly.

      if (viewerId === targetUser.id) {
        friendshipStatus = "SELF";
        isFriend = true; // Treated as friend for full access
      } else {
        const friendship = await this.prisma.friend.findFirst({
          where: {
            OR: [
              { senderId: viewerId, receiverId: targetUser.id },
              { senderId: targetUser.id, receiverId: viewerId },
            ],
          },
        });

        if (friendship) {
          friendshipStatus = friendship.status;
          isFriend = friendship.status === "ACCEPTED";
        }
      }
    }

    // Determine what data to return
    let additionalData = {};

    if (isFriend || friendshipStatus === "SELF") {
      // Allow SELF to see own profile data too via this endpoint if used
      // Fetch full dashboard stats/lists
      const stats = await this.getStats(targetUser.id);
      const favorites = await this.getFavorites(targetUser.id);
      const favoriteManga = await this.getFavoriteManga(targetUser.id);
      // Limit lists if needed, currently returning all

      additionalData = {
        stats,
        favorites: favorites.slice(0, 5), // Preview
        favoriteManga: favoriteManga.slice(0, 5), // Preview
        badges: await this.getBadges(targetUser.id),
        // Add more if needed
      };
    }

    return {
      user: publicProfile,
      ...additionalData,
      friendshipStatus,
      isFriend,
    };
  }

  // Upload avatar to Supabase
  async uploadAvatar(
    userId: string,
    buffer: Buffer,
    filename: string,
    contentType: string,
  ): Promise<Omit<User, "password">> {
    // Get current user to check for old avatar
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true },
    });

    // Upload to Supabase
    const avatarUrl = await this.supabaseService.uploadFile(
      "avatars",
      buffer,
      filename,
      contentType,
    );

    if (!avatarUrl) {
      throw new BadRequestException("Failed to upload avatar");
    }

    const updatedUser = await this.update(userId, { avatar: avatarUrl });

    // Clean up old file from Supabase if it exists
    if (currentUser?.avatar && currentUser.avatar.includes("supabase")) {
      const oldFilename = currentUser.avatar.split("/").pop();
      if (oldFilename) {
        await this.supabaseService.deleteFile("avatars", oldFilename);
      }
    }

    return updatedUser;
  }

  // Upload banner to Supabase
  async uploadBanner(
    userId: string,
    buffer: Buffer,
    filename: string,
    contentType: string,
  ): Promise<Omit<User, "password">> {
    // Get current user to check for old banner
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { bannerUrl: true },
    });

    // Upload to Supabase
    const bannerUrl = await this.supabaseService.uploadFile(
      "banners",
      buffer,
      filename,
      contentType,
    );

    if (!bannerUrl) {
      throw new BadRequestException("Failed to upload banner");
    }

    const updatedUser = await this.update(userId, { bannerUrl });

    // Clean up old file from Supabase if it exists
    if (currentUser?.bannerUrl && currentUser.bannerUrl.includes("supabase")) {
      const oldFilename = currentUser.bannerUrl.split("/").pop();
      if (oldFilename) {
        await this.supabaseService.deleteFile("banners", oldFilename);
      }
    }

    return updatedUser;
  }

  async updatePassword(
    id: string,
    dto: { currentPassword: string; newPassword: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Check if user has a password (OAuth users don't)
    if (!user.password) {
      throw new BadRequestException("Cannot update password for OAuth users");
    }

    // Verify current password
    const isValid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isValid) {
      throw new BadRequestException("Current password is incorrect");
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    return this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
      select: {
        id: true,
        email: true,
        updatedAt: true,
      },
    });
  }

  // Favorites
  async getFavorites(userId: string) {
    return this.prisma.favorite.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
    });
  }

  async addFavorite(
    userId: string,
    animeId: number,
    animeTitle: string,
    animeImage?: string,
  ) {
    try {
      const fav = await this.prisma.favorite.create({
        data: {
          userId,
          animeId,
          animeTitle,
          animeImage,
        },
      });

      // Award XP
      const userUpdates = await this.xpService.addXp(
        userId,
        XP_REWARDS.FAVORITE,
      );

      return {
        ...fav,
        userUpdates,
      };
    } catch (error) {
      // Already exists
      throw new BadRequestException("Anime already in favorites");
    }
  }

  async removeFavorite(userId: string, animeId: number) {
    return this.prisma.favorite.deleteMany({
      where: { userId, animeId },
    });
  }

  // Watchlist
  async getWatchlist(userId: string) {
    return this.prisma.watchlist.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
  }

  async addToWatchlist(
    userId: string,
    dto: {
      animeId: number;
      animeTitle: string;
      animeImage?: string;
      status?: WatchStatus;
    },
  ) {
    const result = await this.prisma.watchlist.upsert({
      where: {
        userId_animeId: {
          userId,
          animeId: dto.animeId,
        },
      },
      update: {
        status: dto.status || WatchStatus.PLAN_TO_WATCH,
        animeTitle: dto.animeTitle,
        animeImage: dto.animeImage,
      },
      create: {
        userId,
        animeId: dto.animeId,
        animeTitle: dto.animeTitle,
        animeImage: dto.animeImage,
        status: dto.status || WatchStatus.PLAN_TO_WATCH,
      },
    });

    // Award XP
    const userUpdates = await this.xpService.addXp(userId, XP_REWARDS.LIST_ADD);

    return {
      ...result,
      userUpdates,
    };
  }

  async updateWatchlistStatus(
    userId: string,
    animeId: number,
    status: WatchStatus,
  ) {
    return this.prisma.watchlist.update({
      where: {
        userId_animeId: {
          userId,
          animeId,
        },
      },
      data: { status },
    });
  }

  async removeFromWatchlist(userId: string, animeId: number) {
    return this.prisma.watchlist.deleteMany({
      where: { userId, animeId },
    });
  }

  // Stats
  // Manga Favorites
  async getFavoriteManga(userId: string) {
    return this.prisma.favoriteManga.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
    });
  }

  async addFavoriteManga(
    userId: string,
    mangaId: number,
    title: string,
    image?: string,
  ) {
    try {
      const fav = await this.prisma.favoriteManga.create({
        data: {
          userId,
          mangaId,
          mangaTitle: title,
          mangaImage: image,
        },
      });

      // Award XP
      const userUpdates = await this.xpService.addXp(
        userId,
        XP_REWARDS.FAVORITE,
      );

      return {
        ...fav,
        userUpdates,
      };
    } catch (error) {
      // Already exists
      throw new BadRequestException("Manga already in favorites");
    }
  }

  async removeFavoriteManga(userId: string, mangaId: number) {
    return this.prisma.favoriteManga.deleteMany({
      where: { userId, mangaId },
    });
  }

  // Manga List
  async getMangaList(userId: string) {
    return this.prisma.userManga.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
  }

  async addToMangaList(
    userId: string,
    dto: {
      mangaId: number;
      title: string;
      image?: string;
      status?: MangaStatus;
    },
  ) {
    const result = await this.prisma.userManga.upsert({
      where: {
        userId_mangaId: {
          userId,
          mangaId: dto.mangaId,
        },
      },
      update: {
        status: dto.status || MangaStatus.PLAN_TO_READ,
        mangaTitle: dto.title,
        mangaImage: dto.image,
      },
      create: {
        userId,
        mangaId: dto.mangaId,
        mangaTitle: dto.title,
        mangaImage: dto.image,
        status: dto.status || MangaStatus.PLAN_TO_READ,
      },
    });

    // Award XP
    const userUpdates = await this.xpService.addXp(userId, XP_REWARDS.LIST_ADD);

    return {
      ...result,
      userUpdates,
    };
  }

  async updateMangaListStatus(
    userId: string,
    mangaId: number,
    status: MangaStatus,
  ) {
    return this.prisma.userManga.update({
      where: {
        userId_mangaId: {
          userId,
          mangaId,
        },
      },
      data: { status },
    });
  }

  async removeFromMangaList(userId: string, mangaId: number) {
    return this.prisma.userManga.deleteMany({
      where: { userId, mangaId },
    });
  }

  // Character Favorites
  async getFavoriteCharacters(userId: string) {
    return this.prisma.favoriteCharacter.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
    });
  }

  async addFavoriteCharacter(
    userId: string,
    dto: {
      characterId: number;
      name: string;
      imageUrl?: string;
      role?: string;
    },
  ) {
    try {
      const result = await this.prisma.favoriteCharacter.upsert({
        where: {
          userId_characterId: {
            userId,
            characterId: dto.characterId,
          },
        },
        update: {
          name: dto.name,
          imageUrl: dto.imageUrl,
          role: dto.role,
        },
        create: {
          userId,
          characterId: dto.characterId,
          name: dto.name,
          imageUrl: dto.imageUrl,
          role: dto.role,
        },
      });

      // Award XP
      await this.xpService.addXp(userId, XP_REWARDS.FAVORITE);

      return { message: "Character added to favorites", data: result };
    } catch (error) {
      console.error("Error adding favorite character:", error);
      throw new BadRequestException("Failed to add favorite character");
    }
  }

  async removeFavoriteCharacter(userId: string, characterId: number) {
    return this.prisma.favoriteCharacter.deleteMany({
      where: { userId, characterId },
    });
  }

  // Badges
  async getBadges(userId: string) {
    const userBadges = await this.prisma.userBadge.findMany({
      where: { userId },
      include: { badge: true },
      orderBy: { unlockedAt: "desc" },
    });
    return userBadges.map((ub) => ({
      ...ub.badge,
      unlockedAt: ub.unlockedAt,
    }));
  }

  // Leaderboard
  async getLeaderboard() {
    // Get top 20 users by XP
    const users = await this.prisma.user.findMany({
      orderBy: { xp: "desc" },
      take: 20,
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        level: true,
        xp: true,
      },
    });

    // Add rank name
    return users.map((user) => ({
      ...user,
      rank: this.xpService.getRankName(user.level),
    }));
  }

  // Recalculate XP
  async recalculateXp(userId: string) {
    // 1. Get Stats (covers most items)
    const stats = await this.getStats(userId);

    // 2. Count Friends (Accepted only)
    const friendCount = await this.prisma.friend.count({
      where: {
        OR: [
          { senderId: userId, status: "ACCEPTED" },
          { receiverId: userId, status: "ACCEPTED" },
        ],
      },
    });

    // 3. Calculate Total XP
    // Favorites: 100
    // List Items: 50
    // Friends: 200
    const totalFavorites =
      stats.totalFavorites +
      stats.totalFavoriteManga +
      stats.totalFavoriteCharacters;
    const totalListItems = stats.totalWatchlist + stats.totalMangaList; // Note: This counts everything including plan to watch.

    // We should probably rely on the same constants but for now:
    const xpFromFavorites = totalFavorites * XP_REWARDS.FAVORITE;
    const xpFromLists = totalListItems * XP_REWARDS.LIST_ADD;
    const xpFromFriends = friendCount * XP_REWARDS.FRIEND_ADD;

    const totalLifetimeXp = xpFromFavorites + xpFromLists + xpFromFriends;

    // 4. Calculate Level & Current XP
    const { level, xp } = this.xpService.calculateLevelAndXp(totalLifetimeXp);

    // 5. Update User
    if (totalLifetimeXp > 0) {
      console.log(
        `[XP Fix] Recalculating for ${userId}: TotalXP=${totalLifetimeXp} -> Level ${level}, XP ${xp}`,
      );
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          level,
          xp,
        },
        select: {
          id: true,
          xp: true,
          level: true,
        },
      });

      // Return formatted user
      return this.findById(userId);
    }

    return this.findById(userId);
  }

  // Daily Reward
  async claimDailyReward(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new NotFoundException("User not found");

    const now = new Date();
    const lastCheckIn = user.lastCheckIn ? new Date(user.lastCheckIn) : null;

    // Check if already claimed today
    if (lastCheckIn) {
      if (
        lastCheckIn.getDate() === now.getDate() &&
        lastCheckIn.getMonth() === now.getMonth() &&
        lastCheckIn.getFullYear() === now.getFullYear()
      ) {
        throw new BadRequestException("Daily reward already claimed today");
      }
    }

    // Award XP (50 XP for daily)
    await this.xpService.addXp(userId, 50);

    // Update last check-in
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        lastCheckIn: now,
      },
    });

    return { message: "Daily reward claimed", xpAwarded: 50 };
  }

  // Discovery Suggestions
  async getDiscoverySuggestions(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, interests: true },
    });

    if (!user) throw new NotFoundException("User not found");

    // Fetch existing friends and pending requests to filter them out
    const existingConnections = await this.prisma.friend.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      select: { senderId: true, receiverId: true },
    });

    const connectedUserIds = new Set<string>();
    connectedUserIds.add(userId); // Filter self
    existingConnections.forEach((conn) => {
      connectedUserIds.add(conn.senderId);
      connectedUserIds.add(conn.receiverId);
    });

    const myInterests = user.interests || [];
    console.log(
      `[Discovery] SUGGESTION REQUEST for user ${userId}. My interests:`,
      myInterests,
    );
    console.log(`[Discovery] Filtered IDs:`, Array.from(connectedUserIds));

    if (myInterests.length === 0) {
      console.log(
        `[Discovery] User has no interests. Returning random baseline.`,
      );
      const randomUsers = await this.prisma.user.findMany({
        where: { id: { notIn: Array.from(connectedUserIds) } },
        take: 10,
        select: {
          id: true,
          username: true,
          firstName: true,
          avatar: true,
          bio: true,
          interests: true,
          level: true,
        },
      });
      return randomUsers.map((u) => ({
        ...u,
        matchScore: 10,
        sharedInterests: [],
      }));
    }

    // DEBUG: Check how many users total exist
    const totalOthers = await this.prisma.user.count({
      where: { id: { notIn: Array.from(connectedUserIds) } },
    });
    console.log(
      `[Discovery] Total other users in DB available for matching: ${totalOthers}`,
    );

    // Try finding exact overlaps
    const suggestedUsers = await this.prisma.user.findMany({
      where: {
        id: { notIn: Array.from(connectedUserIds) },
        interests: {
          hasSome: myInterests,
        },
      },
      take: 50,
      select: {
        id: true,
        username: true,
        firstName: true,
        avatar: true,
        bio: true,
        interests: true,
        level: true,
      },
    });

    console.log(
      `[Discovery] Prisma detected ${suggestedUsers.length} users with Shared Interests.`,
    );

    if (suggestedUsers.length === 0) {
      console.log(
        `[Discovery] NO overlapping interests found. Falling back to active users.`,
      );
      const activeUsers = await this.prisma.user.findMany({
        where: { id: { notIn: Array.from(connectedUserIds) } },
        take: 10,
        select: {
          id: true,
          username: true,
          firstName: true,
          avatar: true,
          bio: true,
          interests: true,
          level: true,
        },
      });
      // Return these with a low score but at least show cards
      return activeUsers.map((u) => ({
        ...u,
        matchScore: 5,
        sharedInterests: [],
      }));
    }

    // Process matches
    const processed = suggestedUsers.map((u) => {
      const uInterests = u.interests || [];
      const shared = uInterests.filter((i) => myInterests.includes(i));
      const score = Math.floor((shared.length / myInterests.length) * 100);

      console.log(
        `[Discovery] Match Found: ${u.username} (${shared.length} shared): ${uInterests.join(",")}`,
      );

      return {
        ...u,
        matchScore: Math.min(score || 1, 99),
        sharedInterests: shared,
      };
    });

    const sorted = processed.sort(
      (a, b) => b.matchScore - a.matchScore || b.level - a.level,
    );

    console.log(
      `[Discovery] Top suggestions finalized:`,
      sorted.slice(0, 3).map((s) => s.username),
    );

    return sorted.slice(0, 20);
  }

  async debugAllUserInterests() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        interests: true,
        level: true,
      },
    });
  }
}
