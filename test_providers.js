const axios = require('axios');

async function test(title) {
  console.log(`\n--- Testing ${title} ---`);
  const providers = ['mangapill', 'mangadex', 'mangakakalot', 'mangareader'];
  
  for (const provider of providers) {
    try {
      const searchRes = await axios.get(`https://consumet-api-clone.vercel.app/manga/${provider}/${title.replace(/ /g, '%20')}`);
      if (searchRes.data?.results?.length > 0) {
        let bestMatch = searchRes.data.results[0];
        // try to find exact title match
        for (const res of searchRes.data.results) {
            if (res.title.toLowerCase() === title.toLowerCase()) {
                bestMatch = res; break;
            }
        }
        const providerId = bestMatch.id;
        console.log(`[${provider}] Found ID: ${providerId} (Title: ${bestMatch.title})`);
        
        // request info
        const infoUrl = `https://consumet-api-clone.vercel.app/manga/${provider}/info?id=${providerId}`;
        const infoRes = await axios.get(infoUrl);
        if (infoRes.data?.chapters?.length > 0) {
            console.log(`[${provider}] Info OK, chapters: ${infoRes.data.chapters.length}`);
            
            // test read first chapter
            const chapterId = infoRes.data.chapters[0].id;
            const readUrl = `https://consumet-api-clone.vercel.app/manga/${provider}/read?chapterId=${chapterId}`;
            const readRes = await axios.get(readUrl);
            console.log(`[${provider}] Read OK, pages: ${readRes.data?.length}`);
            
        } else {
            console.log(`[${provider}] No chapters in info`);
        }
      } else {
        console.log(`[${provider}] No search results`);
      }
    } catch (e) {
      console.log(`[${provider}] Error: ${e.response?.status} - ${e.response?.statusText || e.message}`);
    }
  }
}

async function run() {
  await test('Jujutsu Kaisen');
  await test('One Piece');
  await test('Solo Leveling');
}
run();
