import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { ConsumetService } from "../src/streaming/consumet.service";

async function debugSearch() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const consumet = app.get(ConsumetService);

  console.log("🔍 Debugging Consumet Search for 'One Piece'...");
  const results = await consumet.search("One Piece");
  
  console.log(`\nFound ${results.length} results:`);
  results.forEach((r: any) => {
    console.log(`- [${r.provider}] ID: ${r.id}, Title: ${r.title}`);
  });

  await app.close();
}

debugSearch();
