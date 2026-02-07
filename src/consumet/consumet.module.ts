import { Module } from '@nestjs/common';
import { ConsumetController } from './consumet.controller';

@Module({
    controllers: [ConsumetController],
})
export class ConsumetModule { }
