import { WitanimeExtractorService } from './src/streaming/witanime-extractor.service';
import { PrismaService } from './src/database/prisma.service';

async function main() {
  const prisma = new PrismaService();
  const service = new WitanimeExtractorService(prisma);

  // Test with AniList ID (new path)
  console.log('--- Testing AniList ID-based extraction (199221 = Dr. Stone) ---');
  const res = await service.extractEpisodeStreamsByAnilistId(199221, 1, 'Dr. STONE: SCIENCE FUTURE Part 3');
  console.log('STREAMS:', JSON.stringify(res, null, 2));

  // Also test legacy title-based path
  console.log('\n--- Testing legacy title-based extraction ---');
  const res2 = await service.extractEpisodeStreams('Dr. STONE: SCIENCE FUTURE Part 3', 1);
  console.log('STREAMS (legacy):', JSON.stringify(res2, null, 2));

  await prisma.$disconnect();
}
main().catch(console.error);
