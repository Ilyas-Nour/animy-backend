import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { MessageType, MessageStatus } from "@prisma/client";

@Injectable()
export class ChatService {
  constructor(public prisma: PrismaService) {}

  /**
   * Validates if two users are friends with ACCEPTED status
   */
  async areFriends(userId1: string, userId2: string): Promise<boolean> {
    const friendship = await this.prisma.friend.findFirst({
      where: {
        OR: [
          { senderId: userId1, receiverId: userId2, status: "ACCEPTED" },
          { senderId: userId2, receiverId: userId1, status: "ACCEPTED" },
        ],
      },
    });

    return !!friendship;
  }

  /**
   * Gets or creates a conversation between two users
   */
  async getOrCreateConversation(user1Id: string, user2Id: string) {
    const [participant1, participant2] = [user1Id, user2Id].sort();

    let conversation = await this.prisma.conversation.findUnique({
      where: {
        participant1_participant2: { participant1, participant2 },
      },
      include: {
        user1: { select: { id: true, username: true, avatar: true } },
        user2: { select: { id: true, username: true, avatar: true } },
      },
    });

    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { participant1, participant2 },
        include: {
          user1: { select: { id: true, username: true, avatar: true } },
          user2: { select: { id: true, username: true, avatar: true } },
        },
      });
    }

    return conversation;
  }

  async saveMessage(
    conversationId: string,
    senderId: string,
    content: string,
    messageType: MessageType = MessageType.TEXT,
    animeId?: number,
    mediaOptions?: {
      mediaId?: string;
      mediaType?: string;
      mediaTitle?: string;
      mediaImage?: string;
    },
    parentId?: string,
  ) {
    return this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        content,
        messageType,
        animeId,
        mediaId: mediaOptions?.mediaId,
        mediaType: mediaOptions?.mediaType,
        mediaTitle: mediaOptions?.mediaTitle,
        mediaImage: mediaOptions?.mediaImage,
        status: MessageStatus.SENT,
        parentId,
      },
      include: {
        sender: { select: { id: true, username: true, avatar: true } },
        reactions: {
          include: { user: { select: { id: true, username: true } } },
        },
        parent: {
          include: {
            sender: { select: { id: true, username: true } },
          },
        },
      },
    });
  }

  /**
   * Gets messages for a conversation, filtering out those deleted by the user
   * or sent before the user cleared the chat.
   */
  async getConversationMessages(
    conversationId: string,
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) throw new NotFoundException("Conversation not found");

    // Determine the clear date for this specific user
    const clearedAt =
      conversation.participant1 === userId
        ? conversation.clearedAt1
        : conversation.clearedAt2;

    return this.prisma.message.findMany({
      where: {
        conversationId,
        createdAt: clearedAt ? { gt: clearedAt } : undefined,
        NOT: {
          deletedBy: { has: userId },
        },
      },
      include: {
        sender: { select: { id: true, username: true, avatar: true } },
        reactions: {
          include: { user: { select: { id: true, username: true } } },
        },
        parent: {
          include: {
            sender: { select: { id: true, username: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  async editMessage(messageId: string, userId: string, content: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException("Message not found");
    if (message.senderId !== userId)
      throw new ForbiddenException("Cannot edit others messages");
    if (message.isDeletedForAll)
      throw new BadRequestException("Cannot edit deleted message");

    return this.prisma.message.update({
      where: { id: messageId },
      data: { content, isEdited: true },
      include: {
        sender: { select: { id: true, username: true, avatar: true } },
        reactions: {
          include: { user: { select: { id: true, username: true } } },
        },
      },
    });
  }

  async deleteMessage(messageId: string, userId: string, forEveryone: boolean) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException("Message not found");

    if (forEveryone) {
      if (message.senderId !== userId)
        throw new ForbiddenException("Cannot delete for everyone");
      return this.prisma.message.update({
        where: { id: messageId },
        data: { isDeletedForAll: true, content: "This message was deleted" },
      });
    } else {
      // Delete for Me
      return this.prisma.message.update({
        where: { id: messageId },
        data: {
          deletedBy: { push: userId },
        },
      });
    }
  }

  async toggleReaction(messageId: string, userId: string, type: string) {
    const existing = await this.prisma.reaction.findFirst({
      where: { userId, messageId },
    });

    if (existing) {
      if (existing.type === type) {
        await this.prisma.reaction.delete({ where: { id: existing.id } });
        return { status: "removed" };
      }
      await this.prisma.reaction.update({
        where: { id: existing.id },
        data: { type },
      });
      return { status: "updated", type };
    }

    await this.prisma.reaction.create({
      data: { userId, messageId, type },
    });
    return { status: "created", type };
  }

  async clearConversation(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");

    const updateData =
      conversation.participant1 === userId
        ? { clearedAt1: new Date() }
        : { clearedAt2: new Date() };

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: updateData,
    });

    return { success: true };
  }

  async markAsRead(messageId: string) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.READ, read: true },
    });
  }

  async markConversationAsRead(conversationId: string, userId: string) {
    return this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        status: { not: MessageStatus.READ },
      },
      data: { status: MessageStatus.READ, read: true },
    });
  }

  async markAsDelivered(messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (message && message.status === MessageStatus.SENT) {
      return this.prisma.message.update({
        where: { id: messageId },
        data: { status: MessageStatus.DELIVERED },
      });
    }
    return message;
  }

  async getUserConversations(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: [{ participant1: userId }, { participant2: userId }],
      },
      include: {
        user1: { select: { id: true, username: true, avatar: true } },
        user2: { select: { id: true, username: true, avatar: true } },
        messages: {
          where: {
            NOT: { deletedBy: { has: userId } },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return Promise.all(
      conversations.map(async (conv) => {
        const clearedAt =
          conv.participant1 === userId ? conv.clearedAt1 : conv.clearedAt2;

        // Filter last message by clear date
        const lastMsg = conv.messages[0];
        const displayMessage =
          lastMsg && (!clearedAt || lastMsg.createdAt > clearedAt)
            ? lastMsg
            : null;

        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: conv.id,
            senderId: { not: userId },
            status: { not: MessageStatus.READ },
            createdAt: clearedAt ? { gt: clearedAt } : undefined,
            NOT: { deletedBy: { has: userId } },
          },
        });

        const friend = conv.participant1 === userId ? conv.user2 : conv.user1;

        return {
          ...conv,
          messages: displayMessage ? [displayMessage] : [],
          friend,
          unreadCount,
        };
      }),
    );
  }

  async getGlobalUnreadCount(userId: string) {
    // This needs to respect clearedAt too for accuracy
    const conversations = await this.prisma.conversation.findMany({
      where: { OR: [{ participant1: userId }, { participant2: userId }] },
    });

    let total = 0;
    for (const conv of conversations) {
      const clearedAt =
        conv.participant1 === userId ? conv.clearedAt1 : conv.clearedAt2;
      const count = await this.prisma.message.count({
        where: {
          conversationId: conv.id,
          senderId: { not: userId },
          status: { not: MessageStatus.READ },
          createdAt: clearedAt ? { gt: clearedAt } : undefined,
          NOT: { deletedBy: { has: userId } },
        },
      });
      total += count;
    }
    return total;
  }
}
