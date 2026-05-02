import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { ConsumetService } from "../src/streaming/consumet.service";

async function inspectConsumet() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const consumet = app.get(ConsumetService);

  console.log("Searching Consumet for 'Naruto'...");
  const results = await consumet.search("Naruto");
  console.log("Total Results:", results.length);
  
  const providers = [...new Set(results.map((r: any) => r.provider))];
  console.log("Providers found:", providers);
  
  if (results.length > 0) {
      console.log("First result:", JSON.stringify(results[0], null, 2));
  }

  await app.close();
}

inspectConsumet().catch(console.error);
