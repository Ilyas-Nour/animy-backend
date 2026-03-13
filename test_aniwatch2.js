const axios = require('axios');

async function test() {
  try {
    const res = await axios.get('https://aniwatch-api-v1-0.onrender.com/api/v2/hianime/search?q=frieren');
    const firstAnime = res.data.data.animes[0];
    console.log('firstAnime:', JSON.stringify(firstAnime, null, 2));
    
    const id = firstAnime.id;
    console.log('Using ID:', id);

    const info = await axios.get(`https://aniwatch-api-v1-0.onrender.com/api/v2/hianime/anime/${id}`);
    console.log('Info res keys:', Object.keys(info.data.data.anime.info));
    
    const eps = await axios.get(`https://aniwatch-api-v1-0.onrender.com/api/v2/hianime/anime/${id}/episodes`);
    console.log('Eps res:', JSON.stringify(eps.data.data.episodes[0], null, 2));

    const epId = eps.data.data.episodes[0].episodeId;
    const servers = await axios.get(`https://aniwatch-api-v1-0.onrender.com/api/v2/hianime/episode/servers?animeEpisodeId=${epId}`);
    console.log('Servers res:', JSON.stringify(servers.data.data, null, 2));

    const subtitleServer = servers.data.data.sub[0].serverName;
    const stream = await axios.get(`https://aniwatch-api-v1-0.onrender.com/api/v2/hianime/episode/sources?animeEpisodeId=${epId}&server=${subtitleServer}&category=sub`);
    console.log('Stream res keys:', Object.keys(stream.data.data));
    console.log('Sources:', stream.data.data.sources.length);
    console.log('Tracks:', stream.data.data.tracks?.length);

  } catch(e) {
    if (e.response) {
      console.log('Error data:', e.response.data);
    } else {
      console.error(e.message);
    }
  }
}
test()
