import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class HiAnimeService {
    private readonly logger = new Logger(HiAnimeService.name);
    private readonly baseUrl = process.env.HIANIME_API_URL || 'https://hianime-api-henna.vercel.app/api/v1';

    async search(query: string) {
        try {
            const url = `${this.baseUrl}/search?keyword=${encodeURIComponent(query)}`;
            const { data } = await axios.get(url);

            if (data.success && data.data && data.data.response) {
                return {
                    results: data.data.response.map((item: any) => ({
                        id: item.id,
                        title: item.title,
                        image: item.poster,
                        url: `/anime/${item.id}`, // specific to provider structure if needed
                        // Map other fields as necessary
                    }))
                };
            }
            return { results: [] };
        } catch (error) {
            this.logger.error(`Error searching HiAnime: ${error.message}`);
            return { results: [] };
        }
    }

    async fetchAnimeInfo(id: string) {
        try {
            const url = `${this.baseUrl}/anime/${id}`;
            const { data } = await axios.get(url);

            if (data.success && data.data) {
                const info = data.data.animeInfo;
                // Fetch episodes too since Consumet returns them with info
                const episodesUrl = `${this.baseUrl}/episodes/${id}`;
                const episodesData = await axios.get(episodesUrl);

                let episodes = [];
                if (episodesData.data.success && episodesData.data.data && episodesData.data.data.episodes) {
                    episodes = episodesData.data.data.episodes.map((ep: any) => ({
                        id: ep.id,
                        number: ep.episodeNumber,
                        title: ep.title,
                        isFiller: ep.isFiller,
                        url: `/watch/${ep.id}`
                    }));
                } else if (episodesData.data.success && episodesData.data.data) {
                    // Check if data is array directly 
                    episodes = (Array.isArray(episodesData.data.data) ? episodesData.data.data : []).map((ep: any) => ({
                        id: ep.id,
                        number: ep.episodeNumber,
                        title: ep.title,
                        isFiller: ep.isFiller,
                        url: `/watch/${ep.id}`
                    }));
                }

                return {
                    id: data.data.id || id,
                    title: info.title || data.data.title,
                    image: info.poster || data.data.poster,
                    description: info.description || data.data.description,
                    episodes: episodes
                };
            }
            return null;
        } catch (error) {
            this.logger.error(`Error getting HiAnime info: ${error.message}`);
            return null;
        }
    }

    async fetchEpisodeSources(episodeId: string) {
        try {
            // 1. Try default (usually HD-1 / Vidstreaming)
            let sources = await this.fetchSourceFromApi(episodeId);
            if (sources.sources && sources.sources.length > 0) return sources;

            // 2. If default fails, fetch available servers and try others
            this.logger.warn(`Default server failed for ${episodeId}, fetching server list...`);
            const serversUrl = `${this.baseUrl}/servers?id=${encodeURIComponent(episodeId)}`;
            const { data: serverData } = await axios.get(serversUrl);

            if (serverData.success && serverData.data) {
                // Combine sub and dub servers
                const servers = [
                    ...(serverData.data.sub || []).map((s: any) => ({ ...s, type: 'sub' })),
                    ...(serverData.data.dub || []).map((s: any) => ({ ...s, type: 'dub' }))
                ];

                // Prioritize HD-2 (MegaCloud) as it's often more reliable if HD-1 fails
                // and avoid HD-1 since we likely just failed on it (unless default wasn't HD-1)
                const candidates = servers.sort((a: any, b: any) => {
                    if (a.name === 'HD-2') return -1;
                    if (b.name === 'HD-2') return 1;
                    return 0;
                });

                for (const server of candidates) {
                    // Skip if name is undefined (shouldn't happen but be safe)
                    if (!server.name) continue;

                    this.logger.debug(`Retrying with server: ${server.name} (${server.type})`);
                    try {
                        const result = await this.fetchSourceFromApi(episodeId, server.name, server.type);
                        if (result.sources && result.sources.length > 0) {
                            return result;
                        }
                    } catch (e) {
                        this.logger.debug(`Server ${server.name} failed`);
                    }
                }
            }

            throw new Error('No working servers found');
        } catch (error) {
            this.logger.error(`Error getting HiAnime sources: ${error.message}`);
            // Return empty instead of throwing 500 to allow StreamingService to handle it (or show explicit error)
            throw new HttpException(`Failed to get sources: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    private async fetchSourceFromApi(id: string, server?: string, type: 'sub' | 'dub' = 'sub') {
        // Construct query parameters
        let url = `${this.baseUrl}/stream?id=${encodeURIComponent(id)}`;
        if (server) url += `&server=${encodeURIComponent(server)}`;
        // Only append type if server is specified, otherwise use default
        if (server && type) url += `&type=${type}`;

        try {
            const { data } = await axios.get(url);

            if (data.success && data.data) {
                const sources = [];
                // API returns 'link' object with file property
                const link = data.data.link;
                if (link && (link.file || link.directUrl)) {
                    sources.push({
                        url: link.directUrl || link.file,
                        isM3U8: link.type === 'hls',
                        quality: 'auto',
                    });
                }

                // Also check for 'sources' array
                if (data.data.sources && Array.isArray(data.data.sources)) {
                    data.data.sources.forEach((s: any) => {
                        sources.push({
                            url: s.url,
                            isM3U8: s.type === 'hls',
                            quality: 'auto',
                        });
                    });
                }

                if (sources.length > 0) {
                    return {
                        headers: { Referer: 'https://megacloud.tv' },
                        sources: sources,
                        subtitles: data.data.tracks?.map((track: any) => ({
                            url: track.file,
                            lang: track.label,
                            kind: track.kind
                        })) || []
                    };
                }
            }
        } catch (e) {
            // Ignore error here to allow retry loop
        }
        return { sources: [] };
    }
}
