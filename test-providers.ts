import { ANIME } from '@consumet/extensions';

async function testProvider(name: string, provider: any) {
    console.log(`\nTesting ${name}...`);
    try {
        console.log(`Searching for "Naruto" on ${name}...`);
        const search = await provider.search('Naruto');
        if (search.results.length === 0) {
            console.log(`${name}: No results found.`);
            return;
        }
        console.log(`${name}: Found ${search.results.length} results.`);
        const first = search.results[0];
        console.log(`${name}: First result: ${first.title} (${first.id})`);

        console.log(`${name}: Fetching anime info...`);
        const info = await provider.fetchAnimeInfo(first.id);
        console.log(`${name}: Episodes: ${info.episodes?.length}`);

        if (info.episodes && info.episodes.length > 0) {
            const ep = info.episodes[0];
            console.log(`${name}: Fetching sources for Episode 1 (${ep.id})...`);
            try {
                const sources = await provider.fetchEpisodeSources(ep.id);
                console.log(`${name}: Sources found:`, sources.sources?.length || 0);
                if (sources.sources && sources.sources.length > 0) {
                    console.log(`${name}: Sample Source:`, sources.sources[0].url);
                }
            } catch (e) {
                console.log(`${name}: Fetch sources failed:`, e.message);
            }
        }
    } catch (error) {
        console.error(`${name}: Error:`, error.message);
    }
}

async function runTests() {
    await testProvider('KickAssAnime', new ANIME.KickAssAnime());
    await testProvider('Hianime', new ANIME.Hianime());
    await testProvider('AnimePahe', new ANIME.AnimePahe());
    await testProvider('AnimeKai', new ANIME.AnimeKai());
}

runTests();
