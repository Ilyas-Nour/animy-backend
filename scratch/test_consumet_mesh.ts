import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { ConsumetService } from "../src/streaming/consumet.service";

async function testConsumet() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const consumet = app.get(ConsumetService);

  console.log("Testing Consumet Mesh...");
  const results = await consumet.search("Naruto");
  console.log(`Found ${results.length} results.`);
  console.table(results.slice(0, 5).map(r => ({ title: r.title, provider: r.provider })));

  await app.close();
}

testConsumet();
