import { AnilistService } from './src/common/services/anilist.service';

async function main() {
  const anilistService = new AnilistService();
  try {
    const data = await anilistService.searchAnime(undefined, 1, 24, undefined, "SCORE_DESC");
    console.log(data);
  } catch (e) {
    console.error(e);
  }
}
main();
