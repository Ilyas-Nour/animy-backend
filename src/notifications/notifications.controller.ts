import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  UseGuards,
  Req,
} from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { AuthGuard } from "@nestjs/passport";

@Controller("notifications")
@UseGuards(AuthGuard("jwt"))
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.notificationsService.findAll(req.user.id);
  }

  @Get("unread-count")
  getUnreadCount(@Req() req: any) {
    return this.notificationsService.getUnreadCount(req.user.id);
  }

  @Patch(":id/read")
  markAsRead(@Req() req: any, @Param("id") id: string) {
    return this.notificationsService.markAsRead(id, req.user.id);
  }

  @Post("mark-all-read")
  markAllRead(@Req() req: any) {
    return this.notificationsService.markAllRead(req.user.id);
  }
}
