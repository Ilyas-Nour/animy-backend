import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { ConsumetService } from "../src/streaming/consumet.service";

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(ConsumetService);
  
  console.log("Searching AnimePahe for naruto...");
  const searchRes = await service.search("naruto");
  console.log(searchRes.slice(0, 2));

  if (searchRes.length > 0) {
    const id = searchRes[0].id;
    console.log("Fetching Info for", id);
    const info: any = await service.getAnimeInfo(id);
    console.log(info?.episodes?.slice(0, 2));

    if (info?.episodes?.length > 0) {
      const epId = info.episodes[0].id;
      console.log("Fetching sources for", epId);
      const sources = await service.getEpisodeSources(epId, searchRes[0].provider);
      console.log(JSON.stringify(sources, null, 2));
    }
  }

  await app.close();
}

run().catch(console.error);
