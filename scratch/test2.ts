import axios from "axios";

async function test() {
  const res = await axios.get("http://localhost:3000/api/v1/streaming/find?title=Naruto&anilistId=20", { timeout: 10000 }).catch(e => e.response);
  console.log("find result:", JSON.stringify(res?.data, null, 2));
  
  if (res?.data?.data?.[0]) {
      const id = res.data.data[0].id;
      console.log("Found ID:", id);
      const info = await axios.get(`http://localhost:3000/api/v1/streaming/anime/${encodeURIComponent(id)}`).catch(e => e.response);
      console.log("info result:", JSON.stringify(info?.data, null, 2));
  }
}
test();
