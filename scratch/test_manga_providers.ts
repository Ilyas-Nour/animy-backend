
import axios from 'axios';

async function testChapters(mangaId: number, title: string) {
  console.log(`\n--- Testing chapters for ${title} (${mangaId}) ---`);
  
  // Try MangaDex with more details
  try {
    const searchRes = await axios.get(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(title)}&limit=1`,
      { timeout: 5000 }
    );
    if (searchRes.data.data?.[0]) {
      const mdId = searchRes.data.data[0].id;
      console.log(`MangaDex ID: ${mdId}`);
      
      const feedUrl = `https://api.mangadex.org/manga/${mdId}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=10`;
      console.log(`Fetching MangaDex Feed: ${feedUrl}`);
      const chaptersRes = await axios.get(feedUrl, { timeout: 8000 });
      console.log(`MangaDex (EN) chapters: ${chaptersRes.data.data?.length || 0}`);
      
      if (chaptersRes.data.data?.length === 0) {
          const rawFeedUrl = `https://api.mangadex.org/manga/${mdId}/feed?limit=10`;
          console.log(`Fetching Raw MangaDex Feed (No filters): ${rawFeedUrl}`);
          const rawRes = await axios.get(rawFeedUrl);
          console.log(`MangaDex (RAW) chapters: ${rawRes.data.data?.length || 0}`);
          if (rawRes.data.data?.length > 0) {
              console.log(`Sample Raw Chapter Language:`, rawRes.data.data[0].attributes.translatedLanguage);
          }
      }
    }
  } catch (e) {
    console.error(`MangaDex failed: ${e.message}`);
  }

  // Try Consumet with different providers
  const providers = ["mangadex", "mangasee123", "mangapill"];
  for (const provider of providers) {
    try {
      const url = `https://consumet-api-clone.vercel.app/meta/anilist-manga/${mangaId}?provider=${provider}`;
      console.log(`Testing Consumet with ${provider}: ${url}`);
      const { data } = await axios.get(url, { timeout: 10000 });
      console.log(`Consumet (${provider}) chapters: ${data.chapters?.length || 0}`);
    } catch (e) {
      console.error(`Consumet (${provider}) failed: ${e.message}`);
    }
  }
}

async function run() {
    await testChapters(113138, "Jujutsu Kaisen");
    await testChapters(30013, "One Piece");
}

run();
