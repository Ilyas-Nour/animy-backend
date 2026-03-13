import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class HiAnimeService {
    private readonly logger = new Logger(HiAnimeService.name);
    // Use multi-host failover to guarantee uptime. 
    private readonly apiHosts = [
        'https://aniwatch-api-net.vercel.app/api/v2/hianime',
        'https://hianime-api.vercel.app/anime'
    ];

    async search(query: string) {
        for (const host of this.apiHosts) {
            try {
                // v2 API format: /search?q={query}
                const url = `${host}/search?q=${encodeURIComponent(query)}`;
                const { data } = await axios.get(url, { timeout: 8000 });

                // V2 returns data.data.animes (or sometimes results depending on host version)
                const rawResults = data.data?.animes || data.data?.results || data.data?.response || [];

                if (rawResults.length > 0) {
                    return {
                        results: rawResults.map((item: any) => ({
                            id: item.id,
                            title: item.title || item.name,
                            image: item.poster || item.image,
                            url: `/anime/${item.id}`,
                        }))
                    };
                }
            } catch (error) {
                this.logger.debug(`Search failed on ${host}: ${error.message}`);
            }
        }
        return { results: [] };
    }

    async fetchAnimeInfo(id: string) {
        for (const host of this.apiHosts) {
            try {
                const url = `${host}/anime/${id}`;
                const { data } = await axios.get(url, { timeout: 8000 });

                if (data.success && data.data) {
                    // v2 returns data.anime.info
                    const info = data.data.anime?.info || data.data;

                    // Fetch episodes -> v2 is /anime/{id}/episodes or /episodes/{id} depending on the exact implementation fork
                    let episodesUrl = `${host}/anime/${id}/episodes`;
                    if (host.includes('hianime-api.')) episodesUrl = `${host}/episodes/${id}`;
                    
                    const episodesData = await axios.get(episodesUrl);

                    let episodes = [];
                    // v2 returns data.episodes
                    const rawEpisodes = episodesData.data.data?.episodes || episodesData.data.data || [];

                    if (Array.isArray(rawEpisodes)) {
                        episodes = rawEpisodes.map((ep: any) => ({
                            id: ep.episodeId || ep.id,
                            number: ep.number || ep.episodeNumber,
                            title: ep.title,
                            isFiller: ep.isFiller,
                            url: `/watch/${ep.episodeId || ep.id}`
                        }));
                    }

                    return {
                        id: info.id || id,
                        title: info.name || info.title,
                        image: info.poster || info.image,
                        description: info.description || info.synopsis,
                        episodes: episodes
                    };
                }
            } catch (error) {
                this.logger.debug(`Info fetch failed on ${host}: ${error.message}`);
            }
        }
        return null;
    }

    async fetchEpisodeSources(episodeId: string) {
        for (const host of this.apiHosts) {
            try {
                // 1. Try default 
                let sources = await this.fetchSourceFromApi(host, episodeId);
                if (sources.sources && sources.sources.length > 0) return sources;

                // 2. Fetch server list
                this.logger.warn(`Default server failed on ${host} for ${episodeId}, fetching server list...`);
                let serversUrl = `${host}/episode/servers?animeEpisodeId=${encodeURIComponent(episodeId)}`;
                if (host.includes('hianime-api.')) serversUrl = `${host}/servers?id=${encodeURIComponent(episodeId)}`;
                
                const { data: serverData } = await axios.get(serversUrl);

                if (serverData.success && serverData.data) {
                    const servers = [
                        ...(serverData.data.sub || []).map((s: any) => ({ ...s, type: 'sub' })),
                        ...(serverData.data.dub || []).map((s: any) => ({ ...s, type: 'dub' }))
                    ];

                    const candidates = servers.sort((a: any, b: any) => {
                        const nameA = a.serverName || a.name || "";
                        const nameB = b.serverName || b.name || "";
                        if (nameA.includes('HD-2') || nameA.includes('Vidstreaming')) return -1;
                        if (nameB.includes('HD-2') || nameB.includes('Vidstreaming')) return 1;
                        return 0;
                    });

                    for (const server of candidates) {
                        const sName = server.serverName || server.name;
                        if (!sName) continue;

                        try {
                            const result = await this.fetchSourceFromApi(host, episodeId, sName, server.type);
                            if (result.sources && result.sources.length > 0) return result;
                        } catch (e) {
                            // ignore and continue
                        }
                    }
                }
            } catch (error) {
                this.logger.debug(`Fetching sources failed on ${host}: ${error.message}`);
            }
        }
        throw new HttpException(`Failed to get sources from all providers`, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    private async fetchSourceFromApi(host: string, id: string, server?: string, type: 'sub' | 'dub' = 'sub') {
        let url = `${host}/episode/sources?animeEpisodeId=${encodeURIComponent(id)}`;
        if (host.includes('hianime-api.')) url = `${host}/stream?id=${encodeURIComponent(id)}`;
        
        if (server) url += `&server=${encodeURIComponent(server)}`;
        if (server && type) url += `&category=${type}&type=${type}`; // v2 uses category, v1 uses type

        try {
            const { data } = await axios.get(url, { timeout: 8000 });

            if (data.success && data.data) {
                const sources = [];
                const link = data.data.link;
                if (link && (link.file || link.directUrl)) {
                    sources.push({
                        url: link.directUrl || link.file,
                        isM3U8: link.type === 'hls' || link.isM3U8,
                        quality: 'auto',
                    });
                }

                if (data.data.sources && Array.isArray(data.data.sources)) {
                    data.data.sources.forEach((s: any) => {
                        sources.push({
                            url: s.url,
                            isM3U8: s.type === 'hls' || s.isM3U8,
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
            // ignore error in fetchSourceFromApi
        }
        return { sources: [] };
    }
}
