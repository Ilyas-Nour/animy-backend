const axios = require('axios');

async function test() {
  try {
    const res = await axios.get('https://aniwatch-api-v1-0.onrender.com/api/v2/hianime/anime/jujutsu-kaisen-2nd-season-18413/episodes');
    console.log('eps:', res.data?.data?.episodes?.length);
    if (res.data?.data?.episodes?.length > 0) {
        const epId = res.data.data.episodes[0].episodeId;
        console.log('epId:', epId);
        const links = await axios.get(`https://aniwatch-api-v1-0.onrender.com/api/v2/hianime/episode/sources?animeEpisodeId=${epId}`);
        console.log('links:', links.data?.data?.sources?.length);
    }
  } catch(e) {
    console.error(e.message);
  }
}
test()
