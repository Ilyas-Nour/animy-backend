import { Injectable, Logger, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { HiAnimeService } from './hianime.service';

@Injectable()
export class StreamingService {
    private readonly logger = new Logger(StreamingService.name);

    constructor(private readonly hiAnimeService: HiAnimeService) { }

    /**
     * Search for an anime on the streaming provider
     * @param query - Anime title to search
     */
    async searchAnime(query: string) {
        try {
            this.logger.debug(`Searching for "${query}" on HiAnime`);
            const results = await this.hiAnimeService.search(query);
            return {
                provider: 'hianime',
                results: results.results || [],
            };
        } catch (error) {
            this.logger.error(`Error searching anime on HiAnime:`, error);
            return { provider: 'hianime', results: [] };
        }
    }

    /**
     * Get detailed anime info (episodes, etc)
     * @param animeId - Provider-specific anime ID
     */
    async getAnimeInfo(animeId: string) {
        try {
            this.logger.debug(`Fetching info for ${animeId} from HiAnime`);
            const info = await this.hiAnimeService.fetchAnimeInfo(animeId);

            if (!info) {
                throw new NotFoundException(`Anime not found on HiAnime`);
            }

            return {
                provider: 'hianime',
                ...info,
            };
        } catch (error) {
            this.logger.error(`Error fetching anime info from HiAnime:`, error.message);
            throw new HttpException(`Failed to fetch info from HiAnime: ${error.message}`, HttpStatus.NOT_FOUND);
        }
    }

    /**
     * Get streaming links for an episode
     * @param episodeId - Provider-specific episode ID
     * @param provider - Ignored, always HiAnime
     * @param proxyBaseUrl - Optional backend proxy URL for M3U8 rewriting
     */
    async getEpisodeLinks(episodeId: string, provider: string = 'hianime', proxyBaseUrl?: string) {
        try {
            this.logger.debug(`Fetching links for episode ${episodeId} from HiAnime`);
            const sources = await this.hiAnimeService.fetchEpisodeSources(episodeId);

            if (!sources || !sources.sources || sources.sources.length === 0) {
                this.logger.warn(`No sources found on HiAnime for episode ${episodeId}`);
                throw new NotFoundException(`No sources found on HiAnime`);
            }

            // Rewrite sources to point to our proxy if requested
            if (proxyBaseUrl) {
                sources.sources = sources.sources.map((source: any) => {
                    // Only proxy m3u8 files
                    if (source.url && (source.url.includes('.m3u8') || source.isM3U8)) {
                        const originalUrl = source.url;
                        const referer = sources.headers?.Referer || '';
                        // Double encode to ensure safe transport through query params
                        source.url = `${proxyBaseUrl}?url=${encodeURIComponent(originalUrl)}&referer=${encodeURIComponent(referer)}`;
                    }
                    return source;
                });
            }

            return {
                provider: 'hianime',
                ...sources,
            };
        } catch (error) {
            this.logger.error(`Error fetching episode sources from HiAnime: ${error.message}`);
            throw new HttpException(`Failed to fetch links from HiAnime: ${error.message}`, HttpStatus.NOT_FOUND);
        }
    }

    /**
     * Search and get best match for anime by MAL title (from AniList)
     */
    async findAnimeByTitle(title: string, titleEnglish?: string) {
        try {
            this.logger.debug(`Finding HiAnime match for: ${title} / ${titleEnglish}`);
            let results = await this.hiAnimeService.search(title);

            if (results.results.length === 0 && titleEnglish) {
                results = await this.hiAnimeService.search(titleEnglish);
            }

            return results.results;
        } catch (error) {
            this.logger.error(`Search failed for ${title}`, error.message);
            return [];
        }
    }
}
