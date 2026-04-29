import { Module, Global } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { AnilistService } from "./services/anilist.service";
import { JikanService } from "./services/jikan.service";

@Global()
@Module({
  imports: [HttpModule],
  providers: [AnilistService, JikanService],
  exports: [AnilistService, JikanService, HttpModule],
})
export class CommonModule {}
