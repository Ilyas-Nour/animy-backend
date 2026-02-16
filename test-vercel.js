
const axios = require('axios');

async function testVercel() {
    try {
        console.log("Fetching info...");
        const res = await axios.get('https://api-consumet-org-iota-flax.vercel.app/meta/anilist/info/20');
        console.log("Episodes found:", res.data.episodes.length);
        if (res.data.episodes.length > 0) {
            console.log("First Episode ID:", res.data.episodes[0].id);
            console.log("First Episode Number:", res.data.episodes[0].number);
        }
    } catch (error) {
        console.error("Error:", error.message);
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", error.response.data);
        }
    }
}

testVercel();
