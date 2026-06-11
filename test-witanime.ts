import { WitanimeExtractorService } from './src/streaming/witanime-extractor.service';
async function main() {
  const service = new WitanimeExtractorService();
  const res = await service.extractEpisodeStreams('Dr. STONE: SCIENCE FUTURE Part 3', 1);
  console.log('STREAMS:', JSON.stringify(res, null, 2));
}
main().catch(console.error);
