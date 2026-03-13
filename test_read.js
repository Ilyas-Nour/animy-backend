const axios = require('axios');

async function testRead() {
  const chapterId = 'mangapill___MjA4NS0xMDI3MTUwMC9qdWp1dHN1LWthaXNlbi1jaGFwdGVyLTI3MS41';
  let url = "";
  const parts = chapterId.split('___');
  const provider = parts[0];
  const actualId = Buffer.from(parts[1], 'base64url').toString('utf-8');
  
  console.log(`Provider: ${provider}, Actual ID: ${actualId}`);
  
  if (provider === 'anilist') {
    url = `https://consumet-api-clone.vercel.app/meta/anilist-manga/read?chapterId=${actualId}&provider=mangadex`;
  } else {
    url = `https://consumet-api-clone.vercel.app/manga/${provider}/read?chapterId=${actualId}`;
  }
  
  console.log(`URL: ${url}`);
  try {
    const { data } = await axios.get(url);
    console.log(`Found ${data.length || data.pages?.length} pages`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}
testRead();
