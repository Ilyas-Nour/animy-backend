import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { AnilistService } from "../src/common/services/anilist.service";
import { JikanService } from "../src/common/services/jikan.service";
import { ConsumetService } from "../src/streaming/consumet.service";
import { PrismaService } from "../src/database/prisma.service";
import { HiAnimeService } from "../src/streaming/hianime.service";

async function runTests() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const anilist = app.get(AnilistService);
  const jikan = app.get(JikanService);
  const consumet = app.get(ConsumetService);
  const prisma = app.get(PrismaService);
  const hianime = app.get(HiAnimeService);

  console.log("\n--- STARTING DEEP API TESTS ---\n");

  // 1. AniList Test
  console.log("1. Testing AniList GraphQL API...");
  try {
    const alResult = await anilist.searchAnime("Naruto", 1, 1);
    console.log("✅ AniList SUCCESS: Found", alResult.media.length, "results.");
  } catch (e: any) {
    console.error("❌ AniList FAILED:", e.message);
  }

  // 2. Jikan Test
  console.log("\n2. Testing Jikan (MAL) API...");
  try {
    const jikanResult = await jikan.searchAnime("Naruto", 1, 1);
    console.log("✅ Jikan SUCCESS: Found", jikanResult.length, "results.");
  } catch (e: any) {
    console.error("❌ Jikan FAILED:", e.message);
  }

  // 3. Consumet (AnimePahe) Test
  console.log("\n3. Testing Consumet (AnimePahe) Mesh...");
  try {
    const consumetResult = await consumet.search("Naruto");
    const pahe = consumetResult.find((r: any) => r.provider === 'animepahe');
    if (pahe) {
        console.log("✅ Consumet (AnimePahe) SUCCESS: Found", pahe.id);
    } else {
        console.log("⚠️ Consumet SUCCESS but AnimePahe NOT FOUND in results.");
    }
  } catch (e: any) {
    console.error("❌ Consumet FAILED:", e.message);
  }

  // 4. HiAnime Test
  console.log("\n4. Testing HiAnime Scraper...");
  try {
    const hianimeResult = await hianime.search("Naruto");
    console.log("✅ HiAnime SUCCESS: Found results.");
  } catch (e: any) {
    console.error("❌ HiAnime FAILED:", e.message);
  }

  // 5. Database Test
  console.log("\n5. Testing Database (Prisma)...");
  try {
    const userCount = await prisma.user.count();
    console.log("✅ Database SUCCESS: Connected, user count =", userCount);
  } catch (e: any) {
    console.error("❌ Database FAILED:", e.message);
  }

  console.log("\n--- API TESTS COMPLETED ---\n");
  await app.close();
}

runTests().catch(async (e) => {
  console.error("Global Test Error:", e);
  process.exit(1);
});
