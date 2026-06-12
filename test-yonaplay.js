const axios = require('axios');
axios.get('https://yonaplay.net/embed.php?id=17200', {
  headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://witanime.you/' }
}).then(res => {
  const html = res.data;
  console.log('HTML size:', html.length);
  const m = html.match(/https:\/\/ok\.ru\/videoembed\/\d+/);
  if (m) console.log('Found ok.ru:', m[0]);
  else {
    const embeds = html.match(/data-url="([^"]+)"/g) || [];
    console.log('Servers inside yonaplay:', embeds);
  }
}).catch(console.error);
