import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AnimeService } from '../src/anime/anime.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const animeService = app.get(AnimeService);

  console.log("=== TESTING GET TOP ANIME ===");
  try {
    const result = await animeService.getTopAnime(undefined, "airing") as any;
    console.log(`Success! Found ${result.data?.length} items.`);
    if (result.data?.length > 0) {
      console.log(`First item: ${result.data[0].title} (ID: ${result.data[0].id})`);
    } else {
      console.log("WARNING: Empty data returned!");
    }
  } catch (e) {
    console.error("FAILED to get top anime:", e.message);
  }

  await app.close();
}

bootstrap();
