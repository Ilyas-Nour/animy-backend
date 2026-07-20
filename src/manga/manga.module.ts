import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { MangaService } from "./manga.service";
import { MangaController } from "./manga.controller";
import { StreamingModule } from "../streaming/streaming.module";

@Module({
  imports: [HttpModule, StreamingModule],
  controllers: [MangaController],
  providers: [MangaService],
  exports: [MangaService],
})
export class MangaModule {}
