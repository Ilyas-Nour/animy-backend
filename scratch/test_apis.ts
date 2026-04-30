import axios from "axios";

async function test() {
  console.log("Testing VidSrc...");
  try {
    const res = await axios.get("https://vidsrc.me/embed/anime?anilist=113415&episode=1", { timeout: 5000 });
    console.log("vidsrc.me/embed/anime status:", res.status);
  } catch (e: any) {
    console.log("vidsrc.me/embed/anime error:", e.message);
  }
}
test();
