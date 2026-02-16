const fetch = require('node-fetch'); // Or native fetch in Node 18+

async function test() {
    const baseUrl = 'https://hianime-api-henna.vercel.app/api/v1';
    const episodeId = 'naruto-677::ep=12352'; // Naruto Ep 1

    console.log(`Fetching stream for ${episodeId}...`);
    try {
        const url = `${baseUrl}/stream?id=${encodeURIComponent(episodeId)}`;
        const res = await fetch(url);
        const data = await res.json();

        console.log('Success:', data.success);
        if (data.data) {
            console.log('Link:', data.data.link);
            // Check if there are headers in the response
            console.log('Data keys:', Object.keys(data.data));
        } else {
            console.log('No data');
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

test();
