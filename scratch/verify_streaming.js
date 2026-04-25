
import axios from 'axios';

async function verifyStreaming() {
  const baseUrl = 'http://localhost:3001/api/v1';

  try {
    console.log('Testing /streaming/find with anilistId...');
    const findRes = await axios.get(`${baseUrl}/streaming/find?title=Naruto&anilistId=20`);
    console.log('Find Result:', JSON.stringify(findRes.data, null, 2));

    console.log('\nTesting /streaming/episode with malId (expecting VidLink fallback)...');
    // Using a non-existent ID to trigger the fallback in case HiAnime is up (though it's likely down)
    const epRes = await axios.get(`${baseUrl}/streaming/episode/invalid-id?malId=20&ep=1`);
    console.log('Episode Links Result:', JSON.stringify(epRes.data, null, 2));

    if (epRes.data.iframeUrl && epRes.data.iframeUrl.includes('vidlink.pro')) {
      console.log('\n✅ VERIFICATION SUCCESS: VidLink fallback is working!');
    } else {
      console.log('\n❌ VERIFICATION FAILED: VidLink fallback not found.');
    }

  } catch (error) {
    console.error('Verification Error:', error.response?.data || error.message);
  }
}

verifyStreaming();
