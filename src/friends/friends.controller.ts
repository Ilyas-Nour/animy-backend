import { Controller, Post, Body, Get, UseGuards, Req } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Request } from "express";
import { FriendsService } from "./friends.service";
import { CreateFriendRequestDto } from "./dto/create-friend-request.dto";
import { RespondFriendRequestDto } from "./dto/respond-friend-request.dto";

@Controller("friends")
@UseGuards(AuthGuard("jwt"))
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Post("request")
  async sendRequest(@Req() req: Request, @Body() dto: CreateFriendRequestDto) {
    const user: any = req.user;
    return this.friendsService.sendRequest(user.id, dto.username);
  }

  @Post("accept")
  async acceptRequest(
    @Req() req: Request,
    @Body() dto: RespondFriendRequestDto,
  ) {
    const user: any = req.user;
    return this.friendsService.acceptRequest(user.id, dto.requestId);
  }

  @Post("reject")
  async rejectRequest(
    @Req() req: Request,
    @Body() dto: RespondFriendRequestDto,
  ) {
    const user: any = req.user;
    return this.friendsService.rejectRequest(user.id, dto.requestId);
  }

  @Get("list")
  async listFriends(@Req() req: Request) {
    const user: any = req.user;
    console.log(
      `FriendsController: List request for user ${user?.id} (${user?.username})`,
    );
    return this.friendsService.listFriends(user.id);
  }

  @Post("remove")
  async removeFriend(@Req() req: Request, @Body() body: { friendId: string }) {
    const user: any = req.user;
    return this.friendsService.removeFriend(user.id, body.friendId);
  }
}
