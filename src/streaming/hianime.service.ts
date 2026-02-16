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
            // HiAnime API requires server parameter, default to HD-1 (Vidstreaming)
            // But we need to know available servers first?
            // The API /stream endpoint documentation says: /api/v1/stream?id={episodeId}&server={server}&type={type}
            // Default server is usually passed or we can try default.

            // Let's try getting sources. The API might return sources list or just one.
            // Based on previous test: /api/v1/stream?id=... returned data directly.

            const url = `${this.baseUrl}/stream?id=${encodeURIComponent(episodeId)}`;
            const { data } = await axios.get(url);

            if (data.success && data.data) {
                // Map to Consumet format
                return {
                    headers: { Referer: data.data.referer || '' }, // if provided
                    sources: data.data.sources.map((source: any) => ({
                        url: source.url,
                        isM3U8: source.type === 'hls',
                        quality: 'auto', // or extract from source
                    })),
                    subtitles: data.data.tracks?.map((track: any) => ({
                        url: track.file,
                        lang: track.label,
                        kind: track.kind
                    })) || []
                };
            }
            return { sources: [] };
        } catch (error) {
            this.logger.error(`Error getting HiAnime sources: ${error.message}`);
            throw new HttpException(`Failed to get sources: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
