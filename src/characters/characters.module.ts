import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { CacheModule } from "@nestjs/cache-manager";
import { CharactersService } from "./characters.service";
import { CharactersController } from "./characters.controller";
import { DatabaseModule } from "../database/database.module";

@Module({
  imports: [
    HttpModule,
    DatabaseModule,
    CacheModule.register({
      ttl: 60 * 60 * 1000, // 1 hour default
      max: 100, // max 100 items in cache
    }),
  ],
  controllers: [CharactersController],
  providers: [CharactersService],
  exports: [CharactersService],
})
export class CharactersModule {}
