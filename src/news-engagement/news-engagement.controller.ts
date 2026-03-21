import { Controller, Get, Post, Param, Query } from "@nestjs/common";
import { NewsEngagementService } from "./news-engagement.service";

@Controller("news-engagement")
export class NewsEngagementController {
  constructor(private readonly newsEngagementService: NewsEngagementService) {}

  @Get(":providerId")
  getEngagement(
    @Param("providerId") providerId: string,
    @Query("userId") userId?: string,
  ) {
    return this.newsEngagementService.getEngagement(providerId, userId);
  }

  @Post(":providerId/view")
  incrementViews(@Param("providerId") providerId: string) {
    return this.newsEngagementService.incrementViews(providerId);
  }
}
