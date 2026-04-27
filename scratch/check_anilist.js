const axios = require('axios');

async function checkAnime(id) {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        title {
          romaji
          english
        }
        characters(page: 1, perPage: 10) {
          edges {
            role
            node {
              name {
                full
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await axios.post('https://graphql.anilist.co', {
      query,
      variables: { id: parseInt(id) }
    });
    console.log(JSON.stringify(response.data.data.Media, null, 2));
  } catch (error) {
    console.error(error.message);
  }
}

// Re:Zero 4th Season? Let's try to find its ID first or just check a known one.
// The user's screenshot shows Re:Zero 4th Season.
// Searching for it on AniList manually might be hard here, but I can check if the backend has it.
checkAnime(182414); // This might be the ID for Re:Zero S4 or similar
