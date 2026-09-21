const query = `
query { 
  Page(page: 1, perPage: 1) { 
    media(sort: POPULARITY_DESC, type: MANGA, genre_not_in: ["Hentai", "Ecchi"]) { 
      id 
      title { romaji } 
      isAdult
    } 
  } 
}`;

fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
})
.then(r => r.json())
.then(data => console.log(JSON.stringify(data, null, 2)))
.catch(console.error);
