import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationType } from "@prisma/client";

@Injectable()
export class ReactionsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async toggleReaction(
    userId: string,
    data: {
      type: string;
      providerId?: string;
      commentId?: string;
    },
  ) {
    try {
      // If reacting to News (Reddit Post)
      let engagementId = null;
      if (data.providerId) {
        // Ensure Engagement Exists
        let engagement = await this.prisma.newsEngagement.findUnique({
          where: { providerId: data.providerId },
        });
        if (!engagement) {
          // Upsert logic (safe for concurrency)
          engagement = await this.prisma.newsEngagement.upsert({
            where: { providerId: data.providerId },
            update: {},
            create: { providerId: data.providerId },
          });
        }
        engagementId = engagement.id;
      }

      // Check existing reaction
      const existing = await this.prisma.reaction.findFirst({
        where: {
          userId,
          providerId: data.providerId || undefined,
          commentId: data.commentId || undefined,
        },
      });

      if (existing) {
        // Toggle OFF if same type
        if (existing.type === data.type) {
          await this.prisma.reaction.delete({ where: { id: existing.id } });
          return { status: "removed" };
        }
        // Update to new type
        await this.prisma.reaction.update({
          where: { id: existing.id },
          data: { type: data.type },
        });
        return { status: "updated", type: data.type };
      }

      // Create New Reaction
      await this.prisma.reaction.create({
        data: {
          userId,
          type: data.type,
          providerId: data.providerId,
          engagementId,
          commentId: data.commentId,
        },
      });

      // Notify Author if reacting to comment
      if (data.commentId) {
        const comment = await this.prisma.comment.findUnique({
          where: { id: data.commentId },
        });
        if (comment && comment.userId !== userId) {
          await this.notifications.create({
            recipientId: comment.userId,
            senderId: userId,
            type: NotificationType.REACTION,
            message: `reacted to your comment`,
            entityId: data.commentId,
            link: `/news?postId=${comment.providerId}#comment-${data.commentId}`,
          });
        }
      }

      return { status: "created", type: data.type };
    } catch (error) {
      console.error("[ReactionsService] Error:", error);
      throw new InternalServerErrorException(
        `Reaction failed: ${error.message}`,
      );
    }
  }
}
