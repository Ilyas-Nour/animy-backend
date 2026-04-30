import axios from "axios";

async function test() {
  const anifyRes = await axios.get("https://api.anify.tv/info/113415", { timeout: 5000 }).catch(e => e.response);
  console.log("Episodes:", JSON.stringify(anifyRes?.data?.episodes?.data?.[0], null, 2));
}
test();
