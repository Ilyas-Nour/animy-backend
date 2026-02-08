import { Injectable, Logger, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { ANIME } from '@consumet/extensions';
import axios from 'axios';

@Injectable()
export class StreamingService {
    private readonly logger = new Logger(StreamingService.name);
    private readonly hianime = new ANIME.Hianime();
    private readonly animepahe = new ANIME.AnimePahe();
    private readonly animekai = new ANIME.AnimeKai();

    /**
     * Search for anime on streaming providers
     * @param query - Anime title to search
     * @param provider - Streaming provider
     */
    async searchAnime(query: string, provider: 'hianime' | 'animepahe' | 'animekai' = 'animepahe') {
        try {
            this.logger.debug(`Searching for "${query}" on ${provider}`);

            let providerInstance;
            switch (provider) {
                case 'hianime': providerInstance = this.hianime; break;
                case 'animekai': providerInstance = this.animekai; break;
                default: providerInstance = this.animepahe;
            }

            const results = await providerInstance.search(query);

            return {
                provider,
                results: results.results || [],
            };
        } catch (error) {
            this.logger.error(`Error searching anime on ${provider}:`, error);
            return { provider, results: [] };
        }
    }

    /**
     * Get anime info and episodes
     * @param animeId - Provider-specific anime ID
     * @param provider - Streaming provider
     */
    async getAnimeInfo(animeId: string, provider: 'hianime' | 'animepahe' | 'animekai' = 'animepahe') {
        try {
            this.logger.debug(`Fetching info for ${animeId} from ${provider}`);

            let providerInstance;
            switch (provider) {
                case 'hianime': providerInstance = this.hianime; break;
                case 'animekai': providerInstance = this.animekai; break;
                default: providerInstance = this.animepahe;
            }

            const info = await providerInstance.fetchAnimeInfo(animeId);

            if (!info) {
                throw new NotFoundException(`Anime not found on ${provider}`);
            }

            return {
                provider,
                ...info,
            };
        } catch (error) {
            this.logger.error(`Error fetching anime info from ${provider}:`, error.message);
            throw new HttpException(`Failed to fetch info from ${provider}: ${error.message}`, HttpStatus.NOT_FOUND);
        }
    }

    /**
     * Get streaming links for an episode
     * @param episodeId - Provider-specific episode ID
     * @param provider - Streaming provider
     */
    async getEpisodeLinks(episodeId: string, provider: 'hianime' | 'animepahe' | 'animekai' = 'animepahe', proxyBaseUrl?: string) {
        try {
            this.logger.debug(`Fetching links for episode ${episodeId} from ${provider}`);

            let providerInstance;
            switch (provider) {
                case 'hianime': providerInstance = this.hianime; break;
                case 'animekai': providerInstance = this.animekai; break;
                default: providerInstance = this.animepahe;
            }

            let sources;

            try {
                sources = await providerInstance.fetchEpisodeSources(episodeId);
            } catch (error) {
                this.logger.warn(`Failed to fetch sources from ${provider}: ${error.message}`);
                throw new NotFoundException(`Source error on ${provider}: ${error.message}`);
            }

            if (!sources || !sources.sources || sources.sources.length === 0) {
                this.logger.warn(`No sources found on ${provider} for episode ${episodeId}`);
                throw new NotFoundException(`No sources found on ${provider}`);
            }

            // Rewrite sources to point to our proxy
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
                provider,
                ...sources,
            };
        } catch (error) {
            this.logger.error(`Error fetching episode sources from ${provider}:`, error.message);
            throw new HttpException(`Failed to fetch links from ${provider}: ${error.message}`, HttpStatus.NOT_FOUND);
        }
    }

    /**
     * Aggregated Info Resolution: Find episodes for an anime across all providers
     */
    async getAggregatedInfo(title: string, titleEnglish?: string) {
        this.logger.log(`INFO AGGREGATION: "${title}" / "${titleEnglish}"`);

        const providers: ('animepahe' | 'hianime' | 'animekai')[] = ['animepahe', 'hianime', 'animekai'];

        for (const provider of providers) {
            try {
                // 1. Search for the anime on this provider
                const searchResults = await this.searchWithFallbacks(title, provider);
                if (searchResults.results.length === 0 && titleEnglish) {
                    const engResults = await this.searchWithFallbacks(titleEnglish, provider);
                    if (engResults.results.length > 0) searchResults.results = engResults.results;
                }

                if (searchResults.results.length > 0) {
                    const bestMatch = searchResults.results[0];
                    // 2. Fetch full info (including episodes)
                    const info = await this.getAnimeInfo(bestMatch.id, provider);

                    if (info && info.episodes && info.episodes.length > 0) {
                        this.logger.log(`Info Aggregation: SUCCESS! Found ${info.episodes.length} episodes on ${provider}`);
                        return {
                            ...info,
                            provider
                        };
                    }
                }
            } catch (e) {
                this.logger.warn(`Info Aggregation: Provider ${provider} failed: ${e.message}`);
                continue; // Try next one
            }
        }

        throw new NotFoundException(`Could not find episodes for "${title}" on any server.`);
    }

    /**
     * Aggregated Link Resolution: Search across all providers and return the first working set of links
     */
    async getAggregatedLinks(title: string, episodeNumber: number, titleEnglish?: string, preferredProvider?: string) {
        this.logger.log(`AGGREGATED REQUEST: "${title}" (Ep ${episodeNumber}) [Preferred: ${preferredProvider}]`);

        const providers: ('animepahe' | 'hianime' | 'animekai')[] = ['animepahe', 'hianime', 'animekai'];

        // Reorder providers if one is preferred
        if (preferredProvider && providers.includes(preferredProvider as any)) {
            const index = providers.indexOf(preferredProvider as any);
            providers.splice(index, 1);
            providers.unshift(preferredProvider as any);
        }

        const searchPromises = providers.map(async (provider) => {
            try {
                const results = await this.searchWithFallbacks(title, provider);
                if (results.results.length === 0 && titleEnglish) {
                    return this.searchWithFallbacks(titleEnglish, provider);
                }
                return results;
            } catch (e) { return { provider, results: [] }; }
        });

        const allSearchresults = await Promise.all(searchPromises);

        // Sort results to match our provider priority (preferred first)
        const sortedResults = providers.map(p => allSearchresults.find(res => res.provider === p)).filter(Boolean);

        // Try to fetch links from each provider that found a match, in order
        for (const searchResult of sortedResults) {
            if (!searchResult || searchResult.results.length === 0) continue;

            const bestMatch = searchResult.results[0];
            const provider = searchResult.provider as 'hianime' | 'animepahe' | 'animekai';

            try {
                this.logger.debug(`Aggregation: Trying ${provider} for ID ${bestMatch.id}`);

                // 1. Get Info to find the specific episode ID
                const info = await this.getAnimeInfo(bestMatch.id, provider);
                const episode = info.episodes.find(ep => ep.number === episodeNumber) || info.episodes[0];

                if (episode) {
                    // 2. Try to get links
                    const links = await this.getEpisodeLinks(episode.id, provider);
                    if (links.sources && links.sources.length > 0) {
                        this.logger.log(`Aggregation: SUCCESS! Found links on ${provider}`);
                        return {
                            ...links,
                            animeId: bestMatch.id,
                            episodeId: episode.id,
                            episodeNumber: episode.number,
                            provider // Return which provider was actually used
                        };
                    }
                }
            } catch (e) {
                this.logger.warn(`Aggregation: Provider ${provider} failed: ${e.message}`);
                continue; // Try next provider
            }
        }

        throw new NotFoundException(`Could not find working links for "${title}" on any server.`);
    }

    /**
     * Clean titles for better searching
     */
    private cleanTitle(title: string): string {
        return title
            .replace(/\(TV\)|\(Movie\)|\(OVA\)|\(ONA\)/gi, '')
            .replace(/Season \d+| \d+(st|nd|rd|th) Season/gi, '')
            .replace(/[:!?,]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Try searching with variations of the title
     */
    private async searchWithFallbacks(title: string, provider: 'hianime' | 'animepahe' | 'animekai') {
        const cleaned = this.cleanTitle(title);

        // Try original first
        let results = await this.searchAnime(title, provider);
        if (results.results.length > 0) return results;

        // Try cleaned
        if (cleaned !== title) {
            results = await this.searchAnime(cleaned, provider);
            if (results.results.length > 0) return results;
        }

        // Try truncated
        const truncated = title.split(/[:\-]/)[0].trim();
        if (truncated.length > 3 && truncated !== title && truncated !== cleaned) {
            results = await this.searchAnime(truncated, provider);
            if (results.results.length > 0) return results;
        }

        return { provider, results: [] };
    }

    /**
     * Search and get best match for anime by MAL title
     */
    async findAnimeByTitle(title: string, titleEnglish?: string) {
        this.logger.log(`Searching for streaming matches: "${title}" / "${titleEnglish}"`);

        const providers: ('animepahe' | 'hianime' | 'animekai')[] = ['animepahe', 'hianime', 'animekai'];

        for (const provider of providers) {
            try {
                const results = await this.searchWithFallbacks(title, provider);
                if (results.results.length > 0) return results;

                if (titleEnglish) {
                    const resultsEng = await this.searchWithFallbacks(titleEnglish, provider);
                    if (resultsEng.results.length > 0) return resultsEng;
                }
            } catch (error) {
                this.logger.warn(`Search failed on provider ${provider}, skipping...`);
            }
        }

        return { provider: 'animepahe', results: [] };
    }

    /**
     * Proxy a streaming resource to bypass CORS
     */
    async proxyStream(url: string, referer?: string, proxyBaseUrl?: string, isSegmentParam?: boolean) {
        this.logger.log(`PROXY REQUEST: url=${url}, isSegmentParam=${isSegmentParam}`);
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Referer': referer || '',
                },
                responseType: 'arraybuffer',
                timeout: 15000,
            });

            let data = response.data;
            const finalUrl = response.request.res.responseUrl || url;
            let contentType = response.headers['content-type'] || 'application/octet-stream';

            // If it's an M3U8 playlist or looks like one, we rewrite URLs
            const isM3U8 = url.includes('.m3u8') ||
                contentType.includes('mpegurl') ||
                contentType.includes('application/x-mpegURL') ||
                (contentType.includes('application/octet-stream') && url.split('?')[0].endsWith('.m3u8'));

            if (isM3U8) {
                // Ensure correct content type for M3U8
                contentType = 'application/vnd.apple.mpegurl';

                let text = data.toString();
                const u = new URL(finalUrl);
                // Base URL is the path up to the last slash of the final (possibly redirected) URL
                const baseUrl = u.origin + u.pathname.substring(0, u.pathname.lastIndexOf('/') + 1);

                const lines = text.split('\n');
                const rewrittenLines = lines.map(line => {
                    const trimmed = line.trim();
                    if (!trimmed) return line;

                    // 1. Handle segment URLs (lines not starting with #)
                    if (!trimmed.startsWith('#')) {
                        try {
                            // Resolve relative to the manifest's base URL
                            const absoluteUrl = new URL(trimmed, baseUrl).href;
                            if (proxyBaseUrl) {
                                // Add isSegment=true to help proxy identify media segments for MIME overriding
                                return `${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer || '')}&isSegment=true`;
                            }
                            return absoluteUrl;
                        } catch (e) {
                            return line;
                        }
                    }

                    // 2. Handle Tags with URI attributes (e.g., #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA)
                    // Support URI="...", URI='...', and URI=... (no quotes)
                    if (trimmed.startsWith('#') && /URI=["']?([^"'\s,]+)["']?/.test(trimmed)) {
                        return line.replace(/URI=(["']?)([^"'\s,]+)(["']?)/g, (match, quoteStart, uri, quoteEnd) => {
                            try {
                                const absoluteUrl = new URL(uri, baseUrl).href;
                                if (proxyBaseUrl) {
                                    const proxiedUrl = `${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer || '')}`;
                                    return `URI=${quoteStart}${proxiedUrl}${quoteEnd}`;
                                }
                                return `URI=${quoteStart}${absoluteUrl}${quoteEnd}`;
                            } catch (e) {
                                return match;
                            }
                        });
                    }

                    return line;
                });
                text = rewrittenLines.join('\n');
                data = Buffer.from(text);
            } else if (isSegmentParam || url.includes('isSegment=true') || url.split('?')[0].endsWith('.ts')) {
                // Force media MIME type for segments to avoid bufferAddCodecError in browser
                this.logger.debug(`Forcing video/mp2t for ${url} (isSegmentParam=${isSegmentParam})`);
                contentType = 'video/mp2t';
            }

            this.logger.debug(`Proxying ${url} with Content-Type: ${contentType}`);

            return {
                data,
                contentType,
            };
        } catch (error) {
            this.logger.error(`Proxy error for ${url}:`, error.message);
            throw new HttpException('Proxy failed', HttpStatus.BAD_GATEWAY);
        }
    }

    /**
     * Proxy an image to bypass Referer checks
     */
    async proxyImage(url: string, provider?: string) {
        try {
            let referer = '';
            if (provider === 'animepahe' || url.includes('animepahe')) {
                referer = 'https://animepahe.si/';
            } else if (provider === 'hianime' || url.includes('hianime')) {
                referer = 'https://hianime.to/';
            }

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Referer': referer,
                },
                responseType: 'arraybuffer',
                timeout: 10000,
            });

            return {
                data: response.data,
                contentType: response.headers['content-type'] || 'image/jpeg',
            };
        } catch (error) {
            this.logger.error(`Image proxy error for ${url}:`, error.message);
            throw new HttpException('Image proxy failed', HttpStatus.BAD_GATEWAY);
        }
    }
}
