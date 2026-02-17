import { Module } from '@nestjs/common';
import { StreamingService } from './streaming.service';
import { StreamingController } from './streaming.controller';
import { HiAnimeService } from './hianime.service';
import { StreamingProxyService } from './streaming.proxy.service';

@Module({
    controllers: [StreamingController],
    providers: [StreamingService, HiAnimeService, StreamingProxyService],
    exports: [StreamingService],
})
export class StreamingModule { }
