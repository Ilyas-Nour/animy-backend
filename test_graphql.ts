import { GraphQLClient, gql } from "graphql-request";

async function main() {
  const client = new GraphQLClient("https://graphql.anilist.co");
  const query = gql`
    query ($search: String, $page: Int, $perPage: Int, $format: MediaFormat) {
        Page(page: $page, perPage: $perPage) {
            pageInfo { total currentPage lastPage hasNextPage perPage }
            media(format: $format, type: ANIME, sort: [SCORE_DESC], isAdult: false, countryOfOrigin: "JP" , genre_not_in: ["Hentai", "Ecchi", "Kids"]) {
                id
                idMal
            }
        }
    }
  `;
  try {
    const data = await client.request(query, { page: 1, perPage: 24 });
    console.log(data);
  } catch (e) {
    console.error(e.response ? JSON.stringify(e.response, null, 2) : e);
  }
}
main();
