
import axios from 'axios';

async function testHiAnime() {
  const hosts = [
    "https://aniwatch-api-net.vercel.app/api/v2/hianime",
    "https://hianime-api.vercel.app/anime",
  ];

  for (const host of hosts) {
    try {
      console.log(`Testing search on ${host}...`);
      const searchUrl = `${host}/search?q=naruto`;
      const searchRes = await axios.get(searchUrl, { timeout: 5000 });
      console.log(`Search response from ${host}: SUCCESS`);
      // console.log(JSON.stringify(searchRes.data, null, 2).slice(0, 500));

      const results = searchRes.data.data?.animes || searchRes.data.data?.results || [];
      if (results.length > 0) {
        const firstId = results[0].id;
        console.log(`Testing info for ${firstId} on ${host}...`);
        const infoUrl = `${host}/anime/${firstId}`;
        const infoRes = await axios.get(infoUrl, { timeout: 5000 });
        console.log(`Info response from ${host}: SUCCESS`);

        let episodesUrl = `${host}/anime/${firstId}/episodes`;
        if (host.includes("hianime-api.")) episodesUrl = `${host}/episodes/${firstId}`;
        
        console.log(`Testing episodes for ${firstId} on ${host}...`);
        const epRes = await axios.get(episodesUrl, { timeout: 5000 });
        console.log(`Episodes response from ${host}: SUCCESS`);

        const eps = epRes.data.data?.episodes || epRes.data.data || [];
        if (eps.length > 0) {
          const epId = eps[0].episodeId || eps[0].id;
          console.log(`Testing sources for ${epId} on ${host}...`);
          
          let sourcesUrl = `${host}/episode/sources?animeEpisodeId=${encodeURIComponent(epId)}`;
          if (host.includes("hianime-api.")) sourcesUrl = `${host}/stream?id=${encodeURIComponent(epId)}`;
          
          const srcRes = await axios.get(sourcesUrl, { timeout: 5000 });
          console.log(`Sources response from ${host}: SUCCESS`);
          console.log(JSON.stringify(srcRes.data, null, 2).slice(0, 500));
        }
      }
    } catch (error) {
      console.log(`FAILED on ${host}: ${error.message}`);
      if (error.response) {
        console.log(`Status: ${error.response.status}`);
      }
    }
    console.log('---');
  }
}

testHiAnime();
