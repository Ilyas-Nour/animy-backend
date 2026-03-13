const axios = require('axios');

async function testProvider(provider, id) {
  try {
    const encoded = encodeURIComponent(id);
    console.log(`Testing ${provider} with encoded ID: info?id=${encoded}`);
    const res1 = await axios.get(`https://consumet-api-clone.vercel.app/manga/${provider}/info?id=${encoded}`);
    console.log(`[Encoded] OK, chapters: ${res1.data.chapters?.length}`);
  } catch (e) {
    console.log(`[Encoded] Failed: ${e.response?.status}`);
  }

  try {
    console.log(`Testing ${provider} with raw ID: info?id=${id}`);
    const res2 = await axios.get(`https://consumet-api-clone.vercel.app/manga/${provider}/info?id=${id}`);
    console.log(`[Raw] OK, chapters: ${res2.data.chapters?.length}`);
  } catch (e) {
    console.log(`[Raw] Failed: ${e.response?.status}`);
  }
}

testProvider('mangapill', '2085/jujutsu-kaisen');
