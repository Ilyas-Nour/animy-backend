import { Module } from "@nestjs/common";
import { NewsEngagementController } from "./news-engagement.controller";
import { NewsEngagementService } from "./news-engagement.service";
import { PrismaService } from "../database/prisma.service";

@Module({
  controllers: [NewsEngagementController],
  providers: [NewsEngagementService, PrismaService],
  exports: [NewsEngagementService],
})
export class NewsEngagementModule {}
