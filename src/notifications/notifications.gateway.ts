import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { JwtService } from "@nestjs/jwt";
import { Injectable, Logger } from "@nestjs/common";

interface AuthenticatedSocket extends Socket {
    userId?: string;
}

@WebSocketGateway({
    cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        credentials: true,
    },
})
@Injectable()
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger('NotificationsGateway');

    constructor(private jwtService: JwtService) { }

    async handleConnection(client: AuthenticatedSocket) {
        try {
            const token = client.handshake.auth.token;
            if (!token) return client.disconnect();

            const payload = this.jwtService.verify(token);
            const userId = payload.sub;
            client.userId = userId;

            // Join a dedicated notification room for this user
            await client.join(`user_${userId}_notif`);
            this.logger.log(`User ${userId} connected to notification uplink.`);
        } catch (error) {
            client.disconnect();
        }
    }

    handleDisconnect(client: AuthenticatedSocket) {
        if (client.userId) {
            this.logger.log(`User ${client.userId} disconnected from notification uplink.`);
        }
    }

    emitNotification(recipientId: string, notification: any) {
        this.server.to(`user_${recipientId}_notif`).emit("notification:receive", notification);
    }
}
