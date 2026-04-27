import { Module } from "@nestjs/common";
import { StreamingService } from "./streaming.service";
import { StreamingController } from "./streaming.controller";
import { HiAnimeService } from "./hianime.service";
import { StreamingProxyService } from "./streaming.proxy.service";
import { IdMappingService } from "./id-mapping.service";
import { DatabaseModule } from "../database/database.module";

import { ConsumetService } from "./consumet.service";

@Module({
  imports: [DatabaseModule],
  controllers: [StreamingController],
  providers: [StreamingService, HiAnimeService, ConsumetService, StreamingProxyService, IdMappingService],
  exports: [StreamingService, IdMappingService, StreamingProxyService],
})
export class StreamingModule {}
