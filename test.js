const { GraphQLClient, gql } = require('graphql-request');
const client = new GraphQLClient('https://graphql.anilist.co');
const q = gql`query ($search: String, $page: Int, $perPage: Int, $format: MediaFormat) { Page(page: $page, perPage: $perPage) { media(search: $search, format: $format, type: ANIME, sort: [SCORE_DESC] , isAdult: false, genre_not_in: ["Hentai", "Ecchi"]) { title { romaji } averageScore format } } }`;
client.request(q, { page: 1, perPage: 10 }).then(data => console.log(JSON.stringify(data, null, 2))).catch(err => console.error(err.response.errors));
