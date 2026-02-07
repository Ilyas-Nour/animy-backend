import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { MangaService } from "./manga.service";
import { MangaController } from "./manga.controller";

@Module({
  imports: [HttpModule],
  controllers: [MangaController],
  providers: [MangaService],
  exports: [MangaService],
})
export class MangaModule {}
