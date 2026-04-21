import axios from 'axios';

async function testSearch(title) {
    const baseUrl = 'https://api.mangadex.org';
    try {
        const response = await axios.get(`${baseUrl}/manga`, {
            params: {
                title: title,
                limit: 1,
                'contentRating[]': ['safe', 'suggestive', 'erotica']
            }
        });
        const results = response.data.data;
        if (results.length > 0) {
            console.log(`Match for "${title}": ${results[0].id}`);
            return results[0].id;
        } else {
            console.log(`No match for "${title}"`);
            return null;
        }
    } catch (e) {
        console.error(`Error searching for "${title}": ${e.message}`);
        return null;
    }
}

async function run() {
    await testSearch('Jujutsu Kaisen');
    await testSearch('Jujutsu Kaisen (TV)');
}

run();
