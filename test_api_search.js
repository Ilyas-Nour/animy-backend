const axios = require('axios');

async function test(url) {
  try {
    const res = await axios.get(url, { timeout: 3000 });
    console.log(`[SUCCESS] ${url.substring(0, 40)} ->`, Object.keys(res.data).join(','));
  } catch(e) {
    // console.log(`[FAIL] ${url.substring(0, 40)}`);
  }
}

async function run() {
  const urls = [
      'https://aniwatch-api-net.vercel.app/api/v2/hianime/search?q=jujutsu',
      'https://aniwatch-api-v1-0.onrender.com/api/v2/hianime/search?q=jujutsu',
      'https://hianime-api.vercel.app/anime/search?q=jujutsu',
      'https://hianime-api-top.vercel.app/anime/search?q=jujutsu',
      'https://aniwatch-api.vercel.app/api/v2/hianime/search?q=jujutsu',
      'https://hianime-api-drab.vercel.app/api/v2/hianime/search?q=jujutsu'
  ];
  await Promise.all(urls.map(url => test(url)));
}
run();
