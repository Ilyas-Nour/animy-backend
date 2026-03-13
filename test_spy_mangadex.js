const axios = require('axios');

async function test() {
  const providerId = '6b958848-c885-4735-9201-12ee77abcb3c';
  const provider = 'mangadex';
  const infoUrl = `https://consumet-api-clone.vercel.app/manga/${provider}/info?id=${providerId}`;
  try {
      const infoRes = await axios.get(infoUrl);
      console.log(`[${provider}] Chapters length:`, infoRes.data?.chapters?.length);
      if (infoRes.data?.chapters?.length > 0) {
           console.log('First chapterid', infoRes.data.chapters[0].id)
      }
  } catch(e) {
      console.error(e.message);
  }
  
  const providerId2 = '6175/spy-x-family'
  const provider2 = 'mangapill';
  const infoUrl2 = `https://consumet-api-clone.vercel.app/manga/${provider2}/info?id=${providerId2}`;
  try {
      const infoRes = await axios.get(infoUrl2);
      console.log(`[${provider2}] Chapters length:`, infoRes.data?.chapters?.length);
      if (infoRes.data?.chapters?.length > 0) {
           console.log('First chapterid', infoRes.data.chapters[0].id)
      }
  } catch(e) {
      console.error(e.message);
  }
}
test();
