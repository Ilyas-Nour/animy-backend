import { Module } from "@nestjs/common";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import configuration from "./config/configuration";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { AnimeModule } from "./anime/anime.module";
import { SeasonsModule } from "./seasons/seasons.module";
import { ContactModule } from "./contact/contact.module";
import { FriendsModule } from "./friends/friends.module";
import { MangaModule } from "./manga/manga.module";
import { CharactersModule } from "./characters/characters.module";
import { ChatModule } from "./chat/chat.module";
import { CommonModule } from "./common/common.module";
import { CacheModule } from "@nestjs/cache-manager";
import { AdminModule } from "./admin/admin.module";
import { NewsEngagementModule } from './news-engagement/news-engagement.module';
import { CommentsModule } from './comments/comments.module';
import { ReactionsModule } from './reactions/reactions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StreamingModule } from './streaming/streaming.module';
import { ConsumetModule } from './consumet/consumet.module';
import * as redisStore from "cache-manager-redis-store";

@Module({
  imports: [
    // Configuration module
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ".env",
    }),

    // Caching Module (Redis)
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const redisHost = configService.get("REDIS_HOST");
        if (redisHost) {
          return {
            store: redisStore,
            host: redisHost,
            port: configService.get("REDIS_PORT") || 6379,
            ttl: 3600,
          };
        }
        return {
          ttl: 3600, // Default memory cache
        };
      },
      inject: [ConfigService],
    }),

    // Database module
    DatabaseModule,

    // Shared Module
    CommonModule,

    // Feature modules
    AuthModule,
    UsersModule,
    AnimeModule,
    SeasonsModule,
    ContactModule,
    FriendsModule,
    MangaModule,
    CharactersModule,
    ChatModule,
    AdminModule,
    NewsEngagementModule, // Correct Module
    CommentsModule,
    ReactionsModule,
    NotificationsModule,
    StreamingModule,
    ConsumetModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }
