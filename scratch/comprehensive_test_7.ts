import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { StreamingService } from "../src/streaming/streaming.service";

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(StreamingService);
  
  console.log("Fetching episode links for Naruto EP 1...");
  // signature: getEpisodeLinks(episodeId, provider, proxyBaseUrl, malIdParam, episodeNumber, tmdbIdParam, title)
  const links = await service.getEpisodeLinks(
    "1", 
    "animepahe", 
    "http://localhost:3000/api/streaming/proxy", 
    "20", // Naruto MAL/AniList ID is 20
    "1", 
    "", 
    "Naruto"
  );
  
  console.log(JSON.stringify(links, null, 2));
  
  await app.close();
}

run().catch(console.error);
