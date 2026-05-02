import axios from "axios";

const urlsToTest = [
  // Consumet Overrides
  "https://animepahe.pw",
  "https://kaa.lt",
  "https://anikai.to",
  "https://animekai.to", // From screenshot 1
  
  // HiAnime Mirrors
  "https://aniwatchtv.to/home",
  "https://gogoanime3.co",

  // Anify
  "https://api.anify.tv/info/113415",
  "https://anify.to/watch/113415/1", // From screenshot 3
  
  // VidSrc / VidLink (TMDB/AniList Mirrors)
  "https://vidsrc.to/embed/tv/37854/1/1",
  "https://vidlink.pro/tv/37854/1/1",
  "https://vidsrc.me/embed/anime?anilist=113415&episode=1", // From screenshot 2
  
  // MAL sync API
  "https://api.malsync.moe/mal/anime/anilist:113415"
];

async function testAll() {
  console.log("=== STARTING DEEP NETWORK DIAGNOSTICS ===");
  for (const url of urlsToTest) {
    try {
      const res = await axios.get(url, {
        timeout: 8000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
      });
      console.log(`[OK] ${url} -> Status: ${res.status}`);
    } catch (e: any) {
      if (e.response) {
        console.log(`[FAIL] ${url} -> Status: ${e.response.status}`);
      } else {
        console.log(`[ERROR] ${url} -> ${e.message}`);
      }
    }
  }
  console.log("=== DIAGNOSTICS COMPLETE ===");
}

testAll();
