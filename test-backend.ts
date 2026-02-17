import axios from 'axios';

const BACKEND_URL = 'http://localhost:3001/api/v1';

async function test() {
    console.log('--- TESTING BACKEND ENDPOINTS ---');

    try {
        console.log('1. Testing /streaming/search?query=Naruto');
        const res1 = await axios.get(`${BACKEND_URL}/streaming/search?query=Naruto`);
        console.log('Response Status:', res1.status);
        console.log('Results Found:', res1.data.data?.results?.length || res1.data?.results?.length);
    } catch (e: any) {
        console.error('Search Failed:', e.message, e.response?.status);
    }

    try {
        console.log('\n2. Testing /streaming/find?title=Naruto');
        const res2 = await axios.get(`${BACKEND_URL}/streaming/find?title=Naruto`);
        console.log('Response Status:', res2.status);
    } catch (e: any) {
        console.error('Find Failed:', e.message, e.response?.status);
    }
}

test();
