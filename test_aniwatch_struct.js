const axios = require('axios');

async function test() {
  try {
    const res = await axios.get('https://aniwatch-api-v1-0.onrender.com/api/v2/hianime/search?q=frieren');
    console.log('Search res:', JSON.stringify(res.data.data.animes[0], null, 2));
    
    const info = await axios.get('https://aniwatch-api-v1-0.onrender.com/api/v2/hianime/anime/frieren-beyond-journeys-end-18579');
    console.log('Info res keys:', Object.keys(info.data.data.anime.info));
    
    const eps = await axios.get('https://aniwatch-api-v1-0.onrender.com/api/v2/hianime/anime/frieren-beyond-journeys-end-18579/episodes');
    console.log('Eps res:', JSON.stringify(eps.data.data.episodes[0], null, 2));

    const epId = eps.data.data.episodes[0].episodeId;
    const servers = await axios.get(`https://aniwatch-api-v1-0.onrender.com/api/v2/hianime/episode/servers?animeEpisodeId=${epId}`);
    console.log('Servers res:', JSON.stringify(servers.data.data, null, 2));

    const stream = await axios.get(`https://aniwatch-api-v1-0.onrender.com/api/v2/hianime/episode/sources?animeEpisodeId=${epId}`);
    console.log('Stream res:', Object.keys(stream.data.data));

  } catch(e) {
    console.error(e.message);
  }
}
test()
