import { ANIME } from '@consumet/extensions';

async function testKickAssAnime() {
    const kaa = new ANIME.KickAssAnime();
    try {
        console.log('Searching for "Naruto"...');
        const search = await kaa.search('Naruto');
        if (search.results.length === 0) {
            console.log('No results found.');
            return;
        }
        console.log(`Found ${search.results.length} results.`);
        const first = search.results[0];
        console.log(`First result: ${first.title} (${first.id})`);

        console.log('Fetching anime info...');
        const info = await kaa.fetchAnimeInfo(first.id);
        console.log(`Episodes: ${info.episodes?.length}`);

        if (info.episodes && info.episodes.length > 0) {
            const ep = info.episodes[0];
            console.log(`Fetching sources for Episode 1 (${ep.id})...`);
            const sources = await kaa.fetchEpisodeSources(ep.id);
            console.log('Sources:', JSON.stringify(sources, null, 2));
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

testKickAssAnime();
