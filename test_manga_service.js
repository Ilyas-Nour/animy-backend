const axios = require('axios');

async function test(id, title) {
  console.log(`Testing ${id} - ${title}`);
  
  // 1. Try meta/anilist-manga
  try {
    const { data } = await axios.get(`https://consumet-api-clone.vercel.app/meta/anilist-manga/${id}?provider=mangadex`);
    if (data.chapters && data.chapters.length > 0) {
      console.log(`[anilist-manga] Found ${data.chapters.length} chapters`);
    } else {
        console.log(`[anilist-manga] No chapters`);
    }
  } catch (e) {
    console.log(`[anilist-manga] Error: ${e.message}`);
  }

  // 2. Try direct provider search
  const providers = ['mangapill', 'mangadex'];
  for (const provider of providers) {
    try {
      console.log(`Searching ${provider} for: ${title}`);
      const searchRes = await axios.get(`https://consumet-api-clone.vercel.app/manga/${provider}/${encodeURIComponent(title)}`);
      if (searchRes.data?.results?.length > 0) {
        const providerId = searchRes.data.results[0].id;
        console.log(`[${provider}] Found ID: ${providerId}`);
        const infoUrl = `https://consumet-api-clone.vercel.app/manga/${provider}/info?id=${encodeURIComponent(providerId)}`;
        const infoRes = await axios.get(infoUrl);
        if (infoRes.data?.chapters?.length > 0) {
            console.log(`[${provider}] Found ${infoRes.data.chapters.length} chapters`);
        } else {
            console.log(`[${provider}] No chapters in info`);
        }
      } else {
          console.log(`[${provider}] No search results`);
      }
    } catch (e) {
      console.log(`[${provider}] Error: ${e.message}`);
    }
  }
}

test(101517, 'Jujutsu Kaisen');
test(21, 'One Piece');
test(113138, 'Chainsaw Man');
