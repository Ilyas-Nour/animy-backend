import {
  Injectable,
  InternalServerErrorException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationType } from "@prisma/client";

@Injectable()
export class CommentsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(
    userId: string,
    data: { providerId: string; content: string; parentId?: string },
  ) {
    try {
      // Ensure NewsEngagement exists (Shadow Post Logic) - Atomic Upsert
      const engagement = await this.prisma.newsEngagement.upsert({
        where: { providerId: data.providerId },
        update: {},
        create: { providerId: data.providerId },
      });

      const comment = await this.prisma.comment.create({
        data: {
          content: data.content,
          userId,
          providerId: data.providerId,
          engagementId: engagement.id,
          parentId: data.parentId,
        },
        include: {
          user: {
            select: { id: true, username: true, avatar: true, firstName: true },
          },
        },
      });

      // Trigger Notification if Replying
      if (data.parentId) {
        const parentComment = await this.prisma.comment.findUnique({
          where: { id: data.parentId },
          select: { userId: true },
        });

        if (parentComment && parentComment.userId !== userId) {
          await this.notifications.create({
            recipientId: parentComment.userId,
            senderId: userId,
            type: NotificationType.REPLY,
            message: `replied to your comment on post`,
            entityId: comment.id,
            link: `/news?postId=${data.providerId}#comment-${comment.id}`,
          });
        }
      }

      return comment;
    } catch (error) {
      console.error("[CommentsService] Error:", error);
      throw new InternalServerErrorException(
        `Comment failed: ${error.message}`,
      );
    }
  }

  async update(id: string, userId: string, content: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException("Comment not found");
    if (comment.userId !== userId)
      throw new ForbiddenException("Not authorized to edit this comment");

    return this.prisma.comment.update({
      where: { id },
      data: { content },
      include: {
        user: {
          select: { id: true, username: true, avatar: true, firstName: true },
        },
      },
    });
  }

  async remove(id: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException("Comment not found");
    if (comment.userId !== userId)
      throw new ForbiddenException("Not authorized to delete this comment");

    await this.prisma.comment.delete({ where: { id } });
    return { success: true };
  }

  async findAll(providerId: string, currentUserId?: string) {
    const comments = await this.prisma.comment.findMany({
      where: { providerId, parentId: null }, // Fetch top-level comments
      include: {
        user: {
          select: { id: true, username: true, avatar: true, firstName: true },
        },
        _count: { select: { reactions: true, replies: true } },
        replies: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatar: true,
                firstName: true,
              },
            },
            _count: { select: { reactions: true } },
            reactions: {
              select: { userId: true, type: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        reactions: {
          select: { userId: true, type: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Map isLiked for current user
    return comments.map((comment) => ({
      ...comment,
      isLiked: currentUserId
        ? comment.reactions.some(
            (r) => r.userId === currentUserId && r.type === "LIKE",
          )
        : false,
      replies: comment.replies.map((reply) => ({
        ...reply,
        isLiked: currentUserId
          ? reply.reactions.some(
              (r) => r.userId === currentUserId && r.type === "LIKE",
            )
          : false,
      })),
    }));
  }
}
