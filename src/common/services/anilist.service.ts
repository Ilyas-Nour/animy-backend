import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { GraphQLClient, gql } from "graphql-request";

@Injectable()
export class AnilistService {
  private readonly logger = new Logger(AnilistService.name);
  private readonly client: GraphQLClient;
  private readonly endpoint = "https://graphql.anilist.co";

  constructor() {
    this.client = new GraphQLClient(this.endpoint);
  }

  private async requestWithTimeout(
    query: any,
    variables: any = {},
    timeoutMs = 8000,
  ) {
    return Promise.race([
      this.client.request(query, variables),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("AniList Timeout")), timeoutMs),
      ),
    ]);
  }

  /**
   * Search for anime by query with filters
   */
  async searchAnime(
    query: string,
    page = 1,
    perPage = 20,
    format?: string,
    sort: string = "POPULARITY_DESC",
  ) {
    const variables: any = { page, perPage };
    let searchParam = "";
    if (query) {
      variables.search = query;
      searchParam = "search: $search, ";
    }
    if (format) variables.format = format;

    // Dynamic sort enum based on input
    const sortValue = sort;
    
    const querySignature = query 
        ? "query ($search: String, $page: Int, $perPage: Int, $format: MediaFormat)" 
        : "query ($page: Int, $perPage: Int, $format: MediaFormat)";

    const queryGql = gql`
            ${querySignature} {
                Page(page: $page, perPage: $perPage) {
                    pageInfo {
                        total
                        currentPage
                        lastPage
                        hasNextPage
                        perPage
                    }
                    media(${searchParam}format: $format, type: ANIME, sort: [${sortValue}], isAdult: false, countryOfOrigin: "JP" ${query ? "" : ', genre_not_in: ["Hentai", "Ecchi", "Kids"]'}) {
                        id
                        idMal
                        isAdult
                        title {
                            romaji
                            english
                            native
                        }
                        coverImage {
                            extraLarge
                            large
                            medium
                            color
                        }
                        bannerImage
                        description
                        format
                        episodes
                        duration
                        status
                        season
                        seasonYear
                        averageScore
                        popularity
                        genres
                        studios(isMain: true) {
                            nodes {
                                name
                            }
                        }
                    }
                }
            }
        `;

    try {
      const data: any = await this.requestWithTimeout(queryGql, variables);
      return data.Page;
    } catch (error) {
      this.logger.error(`Error searching anime "${query}":`, error.message);
      throw new HttpException(
        "Failed to fetch data from AniList",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Get anime details by ID (AniList ID)
   */
  async getAnimeById(id: number, isMal: boolean = false) {
    const queryGql = gql`
      query ($id: Int) {
        Media(${isMal ? 'idMal' : 'id'}: $id, type: ANIME) {
          id
          idMal
          isAdult
          title {
            romaji
            english
            native
          }
          coverImage {
            extraLarge
            large
            medium
            color
          }
          bannerImage
          description
          format
          episodes
          duration
          status
          season
          seasonYear
          averageScore
          popularity
          favourites
          genres
          rankings {
            rank
            type
            format
            allTime
          }
          synonyms
          source
          studios(isMain: true) {
            nodes {
              name
            }
          }
          nextAiringEpisode {
            airingAt
            timeUntilAiring
            episode
          }
          trailer {
            id
            site
            thumbnail
          }
          recommendations(sort: RATING_DESC, page: 1, perPage: 10) {
            nodes {
              mediaRecommendation {
                id
                isAdult
                title {
                  romaji
                  english
                }
                coverImage {
                  large
                }
              }
            }
          }
          relations {
            edges {
              relationType
              node {
                id
                idMal
                status
                type
                format
                title {
                  romaji
                  english
                }
                coverImage {
                  large
                }
              }
            }
          }
          staff(sort: RELEVANCE, perPage: 8) {
            edges {
              role
              node {
                id
                name {
                  full
                }
                image {
                  large
                }
              }
            }
          }
          characters(sort: [ROLE, RELEVANCE, ID], page: 1, perPage: 12) {
            edges {
              role
              node {
                id
                name {
                  full
                }
                image {
                  large
                }
              }
              voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
                id
                name {
                  full
                }
                image {
                  large
                }
              }
            }
          }
          externalLinks {
            id
            site
            url
          }
        }
      }
    `;

    try {
      const data: any = await this.requestWithTimeout(queryGql, { id });
      const media = data.Media;

      return media;
    } catch (error: any) {
      if (
        error?.response?.status === 404 || 
        error?.response?.errors?.[0]?.status === 404 || 
        error?.message?.includes("Not Found") || 
        error?.message?.includes("404")
      ) {
        this.logger.debug(`AniList: Anime ${id} not found (404)`);
        return null;
      }
      if (error instanceof HttpException) throw error;
      this.logger.error(`Error fetching anime details for ID ${id}:`, error);
      throw new HttpException(
        "Anime not found on AniList",
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /**
   * Get trending anime
   */
  async getTrending(page = 1, perPage = 20) {
    const queryGql = gql`
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(
            sort: [TRENDING_DESC]
            type: ANIME
            isAdult: false
            countryOfOrigin: "JP"
            genre_not_in: ["Hentai", "Ecchi", "Kids"]
          ) {
            id
            idMal
            isAdult
            title {
              romaji
              english
            }
            coverImage {
              extraLarge
              large
            }
            bannerImage
            description
            averageScore
            popularity
            genres
            format
            episodes
            status
          }
        }
      }
    `;

    try {
      const data: any = await this.requestWithTimeout(
        queryGql,
        { page, perPage },
        8000,
      );
      return data.Page;
    } catch (error) {
      this.logger.error(`Error fetching trending anime:`, error.message);
      throw new HttpException(
        "Failed to fetch trending from AniList",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Get popular anime
   */
  async getPopular(page = 1, perPage = 20) {
    const queryGql = gql`
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(
            sort: [POPULARITY_DESC]
            type: ANIME
            isAdult: false
            countryOfOrigin: "JP"
            genre_not_in: ["Hentai", "Ecchi", "Kids"]
          ) {
            id
            idMal
            isAdult
            title {
              romaji
              english
            }
            coverImage {
              extraLarge
              large
            }
            bannerImage
            description
            averageScore
            popularity
            genres
            format
            episodes
            status
          }
        }
      }
    `;

    try {
      const data: any = await this.requestWithTimeout(
        queryGql,
        { page, perPage },
        8000,
      );
      return data.Page;
    } catch (error) {
      this.logger.error(`Error fetching popular anime:`, error.message);
      throw new HttpException(
        "Failed to fetch popular from AniList",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Get top airing anime
   */
  async getTopAiring(page = 1, perPage = 20) {
    const queryGql = gql`
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(
            status: RELEASING
            sort: [POPULARITY_DESC]
            type: ANIME
            isAdult: false
            countryOfOrigin: "JP"
            genre_not_in: ["Hentai", "Ecchi", "Kids"]
          ) {
            id
            idMal
            isAdult
            title {
              romaji
              english
            }
            coverImage {
              extraLarge
              large
            }
            bannerImage
            description
            averageScore
            popularity
            genres
            format
            episodes
            status
          }
        }
      }
    `;

    try {
      const data: any = await this.requestWithTimeout(
        queryGql,
        { page, perPage },
        8000,
      );
      return data.Page;
    } catch (error) {
      this.logger.error(`Error fetching top airing anime:`, error.message);
      throw new HttpException(
        "Failed to fetch top airing from AniList",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Get anime by season
   */
  async getThisSeason(
    season: "WINTER" | "SPRING" | "SUMMER" | "FALL",
    year: number,
    page = 1,
    perPage = 20,
  ) {
    const queryGql = gql`
      query ($season: MediaSeason, $year: Int, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(
            season: $season
            seasonYear: $year
            type: ANIME
            sort: [POPULARITY_DESC]
            isAdult: false
            countryOfOrigin: "JP"
            genre_not_in: ["Hentai", "Ecchi", "Kids"]
          ) {
            id
            idMal
            isAdult
            title {
              romaji
              english
            }
            coverImage {
              extraLarge
              large
            }
            bannerImage
            averageScore
            popularity
            genres
            format
            episodes
            status
          }
        }
      }
    `;

    try {
      const data: any = await this.requestWithTimeout(
        queryGql,
        {
          season,
          year,
          page,
          perPage,
        },
        8000,
      );
      return data.Page;
    } catch (error) {
      this.logger.error(`Error fetching seasonal anime:`, error.message);
      throw new HttpException(
        "Failed to fetch seasonal from AniList",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Search for manga by query
   */
  async searchManga(
    query: string,
    page = 1,
    perPage = 20,
    sort: string = "POPULARITY_DESC",
    status?: string,
  ) {
    const variables: any = { page, perPage };
    if (query) variables.search = query;
    if (status) variables.status = status;

    // Dynamic sort enum based on input
    const sortValue = sort;
    
    const querySignature = query
        ? "query ($search: String, $page: Int, $perPage: Int, $status: MediaStatus)"
        : "query ($page: Int, $perPage: Int, $status: MediaStatus)";

    const queryGql = gql`
            ${querySignature} {
                Page(page: $page, perPage: $perPage) {
                    pageInfo {
                        total
                        currentPage
                        lastPage
                        hasNextPage
                        perPage
                    }
                    media(${query ? "search: $search, " : ""}type: MANGA, sort: [${sortValue}], status: $status ${query ? "" : ', genre_not_in: ["Hentai", "Ecchi"]'}) {
                        id
                        idMal
                        isAdult
                        title {
                            romaji
                            english
                            native
                        }
                        coverImage {
                            extraLarge
                            large
                            medium
                            color
                        }
                        bannerImage
                        description
                        format
                        chapters
                        volumes
                        status
                        averageScore
                        popularity
                        genres
                        startDate {
                            year
                        }
                        staff {
                            nodes {
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
      const data: any = await this.requestWithTimeout(queryGql, variables);
      return data.Page;
    } catch (error) {
      this.logger.error(`Error searching manga "${query}":`, error);
      throw new HttpException(
        "Failed to fetch data from AniList",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Get manga details by ID
   */
  async getMangaById(id: number, isMal: boolean = false) {
    const queryGql = gql`
      query ($id: Int) {
        Media(${isMal ? 'idMal' : 'id'}: $id, type: MANGA) {
          id
          idMal
          isAdult
          title {
            romaji
            english
            native
          }
          coverImage {
            extraLarge
            large
            medium
            color
          }
          bannerImage
          description
          format
          chapters
          volumes
          status
          averageScore
          popularity
          genres
          synonyms
          source
          startDate {
            year
            month
            day
          }
          staff {
            nodes {
              name {
                full
              }
            }
          }
          characters(sort: ROLE, page: 1, perPage: 10) {
            nodes {
              id
              name {
                full
              }
              image {
                large
              }
            }
            edges {
              role
            }
          }
          recommendations(sort: RATING_DESC, page: 1, perPage: 10) {
            nodes {
              mediaRecommendation {
                id
                isAdult
                title {
                  romaji
                }
                coverImage {
                  large
                }
              }
            }
          }
        }
      }
    `;

    try {
      const data: any = await this.requestWithTimeout(queryGql, { id });
      const media = data.Media;

      return media;
    } catch (error: any) {
      if (
        error?.response?.status === 404 || 
        error?.response?.errors?.[0]?.status === 404 || 
        error?.message?.includes("Not Found") || 
        error?.message?.includes("404")
      ) {
        this.logger.debug(`AniList: Manga ${id} not found (404)`);
        return null;
      }
      if (error instanceof HttpException) throw error;
      this.logger.error(`Error fetching manga details for ID ${id}:`, error);
      throw new HttpException(
        "Manga not found on AniList",
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /**
   * Get character details by ID
   */
  async getCharacterById(id: number) {
    const queryGql = gql`
      query ($id: Int) {
        Character(id: $id) {
          id
          name {
            full
            native
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
          age
          bloodType
          media(sort: POPULARITY_DESC, page: 1, perPage: 10) {
            nodes {
              id
              isAdult
              title {
                romaji
              }
              coverImage {
                medium
              }
              type
            }
            edges {
              characterRole
            }
          }
        }
      }
    `;

    try {
      const data: any = await this.requestWithTimeout(queryGql, { id });
      return data.Character;
    } catch (error) {
      this.logger.error(
        `Error fetching character details for ID ${id}:`,
        error,
      );
      throw new HttpException(
        "Character not found on AniList",
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /**
   * Search characters
   */
  async searchCharacters(query: string, page = 1, perPage = 20) {
    const queryGql = gql`
      query ($search: String, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
            perPage
          }
          characters(search: $search, sort: FAVOURITES_DESC) {
            id
            name {
              full
            }
            image {
              large
              medium
            }
            favourites
          }
        }
      }
    `;

    try {
      const data: any = await this.requestWithTimeout(queryGql, {
        search: query,
        page,
        perPage,
      });
      return data.Page;
    } catch (error) {
      this.logger.error(`Error searching characters "${query}":`, error);
      return { characters: [], pageInfo: {} };
    }
  }

  /**
   * Get upcoming anime (Next Season)
   */
  async getNextSeason(page = 1, perPage = 20) {
    // Calculate next season
    const now = new Date();
    const currentMonth = now.getMonth();
    let season: "WINTER" | "SPRING" | "SUMMER" | "FALL";
    let year = now.getFullYear();

    if (currentMonth >= 0 && currentMonth <= 2) {
      season = "SPRING";
    } else if (currentMonth >= 3 && currentMonth <= 5) {
      season = "SUMMER";
    } else if (currentMonth >= 6 && currentMonth <= 8) {
      season = "FALL";
    } else {
      season = "WINTER";
      year++;
    }

    const queryGql = gql`
      query ($season: MediaSeason, $year: Int, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(
            season: $season
            seasonYear: $year
            type: ANIME
            sort: [POPULARITY_DESC]
            isAdult: false
            countryOfOrigin: "JP"
            genre_not_in: ["Hentai", "Ecchi", "Kids"]
          ) {
            id
            isAdult
            title {
              romaji
              english
            }
            coverImage {
              extraLarge
              large
            }
            averageScore
            popularity
            genres
            format
            status
            startDate {
              year
              month
              day
            }
          }
        }
      }
    `;

    try {
      const data: any = await this.requestWithTimeout(
        queryGql,
        {
          season,
          year,
          page,
          perPage,
        },
        8000,
      );
      return data.Page;
    } catch (error) {
      this.logger.error(`Error fetching upcoming anime:`, error.message);
      throw new HttpException(
        "Failed to fetch upcoming from AniList",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Get trending manga
   */
  async getTrendingManga(page = 1, perPage = 20) {
    const queryGql = gql`
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
            perPage
          }
          media(
            sort: [TRENDING_DESC]
            type: MANGA
            genre_not_in: ["Hentai", "Ecchi"]
          ) {
            id
            idMal
            isAdult
            title {
              romaji
              english
            }
            coverImage {
              extraLarge
              large
            }
            bannerImage
            description
            averageScore
            popularity
            genres
            format
            status
          }
        }
      }
    `;

    try {
      const data: any = await this.requestWithTimeout(
        queryGql,
        { page, perPage },
        8000,
      );
      return data.Page;
    } catch (error) {
      this.logger.error(`Error fetching trending manga:`, error.message);
      throw new HttpException(
        "Failed to fetch trending manga from AniList",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Get popular manga
   */
  async getPopularManga(page = 1, perPage = 20) {
    const queryGql = gql`
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
            perPage
          }
          media(
            sort: [POPULARITY_DESC]
            type: MANGA
            genre_not_in: ["Hentai", "Ecchi"]
          ) {
            id
            idMal
            isAdult
            title {
              romaji
              english
            }
            coverImage {
              extraLarge
              large
            }
            bannerImage
            description
            averageScore
            popularity
            genres
            format
            status
          }
        }
      }
    `;

    try {
      const data: any = await this.requestWithTimeout(
        queryGql,
        { page, perPage },
        8000,
      );
      return data.Page;
    } catch (error) {
      this.logger.error(`Error fetching popular manga:`, error.message);
      throw new HttpException(
        "Failed to fetch popular manga from AniList",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Get recently aired episodes
   */
  async getRecentEpisodes(page = 1, perPage = 15) {
    const queryGql = gql`
      query ($page: Int, $perPage: Int, $now: Int) {
        Page(page: $page, perPage: $perPage) {
          airingSchedules(
            airingAt_lesser: $now,
            sort: [TIME_DESC]
          ) {
            episode
            airingAt
            media {
              id
              idMal
              isAdult
              title {
                romaji
                english
              }
              coverImage {
                extraLarge
                large
              }
              bannerImage
              averageScore
              popularity
              genres
              countryOfOrigin
              format
              episodes
              status
            }
          }
        }
      }
    `;

    try {
      const now = Math.floor(Date.now() / 1000);
      const data: any = await this.requestWithTimeout(
        queryGql,
        { page, perPage, now },
        8000,
      );
      
      // Map it to match the expected 'media' structure for our frontend
      if (data?.Page?.airingSchedules) {
        const uniqueMedia = new Map<number, any>();
        
        data.Page.airingSchedules.forEach((schedule: any) => {
          const media = schedule.media;
          
          // Filter out unwanted genres and non-JP country of origin
          if (media.isAdult || 
              media.countryOfOrigin !== 'JP' ||
              media.genres?.includes('Hentai') || 
              media.genres?.includes('Ecchi') || 
              media.genres?.includes('Kids')) {
            return;
          }

          if (!uniqueMedia.has(media.id)) {
            media.recentEpisodeNumber = schedule.episode;
            media.recentEpisodeAiringAt = schedule.airingAt;
            uniqueMedia.set(media.id, media);
          }
        });

        return {
          media: Array.from(uniqueMedia.values())
        };
      }
      return { media: [] };
    } catch (error) {
      this.logger.error(`Error fetching recent episodes:`, error.message);
      throw new HttpException(
        "Failed to fetch recent episodes from AniList",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
