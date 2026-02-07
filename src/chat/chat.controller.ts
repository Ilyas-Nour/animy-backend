import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Request } from "express";
import { ChatService } from "./chat.service";
import { JwtService } from "@nestjs/jwt";

@Controller("chat")
@UseGuards(AuthGuard("jwt"))
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
  ) {}

  @Get("conversations")
  async getUserConversations(@Req() req: Request) {
    let user: any = req.user;
    // Aggressive Fallback: consistency check
    if ((!user || !user.id) && req.headers.authorization) {
      try {
        const token = req.headers.authorization.split(" ")[1];
        const decoded: any = this.jwtService.decode(token);
        if (decoded && decoded.sub) {
          user = { id: decoded.sub, ...decoded };
        }
      } catch (e) {
        console.error("Token decode failed", e);
      }
    }
    return this.chatService.getUserConversations(user.id);
  }

  @Get("unread-count")
  async getUnreadCount(@Req() req: Request) {
    let user: any = req.user;

    // Aggressive Fallback: consistency check
    if ((!user || !user.id) && req.headers.authorization) {
      try {
        const token = req.headers.authorization.split(" ")[1];
        const decoded: any = this.jwtService.decode(token);
        if (decoded && decoded.sub) {
          // console.log(`[CTRL] Manually decoded token: ${decoded.sub}`);
          user = { id: decoded.sub, ...decoded };
        }
      } catch (e) {
        console.error("[CTRL] Failed to manual decode token", e);
      }
    }

    const userId = user?.id || user?.sub;
    let count = 0;

    if (userId) {
      count = await this.chatService.getGlobalUnreadCount(userId);
    }

    return { count };
  }
}
