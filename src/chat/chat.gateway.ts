import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { ChatService } from "./chat.service";
import { JwtService } from "@nestjs/jwt";
import { MessageType, MessageStatus } from "@prisma/client";

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private onlineUsers = new Map<string, string>();

  constructor(
    public chatService: ChatService,
    private jwtService: JwtService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth.token;
      if (!token) return client.disconnect();

      const payload = this.jwtService.verify(token);
      const userId = payload.sub;
      client.userId = userId;

      this.onlineUsers.set(userId, client.id);
      client.join(`user_${userId}`);
      this.server.emit("user:online", { userId });
    } catch (error) {
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      this.onlineUsers.delete(client.userId);
      this.server.emit("user:offline", { userId: client.userId });
    }
  }

  @SubscribeMessage("message:send")
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    const senderId = client.userId;
    const conversation = await this.chatService.getOrCreateConversation(
      senderId,
      data.to,
    );

    const message = await this.chatService.saveMessage(
      conversation.id,
      senderId,
      data.content,
      data.type || MessageType.TEXT,
      data.animeId,
      data,
      data.parentId,
    );

    this.server.to(conversation.id).emit("message:receive", message);
    this.server.to(`user_${data.to}`).emit("message:notification", message);
    return message;
  }

  @SubscribeMessage("message:edit")
  async handleEditMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; content: string },
  ) {
    const updated = await this.chatService.editMessage(
      data.messageId,
      client.userId,
      data.content,
    );
    this.server.to(updated.conversationId).emit("message:updated", updated);
    return updated;
  }

  @SubscribeMessage("message:delete")
  async handleDeleteMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; forEveryone: boolean },
  ) {
    const result = await this.chatService.deleteMessage(
      data.messageId,
      client.userId,
      data.forEveryone,
    );

    if (data.forEveryone) {
      this.server
        .to(result.conversationId)
        .emit("message:deleted_all", { messageId: data.messageId });
    } else {
      client.emit("message:deleted_me", { messageId: data.messageId });
    }
    return { success: true };
  }

  @SubscribeMessage("message:react")
  async handleReactMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; type: string },
  ) {
    const result = await this.chatService.toggleReaction(
      data.messageId,
      client.userId,
      data.type,
    );

    // Fetch full message to include reactions for broadcast
    const message = await (this.chatService as any).prisma.message.findUnique({
      where: { id: data.messageId },
      include: {
        reactions: {
          include: { user: { select: { id: true, username: true } } },
        },
      },
    });

    if (message) {
      this.server.to(message.conversationId).emit("message:reactions_updated", {
        messageId: message.id,
        reactions: message.reactions,
      });
    }
    return result;
  }

  @SubscribeMessage("conversation:clear")
  async handleClearConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    await this.chatService.clearConversation(
      data.conversationId,
      client.userId,
    );
    client.emit("conversation:cleared", {
      conversationId: data.conversationId,
    });
    return { success: true };
  }

  @SubscribeMessage("conversation:join")
  async handleJoinConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { friendId: string },
  ) {
    const userId = client.userId;
    const conversation = await this.chatService.getOrCreateConversation(
      userId,
      data.friendId,
    );
    client.join(conversation.id);
    const messages = await this.chatService.getConversationMessages(
      conversation.id,
      userId,
    );

    client.emit("conversation:joined", {
      conversationId: conversation.id,
      messages: messages.reverse(),
      friend:
        conversation.user1.id === userId
          ? conversation.user2
          : conversation.user1,
    });
  }

  @SubscribeMessage("message:read")
  async handleMessageRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string },
  ) {
    const updated = await this.chatService.markAsRead(data.messageId);
    this.server.to(updated.conversationId).emit("message:status_update", {
      messageId: updated.id,
      status: MessageStatus.READ,
    });
  }

  @SubscribeMessage("conversation:read")
  async handleConversationRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.userId;
    await this.chatService.markConversationAsRead(data.conversationId, userId);

    // Notify the user that THEIR unread count should be updated
    client.emit("conversation:read_receipt", {
      conversationId: data.conversationId,
      readBy: userId,
    });

    // Notify the friend that their sent messages were read
    this.server.to(data.conversationId).emit("conversation:read_receipt", {
      conversationId: data.conversationId,
      readBy: userId,
    });
  }

  @SubscribeMessage("typing:start")
  handleTypingStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    client
      .to(data.conversationId)
      .emit("typing:active", { userId: client.userId });
  }

  @SubscribeMessage("typing:stop")
  handleTypingStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    client
      .to(data.conversationId)
      .emit("typing:inactive", { userId: client.userId });
  }
}
