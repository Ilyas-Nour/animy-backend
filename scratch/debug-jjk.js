import axios from 'axios';

async function testFetchChapters(id, title) {
    console.log(`Starting test for ${id} (${title})`);
    
    // 1. Resolve MangaDex ID
    let mangaDexId = null;
    const baseUrl = 'https://api.mangadex.org';
    try {
        const response = await axios.get(`${baseUrl}/manga`, {
            params: { title, limit: 1, 'contentRating[]': ['safe', 'suggestive', 'erotica'] }
        });
        if (response.data.data.length > 0) {
            mangaDexId = response.data.data[0].id;
            console.log(`Resolved MangaDex ID: ${mangaDexId}`);
        }
    } catch(e) {
        console.error(`Search failed: ${e.message}`);
    }

    if (mangaDexId) {
        // 2. Fetch Feed
        try {
            const feedUrl = `${baseUrl}/manga/${mangaDexId}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=500&includeExternalVol=0`;
            const chaptersRes = await axios.get(feedUrl);
            console.log(`Found ${chaptersRes.data.data.length} chapters`);
            if (chaptersRes.data.data.length > 0) {
                const first = chaptersRes.data.data[0];
                console.log(`Latest: Ch ${first.attributes.chapter} - ${first.attributes.title || 'No Title'}`);
            }
        } catch(e) {
            console.error(`Feed fetch failed: ${e.message}`);
        }
    }
}

testFetchChapters(101517, 'Jujutsu Kaisen');
