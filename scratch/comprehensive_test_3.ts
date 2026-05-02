import axios from "axios";

const urlsToTest = [
  "https://vidsrc.me/embed/tv/37854/1/1",
  "https://vidsrc.in/embed/tv/37854/1/1",
  "https://vidsrc.pm/embed/tv/37854/1/1",
  "https://vidsrc.net/embed/tv/37854/1/1"
];

async function testAll() {
  console.log("=== STARTING DEEP NETWORK DIAGNOSTICS P3 ===");
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
  console.log("=== DIAGNOSTICS P3 COMPLETE ===");
}

testAll();
