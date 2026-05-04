import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { StreamingService } from "../src/streaming/streaming.service";

async function verifyMesh() {
  console.log("🧪 Testing Nuclear Mesh v11.0...");
  const app = await NestFactory.createApplicationContext(AppModule);
  const streamingService = app.get(StreamingService);

  // Test Case: One Piece (AniList: 21)
  const anilistId = "21";
  const title = "One Piece";
  const episodeNumber = "1000";

  try {
    console.log(`\n🔍 Fetching episode links for: ${title} (EP ${episodeNumber})`);
    const result = await streamingService.getEpisodeLinks(
      anilistId,
      "hianime",
      "/api/v1/streaming/proxy",
      anilistId,
      episodeNumber,
      undefined,
      title
    );

    console.log("\n✅ Result Status:", result.provider);
    console.log("🔗 Total Servers Found:", result.servers.length);
    
    console.log("\n📡 Server List:");
    result.servers.forEach((s: any, i: number) => {
      console.log(`  [${i + 1}] ${s.name} (${s.provider})`);
      console.log(`      URL: ${s.url.substring(0, 80)}...`);
    });

    const hasVidLink = result.servers.some((s: any) => s.name.includes("VidLink"));
    const hasNative = result.servers.some((s: any) => s.isNative);

    console.log("\n📊 Verification Metrics:");
    console.log(`  - VidLink Tier 1 Present: ${hasVidLink ? "✅" : "❌"}`);
    console.log(`  - Native Extraction Present: ${hasNative ? "✅" : "❌"}`);

    if (hasVidLink) {
        console.log("\n🚀 SUCCESS: Mesh v11 is operational.");
    } else {
        console.log("\n⚠️ WARNING: VidLink missing. Checking MAL ID resolution...");
    }

  } catch (error) {
    console.error("\n❌ Mesh Test Failed:", error.message);
  } finally {
    await app.close();
  }
}

verifyMesh();
