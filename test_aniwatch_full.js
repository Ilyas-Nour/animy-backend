const axios = require('axios');

async function test() {
  const base = 'https://aniwatch-api-net.vercel.app/api/v2/hianime';
  try {
    const res = await axios.get(`${base}/search?q=jujutsu`);
    const id = res.data.data.animes[0].id;
    console.log('id:', id);
    
    const info = await axios.get(`${base}/anime/${id}`);
    console.log('info:', !!info.data.data.anime);
    
    const eps = await axios.get(`${base}/anime/${id}/episodes`);
    const epId = eps.data.data.episodes[0].episodeId;
    console.log('epId:', epId);
    
    const servers = await axios.get(`${base}/episode/servers?animeEpisodeId=${epId}`);
    const subServer = servers.data.data.sub[0].serverName;
    console.log('server:', subServer);
    
    const stream = await axios.get(`${base}/episode/sources?animeEpisodeId=${epId}&server=${subServer}&category=sub`);
    console.log('stream sources:', stream.data?.data?.sources?.length);
  } catch(e) {
    if (e.response) console.log(e.response.data);
    else console.log(e.message);
  }
}
test()
