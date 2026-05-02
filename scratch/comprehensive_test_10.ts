import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { AnilistService } from "../src/common/services/anilist.service";
import { JikanService } from "../src/common/services/jikan.service";
import { ConsumetService } from "../src/streaming/consumet.service";
import { PrismaService } from "../src/database/prisma.service";
import { HiAnimeService } from "../src/streaming/hianime.service";
import axios from "axios";

async function runDeepTests() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const anilist = app.get(AnilistService);
  const jikan = app.get(JikanService);
  const consumet = app.get(ConsumetService);
  const prisma = app.get(PrismaService);
  const hianime = app.get(HiAnimeService);

  const results: any = {
    anilist: { status: 'unknown' },
    jikan: { status: 'unknown' },
    consumet: { status: 'unknown', providers: [] },
    hianime: { status: 'unknown' },
    database: { status: 'unknown' },
    network: { status: 'unknown' }
  };

  console.log("\n🚀 STARTING COMPREHENSIVE PLATFORM API AUDIT\n");

  // --- 1. NETWORK & DNS CHECK ---
  console.log("📡 [1/6] Testing External Network Connectivity...");
  try {
    const dnsTest = await axios.get("https://1.1.1.1", { timeout: 3000 });
    results.network.status = '✅ OK';
    console.log("   ✅ External network reachable.");
  } catch (e: any) {
    results.network.status = '❌ FAILED';
    console.error("   ❌ Network error:", e.message);
  }

  // --- 2. ANILIST AUDIT ---
  console.log("\n🌌 [2/6] Auditing AniList GraphQL API...");
  try {
    const start = Date.now();
    const trending = await anilist.getTrending(1, 5);
    const search = await anilist.searchAnime("One Piece", 1, 5);
    const duration = Date.now() - start;
    results.anilist.status = `✅ OK (${duration}ms)`;
    console.log(`   ✅ AniList Responsive. Found ${trending.length} trending, ${search.media.length} search results.`);
  } catch (e: any) {
    results.anilist.status = '❌ FAILED';
    console.error("   ❌ AniList Audit Failed:", e.message);
  }

  // --- 3. JIKAN AUDIT ---
  console.log("\n📚 [3/6] Auditing Jikan (MAL) API...");
  try {
    const start = Date.now();
    const top = await jikan.getTopAnime();
    const duration = Date.now() - start;
    results.jikan.status = `✅ OK (${duration}ms)`;
    console.log(`   ✅ Jikan Responsive. Found ${top.length} top anime.`);
  } catch (e: any) {
    results.jikan.status = '❌ FAILED';
    console.error("   ❌ Jikan Audit Failed:", e.message);
  }

  // --- 4. CONSUMET MESH AUDIT ---
  console.log("\n🕸️ [4/6] Auditing Consumet Mesh Providers...");
  try {
    const start = Date.now();
    const meshResults = await consumet.search("Bleach");
    const duration = Date.now() - start;
    const providers = [...new Set(meshResults.map((r: any) => r.provider))];
    results.consumet.status = `✅ OK (${duration}ms)`;
    results.consumet.providers = providers;
    console.log(`   ✅ Consumet Mesh Active. Providers found: ${providers.join(", ")}`);
    if (providers.length === 0) console.warn("   ⚠️ Warning: No providers returned results.");
  } catch (e: any) {
    results.consumet.status = '❌ FAILED';
    console.error("   ❌ Consumet Audit Failed:", e.message);
  }

  // --- 5. HIANIME SCRAPER AUDIT ---
  console.log("\n📺 [5/6] Auditing HiAnime Scraper Status...");
  try {
    const start = Date.now();
    const hiResults: any = await hianime.search("Solo Leveling");
    const duration = Date.now() - start;
    const count = hiResults.results?.length || (Array.isArray(hiResults) ? hiResults.length : 0);
    results.hianime.status = `✅ OK (${duration}ms)`;
    console.log(`   ✅ HiAnime Scraper Active. Found ${count} results.`);
  } catch (e: any) {
    results.hianime.status = '❌ FAILED';
    console.error("   ❌ HiAnime Audit Failed:", e.message);
  }

  // --- 6. DATABASE INTEGRITY CHECK ---
  console.log("\n🗄️ [6/6] Auditing Database Integrity (Prisma)...");
  try {
    const start = Date.now();
    const testId = 9999999;
    await prisma.animeMapping.upsert({
        where: { id: testId },
        update: { lastChecked: new Date() },
        create: { id: testId, lastChecked: new Date() }
    });
    const count = await prisma.animeMapping.count();
    const duration = Date.now() - start;
    results.database.status = `✅ OK (${duration}ms)`;
    console.log(`   ✅ Database Read/Write SUCCESS. Mapping count: ${count}`);
    
    await prisma.animeMapping.delete({ where: { id: testId } });
  } catch (e: any) {
    results.database.status = '❌ FAILED';
    console.error("   ❌ Database Audit Failed:", e.message);
  }

  console.log("\n--- FINAL AUDIT SUMMARY ---\n");
  console.table(results);
  console.log("\n--- AUDIT COMPLETED ---\n");

  await app.close();
}

runDeepTests().catch(async (e) => {
  console.error("FATAL AUDIT ERROR:", e);
  process.exit(1);
});
