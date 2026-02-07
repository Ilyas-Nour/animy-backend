import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { FriendStatus } from "@prisma/client";
import { XpService, XP_REWARDS } from "../users/xp.service";

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly xpService: XpService,
  ) { }

  // Send friend request
  async sendRequest(senderId: string, username: string) {
    // 1. Find receiver
    const receiver = await this.prisma.user.findUnique({
      where: { username },
    });

    if (!receiver) {
      throw new NotFoundException("User not found");
    }

    if (receiver.id === senderId) {
      throw new BadRequestException("Cannot send friend request to yourself");
    }

    // 2. Check existing request (in either direction)
    const existingFriendship = await this.prisma.friend.findFirst({
      where: {
        OR: [
          { senderId: senderId, receiverId: receiver.id },
          { senderId: receiver.id, receiverId: senderId },
        ],
      },
    });

    if (existingFriendship) {
      if (existingFriendship.status === FriendStatus.ACCEPTED) {
        throw new ConflictException("You are already friends");
      }
      if (existingFriendship.status === FriendStatus.PENDING) {
        throw new ConflictException("Friend request already pending");
      }

      // If REJECTED, allow re-sending by updating state to PENDING
      if (existingFriendship.status === FriendStatus.REJECTED) {
        await this.prisma.friend.update({
          where: { id: existingFriendship.id },
          data: {
            status: FriendStatus.PENDING,
            senderId: senderId,
            receiverId: receiver.id, // Ensure direction is correct for new request
            createdAt: new Date(), // Refresh timestamp to show at top
          }
        });
        return { message: "Friend request sent" };
      }
    }

    // 3. Create request
    await this.prisma.friend.create({
      data: {
        senderId,
        receiverId: receiver.id,
        status: FriendStatus.PENDING,
      },
    });

    return { message: "Friend request sent" };
  }

  // Accept request
  async acceptRequest(userId: string, requestId: string) {
    const request = await this.prisma.friend.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException("Friend request not found");
    }

    // Only receiver can accept
    if (request.receiverId !== userId) {
      throw new BadRequestException("You can only accept requests sent to you");
    }

    if (request.status !== FriendStatus.PENDING) {
      throw new BadRequestException("Request is not pending");
    }

    await this.prisma.friend.update({
      where: { id: requestId },
      data: { status: FriendStatus.ACCEPTED },
    });

    // Award XP to both users
    await this.xpService.addXp(request.senderId, XP_REWARDS.FRIEND_ADD);
    await this.xpService.addXp(request.receiverId, XP_REWARDS.FRIEND_ADD);

    return { message: "Friend request accepted" };
  }

  // Reject request
  async rejectRequest(userId: string, requestId: string) {
    const request = await this.prisma.friend.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException("Friend request not found");
    }

    // Only receiver can reject
    if (request.receiverId !== userId) {
      throw new BadRequestException("You can only reject requests sent to you");
    }

    if (request.status !== FriendStatus.PENDING) {
      throw new BadRequestException("Request is not pending");
    }

    await this.prisma.friend.update({
      where: { id: requestId },
      data: { status: FriendStatus.REJECTED },
    });

    return { message: "Friend request rejected" };
  }

  // List friends and requests
  async listFriends(userId: string) {
    console.log(`FriendsService: Listing friends for user ${userId}`);

    // Get all records involving user
    const friends = await this.prisma.friend.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            avatar: true,
            firstName: true,
            lastName: true,
          },
        },
        receiver: {
          select: {
            id: true,
            username: true,
            avatar: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    console.log(
      `FriendsService: Found ${friends.length} total friendship records`,
    );
    friends.forEach((f) =>
      console.log(
        `- Friendship: ${f.id} | Status: ${f.status} | Sender: ${f.sender.username} | Receiver: ${f.receiver.username}`,
      ),
    );

    // Valid friends (ACCEPTED)
    const accepted = friends
      .filter((f) => f.status === FriendStatus.ACCEPTED)
      .map((f) => {
        // Return the OTHER user
        const otherUser = f.senderId === userId ? f.receiver : f.sender;
        return { ...otherUser, friendshipId: f.id, status: f.status };
      });

    console.log(`FriendsService: Accepted friends count: ${accepted.length}`);

    // Incoming requests (PENDING, receiver = me)
    const incoming = friends
      .filter(
        (f) => f.status === FriendStatus.PENDING && f.receiverId === userId,
      )
      .map((f) => ({
        ...f.sender,
        requestId: f.id,
        status: f.status,
        createdAt: f.createdAt,
      }));

    // Outgoing requests (PENDING, sender = me)
    const outgoing = friends
      .filter((f) => f.status === FriendStatus.PENDING && f.senderId === userId)
      .map((f) => ({
        ...f.receiver,
        requestId: f.id,
        status: f.status,
        createdAt: f.createdAt,
      }));

    return {
      friends: accepted,
      incomingRequests: incoming,
      outgoingRequests: outgoing,
    };
  }

  // Helper for visibility check
  async getFriendshipStatus(
    userId: string,
    otherUserId: string,
  ): Promise<FriendStatus | "NONE" | "SELF"> {
    if (userId === otherUserId) return "SELF";

    const friendship = await this.prisma.friend.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: userId },
        ],
      },
    });

    return friendship ? friendship.status : "NONE";
  }

  // Remove friend
  async removeFriend(userId: string, friendId: string) {
    // Find the friendship record
    const friendship = await this.prisma.friend.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId: friendId },
          { senderId: friendId, receiverId: userId },
        ],
        status: FriendStatus.ACCEPTED,
      },
    });

    if (!friendship) {
      throw new NotFoundException("Friendship not found");
    }

    // Delete the friendship
    await this.prisma.friend.delete({
      where: { id: friendship.id },
    });

    return { message: "Friend removed successfully" };
  }
}
