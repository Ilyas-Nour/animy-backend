import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { SeasonsController } from "./seasons.controller";
import { SeasonsService } from "./seasons.service";

@Module({
  imports: [HttpModule],
  controllers: [SeasonsController],
  providers: [SeasonsService],
})
export class SeasonsModule {}
