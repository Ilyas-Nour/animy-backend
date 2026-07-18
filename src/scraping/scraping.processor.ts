import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MangaService } from '../manga/manga.service';

@Processor('scrape-queue')
export class ScrapingProcessor extends WorkerHost {
  private readonly logger = new Logger(ScrapingProcessor.name);

  constructor(private readonly mangaService: MangaService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing job: ${job.name} (ID: ${job.id})`);

    try {
      switch (job.name) {
        case 'update-manga-chapters': {
          const { id, cachedManga } = job.data;
          await this.mangaService.fetchAndUpdateChaptersBackground(id, cachedManga);
          return { status: 'success' };
        }
        default:
          this.logger.warn(`Unknown job name: ${job.name}`);
          return { status: 'unknown' };
      }
    } catch (error) {
      this.logger.error(`Error processing job ${job.id}:`, error.message);
      throw error;
    }
  }
}
