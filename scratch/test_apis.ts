import axios from 'axios';

async function testApis() {
    const jikanUrl = 'https://api.jikan.moe/v4/top/anime';
    const anilistUrl = 'https://graphql.anilist.co';

    console.log('Testing Jikan...');
    try {
        const jikanStart = Date.now();
        const jikanRes = await axios.get(jikanUrl, { timeout: 10000 });
        console.log(`Jikan Success (${Date.now() - jikanStart}ms): Found ${jikanRes.data?.data?.length} items`);
    } catch (e) {
        console.error(`Jikan Failed: ${e.message}`);
    }

    console.log('\nTesting AniList...');
    try {
        const anilistStart = Date.now();
        const query = `query { Page(page: 1, perPage: 1) { media(sort: TRENDING_DESC, type: ANIME) { id title { romaji } } } }`;
        const anilistRes = await axios.post(anilistUrl, { query }, { timeout: 10000 });
        console.log(`AniList Success (${Date.now() - anilistStart}ms): Found ${anilistRes.data?.data?.Page?.media?.length} items`);
    } catch (e) {
        console.error(`AniList Failed: ${e.message}`);
    }
}

testApis();
