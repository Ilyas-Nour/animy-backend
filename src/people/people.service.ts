import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { GraphQLClient, gql } from "graphql-request";

@Injectable()
export class PeopleService {
  private readonly logger = new Logger(PeopleService.name);
  private readonly client = new GraphQLClient("https://graphql.anilist.co");

  async getPerson(id: number) {
    const query = gql`
      query ($id: Int) {
        Staff(id: $id) {
          id
          name {
            full
            native
            alternative
          }
          image {
            large
            medium
          }
          description
          gender
          dateOfBirth {
            year
            month
            day
          }
          homeTown
          languageV2
          primaryOccupations
          characterMedia(sort: START_DATE_DESC, page: 1, perPage: 25) {
            edges {
              characterRole
              node {
                id
                title {
                  romaji
                }
                coverImage {
                  medium
                }
              }
              characterNode {
                id
                name {
                  full
                }
                image {
                  medium
                }
              }
            }
          }
          staffMedia(sort: START_DATE_DESC, page: 1, perPage: 25) {
            edges {
              staffRole
              node {
                id
                title {
                  romaji
                }
                coverImage {
                  medium
                }
              }
            }
          }
        }
      }
    `;

    try {
      const data: any = await this.client.request(query, { id });
      if (!data.Staff) {
        throw new HttpException("Staff not found", HttpStatus.NOT_FOUND);
      }
      return data.Staff;
    } catch (error) {
      this.logger.error(`Error fetching person ${id}:`, error);
      throw new HttpException(
        "Error fetching person from AniList",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
