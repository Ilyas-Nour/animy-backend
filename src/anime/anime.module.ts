import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { AnimeController } from "./anime.controller";
import { AnimeService } from "./anime.service";

@Module({
  imports: [HttpModule],
  controllers: [AnimeController],
  providers: [AnimeService],
})
export class AnimeModule {}
