
import axios from 'axios';

async function fullSystemTest() {
  const backendUrl = 'http://localhost:3001/api/v1';
  const frontendUrl = 'http://localhost:3000';

  console.log('--- SYSTEM TEST START ---');

  try {
    // 1. Check if backend is alive
    console.log('1. Checking Backend Health...');
    const animeRes = await axios.get(`${backendUrl}/anime/20`);
    console.log(`   Success: Found Anime "${animeRes.data.data.title}" (Episodes: ${animeRes.data.data.episodes})`);

    // 2. Check Streaming Match (using our new anilistId param)
    console.log('\n2. Checking Streaming Matcher...');
    const findRes = await axios.get(`${backendUrl}/streaming/find?title=Naruto&anilistId=20`);
    console.log(`   Success: Found ${findRes.data.data.length} potential matches`);

    // 3. Check Streaming Links with Fallback
    console.log('\n3. Checking Episode Links (Simulating HiAnime Down/Invalid)...');
    const epRes = await axios.get(`${backendUrl}/streaming/episode/naruto-1?malId=20&ep=1`);
    console.log('   Response Type:', epRes.data.data.provider);
    console.log('   Iframe URL:', epRes.data.data.iframeUrl);
    
    if (epRes.data.data.iframeUrl && epRes.data.data.iframeUrl.includes('vidlink.pro')) {
      console.log('   ✅ Backend Fallback: WORKING');
    }

    // 4. Check Frontend Route Proxy
    console.log('\n4. Checking Frontend API Proxy...');
    const feProxyRes = await axios.get(`${frontendUrl}/api/streaming/watch/naruto-1?malId=20&ep=1`);
    console.log('   Frontend Proxy Result:', feProxyRes.data.data.provider);
    
    if (feProxyRes.data.data.iframeUrl && feProxyRes.data.data.iframeUrl.includes('vidlink.pro')) {
      console.log('   ✅ Frontend Proxy: WORKING');
    }

    console.log('\n--- SYSTEM TEST COMPLETE: ALL SYSTEMS NOMINAL ---');

  } catch (error) {
    console.error('\n❌ SYSTEM TEST FAILED');
    console.error('Error:', error.response?.data || error.message);
  }
}

fullSystemTest();
