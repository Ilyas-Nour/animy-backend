import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { GraphQLClient, gql } from 'graphql-request';

@Injectable()
export class AnilistService {
    private readonly logger = new Logger(AnilistService.name);
    private readonly client: GraphQLClient;
    private readonly endpoint = 'https://graphql.anilist.co';

    constructor() {
        this.client = new GraphQLClient(this.endpoint);
    }

    /**
     * Search for anime by query with filters
     */
    async searchAnime(query: string, page = 1, perPage = 20, format?: string, sort: string = 'POPULARITY_DESC') {
        const variables: any = { page, perPage };
        if (query) variables.search = query;
        if (format) variables.format = format;

        // Dynamic sort enum based on input
        const sortValue = sort;

        const queryGql = gql`
            query ($search: String, $page: Int, $perPage: Int, $format: MediaFormat) {
                Page(page: $page, perPage: $perPage) {
                    pageInfo {
                        total
                        currentPage
                        lastPage
                        hasNextPage
                        perPage
                    }
                    media(search: $search, format: $format, type: ANIME, sort: [${sortValue}], isAdult: false, genre_not_in: ["Hentai", "Ecchi"]) {
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
            const data: any = await this.client.request(queryGql, variables);
            return data.Page;
        } catch (error) {
            this.logger.error(`Error searching anime "${query}":`, error);
            throw new HttpException('Failed to fetch data from AniList', HttpStatus.BAD_GATEWAY);
        }
    }

    /**
     * Get anime details by ID (AniList ID)
     */
    async getAnimeById(id: number) {
        const queryGql = gql`
            query ($id: Int) {
                Media(id: $id, type: ANIME) {
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
                                }
                                coverImage {
                                    large
                                }
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
                    externalLinks {
                        id
                        site
                        url
                    }
                }
            }
        `;

        try {
            const data: any = await this.client.request(queryGql, { id });
            const media = data.Media;

            // Safety Check: Backend Enforcement
            if (media?.isAdult || media?.genres?.some(g => ["Hentai", "Ecchi"].includes(g))) {
                this.logger.warn(`Blocked NSFW/Ecchi content access for ID ${id}`);
                throw new HttpException('Content not available', HttpStatus.FORBIDDEN);
            }

            return media;
        } catch (error) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`Error fetching anime details for ID ${id}:`, error);
            throw new HttpException('Anime not found on AniList', HttpStatus.NOT_FOUND);
        }
    }

    /**
     * Get trending anime
     */
    async getTrending(page = 1, perPage = 20) {
        const queryGql = gql`
            query ($page: Int, $perPage: Int) {
                Page(page: $page, perPage: $perPage) {
                    media(sort: TRENDING_DESC, type: ANIME, isAdult: false, genre_not_in: ["Hentai", "Ecchi"]) {
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
            const data: any = await this.client.request(queryGql, { page, perPage });
            return data.Page.media;
        } catch (error) {
            this.logger.error(`Error fetching trending anime:`, error);
            return [];
        }
    }

    /**
     * Get popular anime
     */
    async getPopular(page = 1, perPage = 20) {
        const queryGql = gql`
            query ($page: Int, $perPage: Int) {
                Page(page: $page, perPage: $perPage) {
                    media(sort: POPULARITY_DESC, type: ANIME, isAdult: false, genre_not_in: ["Hentai", "Ecchi"]) {
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
            const data: any = await this.client.request(queryGql, { page, perPage });
            return data.Page.media;
        } catch (error) {
            this.logger.error(`Error fetching popular anime:`, error);
            return [];
        }
    }

    /**
     * Get anime by season
     */
    async getThisSeason(season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL', year: number, page = 1, perPage = 20) {
        const queryGql = gql`
            query ($season: MediaSeason, $year: Int, $page: Int, $perPage: Int) {
                Page(page: $page, perPage: $perPage) {
                    media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC, isAdult: false, genre_not_in: ["Hentai", "Ecchi"]) {
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
            const data: any = await this.client.request(queryGql, { season, year, page, perPage });
            return data.Page.media;
        } catch (error) {
            this.logger.error(`Error fetching seasonal anime:`, error);
            return [];
        }
    }

    /**
     * Search for manga by query
     */
    async searchManga(query: string, page = 1, perPage = 20, sort: string = 'POPULARITY_DESC') {
        const variables: any = { page, perPage };
        if (query) variables.search = query;

        // Dynamic sort enum based on input
        const sortValue = sort;

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
                    media(search: $search, type: MANGA, sort: [${sortValue}], isAdult: false, genre_not_in: ["Hentai", "Ecchi"]) {
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
            const data: any = await this.client.request(queryGql, variables);
            return data.Page;
        } catch (error) {
            this.logger.error(`Error searching manga "${query}":`, error);
            throw new HttpException('Failed to fetch data from AniList', HttpStatus.BAD_GATEWAY);
        }
    }

    /**
     * Get manga details by ID
     */
    async getMangaById(id: number) {
        const queryGql = gql`
            query ($id: Int) {
                Media(id: $id, type: MANGA) {
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
            const data: any = await this.client.request(queryGql, { id });
            const media = data.Media;

            // Safety Check: Backend Enforcement
            if (media?.isAdult || media?.genres?.some(g => ["Hentai", "Ecchi"].includes(g))) {
                this.logger.warn(`Blocked NSFW/Ecchi manga access for ID ${id}`);
                throw new HttpException('Content not available', HttpStatus.FORBIDDEN);
            }

            return media;
        } catch (error) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`Error fetching manga details for ID ${id}:`, error);
            throw new HttpException('Manga not found on AniList', HttpStatus.NOT_FOUND);
        }
    }

    /**
     * Get trending manga
     */
    async getTrendingManga(page = 1, perPage = 20) {
        const queryGql = gql`
            query ($page: Int, $perPage: Int) {
                Page(page: $page, perPage: $perPage) {
                    media(sort: TRENDING_DESC, type: MANGA, isAdult: false, genre_not_in: ["Hentai", "Ecchi"]) {
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
            const data: any = await this.client.request(queryGql, { page, perPage });
            return data.Page.media;
        } catch (error) {
            this.logger.error(`Error fetching trending manga:`, error);
            return [];
        }
    }

    /**
     * Get popular manga
     */
    async getPopularManga(page = 1, perPage = 20) {
        const queryGql = gql`
            query ($page: Int, $perPage: Int) {
                Page(page: $page, perPage: $perPage) {
                    media(sort: POPULARITY_DESC, type: MANGA, isAdult: false, genre_not_in: ["Hentai", "Ecchi"]) {
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
            const data: any = await this.client.request(queryGql, { page, perPage });
            return data.Page.media;
        } catch (error) {
            this.logger.error(`Error fetching popular manga:`, error);
            return [];
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
            const data: any = await this.client.request(queryGql, { id });
            return data.Character;
        } catch (error) {
            this.logger.error(`Error fetching character details for ID ${id}:`, error);
            throw new HttpException('Character not found on AniList', HttpStatus.NOT_FOUND);
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
            const data: any = await this.client.request(queryGql, { search: query, page, perPage });
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
        let season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
        let year = now.getFullYear();

        if (currentMonth >= 0 && currentMonth <= 2) { season = 'SPRING'; }
        else if (currentMonth >= 3 && currentMonth <= 5) { season = 'SUMMER'; }
        else if (currentMonth >= 6 && currentMonth <= 8) { season = 'FALL'; }
        else { season = 'WINTER'; year++; }

        const queryGql = gql`
            query ($season: MediaSeason, $year: Int, $page: Int, $perPage: Int) {
                Page(page: $page, perPage: $perPage) {
                    media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC, isAdult: false, genre_not_in: ["Hentai", "Ecchi"]) {
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
            const data: any = await this.client.request(queryGql, { season, year, page, perPage });
            return data.Page.media;
        } catch (error) {
            this.logger.error(`Error fetching upcoming anime:`, error);
            return [];
        }
    }
}
