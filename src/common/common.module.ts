import { Module, Global } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { JikanService } from "./services/jikan.service";

@Global()
@Module({
  imports: [HttpModule],
  providers: [JikanService],
  exports: [JikanService, HttpModule],
})
export class CommonModule {}
