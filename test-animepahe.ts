import { ANIME } from '@consumet/extensions';

async function testAnimePahe() {
    console.log('Testing AnimePahe...');
    const animepahe = new ANIME.AnimePahe();
    try {
        const search = await animepahe.search('Naruto');
        if (search.results.length === 0) {
            console.log('No results found.');
            return;
        }
        console.log(`Found ${search.results.length} results.`);
        const first = search.results[0];
        console.log(`First result: ${first.title} (${first.id})`);

        const info = await animepahe.fetchAnimeInfo(first.id);
        console.log(`Episodes: ${info.episodes?.length}`);

        if (info.episodes && info.episodes.length > 0) {
            const ep = info.episodes[0];
            console.log(`Fetching sources for Episode 1 (${ep.id})...`);
            const sources = await animepahe.fetchEpisodeSources(ep.id);
            console.log('Sources:', JSON.stringify(sources, null, 2));
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

testAnimePahe();
