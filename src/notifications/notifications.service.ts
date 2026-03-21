import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { NotificationType } from "@prisma/client";
import { NotificationsGateway } from "./notifications.gateway";

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private notificationsGateway: NotificationsGateway,
  ) {}

  async create(data: {
    recipientId: string;
    senderId?: string;
    type: NotificationType;
    message?: string;
    entityId?: string;
    link?: string;
  }) {
    const notification = await this.prisma.notification.create({
      data: {
        recipientId: data.recipientId,
        senderId: data.senderId,
        type: data.type,
        message: data.message,
        entityId: data.entityId,
        link: data.link,
      },
      include: {
        sender: {
          select: { id: true, username: true, avatar: true, firstName: true },
        },
      },
    });

    // Emit real-time notification
    this.notificationsGateway.emitNotification(data.recipientId, notification);

    return notification;
  }

  async findAll(userId: string) {
    return this.prisma.notification.findMany({
      where: { recipientId: userId },
      include: {
        sender: {
          select: { id: true, username: true, avatar: true, firstName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20, // Limit to recent 20
    });
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { recipientId: userId, read: false },
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId: userId },
      data: { read: true },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { recipientId: userId, read: false },
      data: { read: true },
    });
  }
}
