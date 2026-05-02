import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import axios from "axios";

async function testEndpoints() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  await app.listen(3003);
  
  const baseUrl = "http://localhost:3003/api/v1";

  const endpoints = [
    "/anime/trending",
    "/anime/popular",
    "/anime/upcoming",
    "/anime/search?query=naruto",
    "/streaming/search?query=naruto",
    "/streaming/anime/naruto-f3cf"
  ];

  console.log("\n--- TESTING BACKEND ENDPOINTS ---\n");

  for (const endpoint of endpoints) {
    try {
      console.log(`Testing ${endpoint}...`);
      const res = await axios.get(`${baseUrl}${endpoint}`);
      console.log(`✅ ${endpoint} SUCCESS: Status ${res.status}`);
    } catch (e: any) {
      console.error(`❌ ${endpoint} FAILED: Status ${e.response?.status} - ${e.message}`);
      if (e.response?.data) {
          console.error(`   Error Data:`, JSON.stringify(e.response.data).substring(0, 200));
      }
    }
  }

  console.log("\n--- ENDPOINT TESTS COMPLETED ---\n");
  await app.close();
}

testEndpoints().catch(console.error);
