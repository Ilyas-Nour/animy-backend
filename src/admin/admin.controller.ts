import {
  Controller,
  Get,
  UseGuards,
  Put,
  Param,
  Body,
  Delete,
} from "@nestjs/common";
import { AdminService } from "./admin.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { Role } from "@prisma/client";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("stats")
  async getStats() {
    return this.adminService.getStats();
  }

  @Get("users")
  async getUsers() {
    return this.adminService.getAllUsers();
  }

  @Put("users/:id/role")
  async updateUserRole(@Param("id") id: string, @Body("role") role: string) {
    return this.adminService.updateUserRole(id, role);
  }

  @Delete("users/:id")
  async deleteUser(@Param("id") id: string) {
    return this.adminService.deleteUser(id);
  }

  @Get("users/:id")
  async getUser(@Param("id") id: string) {
    return this.adminService.getUserById(id);
  }

  @Put("users/:id")
  async updateUser(@Param("id") id: string, @Body() data: any) {
    return this.adminService.updateUser(id, data);
  }

  @Get("messages")
  async getMessages() {
    return this.adminService.getMessages();
  }

  @Put("messages/:id/read")
  async markAsRead(@Param("id") id: string) {
    return this.adminService.markMessageAsRead(id);
  }

  @Delete("messages/:id")
  async deleteMessage(@Param("id") id: string) {
    return this.adminService.deleteMessage(id);
  }

  @Get("reports/:type/:metric")
  async getMediaReport(
    @Param("type") type: "anime" | "manga",
    @Param("metric") metric: string,
  ) {
    return this.adminService.getMediaReport(type, metric);
  }

  @Get("reports/details/:type/:metric/:id")
  async getMediaItemAnalytics(
    @Param("type") type: "anime" | "manga",
    @Param("metric") metric: string,
    @Param("id") id: string,
  ) {
    return this.adminService.getMediaItemAnalytics(type, metric, parseInt(id));
  }
}
