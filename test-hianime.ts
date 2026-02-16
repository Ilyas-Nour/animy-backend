import { ANIME } from '@consumet/extensions';

async function testHianime() {
    console.log('Testing Hianime...');
    const hianime = new ANIME.Hianime();
    try {
        const search = await hianime.search('Naruto Shippuden');
        if (search.results.length === 0) {
            console.log('No results found.');
            return;
        }
        console.log(`Found ${search.results.length} results.`);
        const first = search.results[0];
        console.log(`First result: ${first.title} (${first.id})`);

        const info = await hianime.fetchAnimeInfo(first.id);
        console.log(`Episodes: ${info.episodes?.length}`);

        if (info.episodes && info.episodes.length > 0) {
            const ep = info.episodes[0];
            console.log(`Fetching sources for Packet ${ep.id}...`);
            const sources = await hianime.fetchEpisodeSources(ep.id);
            console.log('Sources:', JSON.stringify(sources, null, 2));
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

testHianime();
