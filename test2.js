fetch('https://api.jikan.moe/v4/anime?order_by=score&sort=desc&limit=10').then(r => r.json()).then(data => console.log(data.data.map(a => a.title))).catch(console.error);
