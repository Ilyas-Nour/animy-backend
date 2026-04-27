import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class NewsEngagementService {
  constructor(private prisma: PrismaService) {}

  async getEngagement(providerId: string, userId?: string) {
    // Initialize or find existing engagement record safely
    const engagement = await this.prisma.newsEngagement.upsert({
      where: { providerId },
      create: { providerId },
      update: {}, // No change needed if it already exists
    });

    // PERFORM DIRECT TABLE COUNTS (Source of Truth)
    // This ensures comments without an explicit engagementId but with the same providerId are counted.
    const [commentCount, reactionCount] = await Promise.all([
      this.prisma.comment.count({ where: { providerId } }),
      this.prisma.reaction.count({ where: { providerId, type: "LIKE" } }),
    ]);

    // Check if user has liked this post
    let isLiked = false;
    if (userId) {
      const reaction = await this.prisma.reaction.findFirst({
        where: { providerId, userId, type: "LIKE" },
      });
      isLiked = !!reaction;
    }

    return {
      ...engagement,
      _count: {
        comments: commentCount,
        reactions: reactionCount,
      },
      isLiked,
    };
  }

  async incrementViews(providerId: string) {
    return this.prisma.newsEngagement.upsert({
      where: { providerId },
      create: { providerId, views: 1 },
      update: { views: { increment: 1 } },
    });
  }
}
