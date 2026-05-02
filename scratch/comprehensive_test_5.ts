import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { HiAnimeService } from "../src/streaming/hianime.service";

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(HiAnimeService);
  
  const sources = await service.fetchEpisodeSources("naruto-episode-1-english-subbed");
  console.log(JSON.stringify(sources, null, 2));
  
  await app.close();
}

run().catch(console.error);
