import axios from "axios";

const urlsToTest = [
  "https://animekai.to/search?keyword=Naruto",
  "https://anikai.to/search?keyword=Naruto",
  "https://gogoanime.by/search.html?keyword=Naruto",
  "https://kaa.lt/search?q=Naruto"
];

async function testAll() {
  console.log("=== STARTING DEEP NETWORK DIAGNOSTICS P4 ===");
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
  console.log("=== DIAGNOSTICS P4 COMPLETE ===");
}

testAll();
