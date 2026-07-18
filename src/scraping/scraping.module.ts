import { Module } from '@nestjs/common';
import { ScrapingProcessor } from './scraping.processor';
import { MangaModule } from '../manga/manga.module';

@Module({
  imports: [MangaModule],
  providers: [ScrapingProcessor],
})
export class ScrapingModule {}
