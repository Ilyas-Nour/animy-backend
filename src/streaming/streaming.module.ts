import { Module } from '@nestjs/common';
import { StreamingService } from './streaming.service';
import { StreamingController } from './streaming.controller';
import { HiAnimeService } from './hianime.service';

@Module({
    controllers: [StreamingController],
    providers: [StreamingService, HiAnimeService],
    exports: [StreamingService],
})
export class StreamingModule { }
