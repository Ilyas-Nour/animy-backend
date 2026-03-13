const axios = require('axios');

async function getChapters() {
    const title = 'SPY×FAMILY';
    const providers = ['mangapill', 'mangadex', 'mangareader'];
    const normalize = (str) => str.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim();
    const normalizedTargetTitle = normalize(title);
    
    for (const provider of providers) {
        try {
            console.log(`Searching provider: ${provider} for ${title}`);
            const searchRes = await axios.get(`https://consumet-api-clone.vercel.app/manga/${provider}/${encodeURIComponent(title)}`);
            if (searchRes.data?.results?.length > 0) {
                // Check each result that matches our fuzzy title for chapters
                for (const res of searchRes.data.results) {
                    const normalizedResTitle = normalize(res.title);
                    if (normalizedResTitle === normalizedTargetTitle || normalizedResTitle.includes(normalizedTargetTitle) || normalizedTargetTitle.includes(normalizedResTitle)) {
                        console.log(`[${provider}] Matched title: ${res.title} (ID: ${res.id})`);
                        // Fetch info to verify it actually has chapters
                        try {
                            const infoUrl = `https://consumet-api-clone.vercel.app/manga/${provider}/info?id=${res.id}`;
                            const infoRes = await axios.get(infoUrl);
                            if (infoRes.data?.chapters && infoRes.data.chapters.length > 0) {
                                console.log(`[${provider}] SUCCESS! Found ${infoRes.data.chapters.length} chapters.`);
                                return;
                            } else {
                                console.log(`[${provider}] Failed: Match found but it has 0 chapters.`);
                            }
                        } catch (e) {
                             console.log(`[${provider}] Failed to fetch info for ${res.id}`);
                        }
                    }
                }
            } else {
                 console.log(`[${provider}] No search results.`);
            }
        } catch(e) {
             console.log(`[${provider}] Search request failed.`);
        }
    }
}
getChapters();
