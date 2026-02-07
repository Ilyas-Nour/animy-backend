import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

export const XP_REWARDS = {
  FAVORITE: 100,
  LIST_ADD: 50,
  FRIEND_ADD: 200,
};

@Injectable()
export class XpService {
  constructor(private prisma: PrismaService) {}

  /**
   * Calculate XP required for a specific level
   */
  getXpForLevel(level: number): number {
    if (level < 1) return 0;
    // Exponential curve: 1000 * (level ^ 1.8)
    return Math.floor(1000 * Math.pow(level, 1.8));
  }

  /**
   * Get Rank Name based on level
   */
  getRankName(level: number): string {
    if (level >= 100) return "Legend";
    if (level >= 50) return "Sensei";
    if (level >= 25) return "Elite Otaku";
    if (level >= 10) return "Otaku";
    return "Initiate";
  }

  /**
   * Adds XP to a user and handles leveling up
   */
  async addXp(userId: string, amount: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { xp: true, level: true },
    });

    if (!user) return null;

    let newXp = user.xp + amount;
    let newLevel = user.level;

    // Check for level up
    let xpNeeded = this.getXpForLevel(newLevel);
    while (newXp >= xpNeeded) {
      newXp -= xpNeeded;
      newLevel++;
      xpNeeded = this.getXpForLevel(newLevel);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        xp: newXp,
        level: newLevel,
      },
      select: {
        id: true,
        xp: true,
        level: true,
        username: true,
      },
    });
  }

  /**
   * Calculate progress percentage to next level
   */
  getLevelProgress(xp: number, level: number): number {
    const needed = this.getXpForLevel(level);
    if (needed === 0) return 0;
    return Math.min(Math.round((xp / needed) * 100), 100);
  }

  /**
   * Calculate Level and Current XP from Total Lifetime XP
   */
  calculateLevelAndXp(totalLifetimeXp: number): { level: number; xp: number } {
    let level = 1;
    let xp = totalLifetimeXp;
    let needed = this.getXpForLevel(level);

    while (xp >= needed) {
      xp -= needed;
      level++;
      needed = this.getXpForLevel(level);
    }

    return { level, xp };
  }
}
