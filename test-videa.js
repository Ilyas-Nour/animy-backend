const axios = require('axios');
axios.get('https://videa.hu/player?v=DiyGet7y3HtOpVqK', {
  headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://witanime.you/' }
}).then(res => {
  const html = res.data;
  console.log('Got Videa HTML size:', html.length);
  const match = html.match(/video_url\s*:\s*'([^']+)'/);
  if (match) console.log('Native Videa URL:', match[1]);
  else {
      const match2 = html.match(/src="([^"]+\.mp4[^"]*)"/i);
      console.log('Native MP4:', match2 ? match2[1] : 'Not found');
  }
}).catch(console.error);
