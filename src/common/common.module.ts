import { Module, Global } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { AnilistService } from "./services/anilist.service";

@Global()
@Module({
  imports: [HttpModule],
  providers: [AnilistService],
  exports: [AnilistService, HttpModule],
})
export class CommonModule {}
