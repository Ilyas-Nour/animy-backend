import { Module } from "@nestjs/common";
import { HomeService } from "./home.service";
import { HomeController } from "./home.controller";
import { AnimeModule } from "../anime/anime.module";
import { MangaModule } from "../manga/manga.module";

@Module({
  imports: [AnimeModule, MangaModule],
  controllers: [HomeController],
  providers: [HomeService],
  exports: [HomeService],
})
export class HomeModule {}
