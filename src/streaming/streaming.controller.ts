import { Controller, Get, Param, Query, HttpException, HttpStatus, Req, Res, Logger } from '@nestjs/common';
import { StreamingService } from './streaming.service';
import { Response, Request } from 'express';

@Controller('streaming')
export class StreamingController {
    private readonly logger = new Logger(StreamingController.name);

    constructor(private readonly streamingService: StreamingService) { }

    /**
     * Get aggregated streaming links from the best available provider
     * GET /api/v1/streaming/aggregate?title=Solo%20Leveling&episode=1&preferredProvider=animepahe
     */
    @Get('aggregate')
    async getAggregatedLinks(
        @Query('title') title: string,
        @Query('episode') episode: string,
        @Query('titleEnglish') titleEnglish?: string,
        @Query('preferredProvider') preferredProvider?: string,
    ) {
        if (!title || !episode) {
            throw new HttpException('Title and episode number are required', HttpStatus.BAD_REQUEST);
        }
        return this.streamingService.getAggregatedLinks(title, parseInt(episode), titleEnglish, preferredProvider);
    }

    /**
     * Get aggregated anime info (episodes) across all providers
     * GET /api/v1/streaming/info/aggregate?title=Solo%20Leveling
     */
    @Get('info/aggregate')
    async getAggregatedInfo(
        @Query('title') title: string,
        @Query('titleEnglish') titleEnglish?: string,
    ) {
        if (!title) {
            throw new HttpException('Title is required', HttpStatus.BAD_REQUEST);
        }
        return this.streamingService.getAggregatedInfo(title, titleEnglish);
    }

    /**
     * Search for anime on streaming providers
     * GET /api/v1/streaming/search?query=naruto&provider=hianime
     */
    @Get('search')
    async searchAnime(
        @Query('query') query: string,
        @Query('provider') provider?: 'hianime' | 'animepahe' | 'animekai',
    ) {
        if (!query) {
            throw new HttpException('Query parameter is required', HttpStatus.BAD_REQUEST);
        }

        return this.streamingService.searchAnime(query, provider || 'hianime');
    }

    /**
     * Get anime info and episodes
     * GET /api/v1/streaming/anime/*?provider=hianime
     */
    @Get('anime/*')
    async getAnimeInfo(
        @Req() req: Request,
        @Query('provider') provider?: 'hianime' | 'animepahe' | 'animekai',
    ) {
        const fullId = req.params[0];
        if (!fullId) {
            throw new HttpException('Anime ID is required', HttpStatus.BAD_REQUEST);
        }
        return this.streamingService.getAnimeInfo(fullId, provider || 'hianime');
    }

    /**
     * Get streaming links for an episode
     * GET /api/v1/streaming/episode/:id?provider=hianime
     */
    @Get('episode/*')
    async getEpisodeLinks(
        @Req() req: Request,
        @Query('provider') provider?: 'hianime' | 'animepahe' | 'animekai',
    ) {
        // Extract the full path after 'episode/' to handle encoded slashes in IDs
        const fullId = req.params[0];

        this.logger.log(`EPISODE REQUEST: provider=${provider}, capturedId=${fullId}`);

        if (!fullId) {
            throw new HttpException('Episode ID is required', HttpStatus.BAD_REQUEST);
        }
        return this.streamingService.getEpisodeLinks(fullId, provider || 'hianime');
    }

    /**
     * Find anime by MAL title
     * GET /api/v1/streaming/find?title=Naruto&titleEnglish=Naruto
     */
    @Get('find')
    async findAnimeByTitle(
        @Query('title') title: string,
        @Query('titleEnglish') titleEnglish?: string,
    ) {
        if (!title) {
            throw new HttpException('Title parameter is required', HttpStatus.BAD_REQUEST);
        }

        return this.streamingService.findAnimeByTitle(title, titleEnglish);
    }

    /**
     * Proxy a streaming resource to bypass CORS
     * GET /api/v1/streaming/proxy?url=...&referer=...
     */
    @Get('proxy')
    async proxyStream(
        @Query('url') url: string,
        @Query('referer') referer: string,
        @Query('isSegment') isSegment: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        if (!url) {
            throw new HttpException('URL parameter is required', HttpStatus.BAD_REQUEST);
        }

        try {
            // Construct the base URL for the proxy so segments can point back to us
            const protocol = req.protocol;
            const host = req.get('host');
            // Use the absolute path to the proxy endpoint
            const proxyBaseUrl = `${protocol}://${host}/api/v1/streaming/proxy`;

            const { data, contentType } = await this.streamingService.proxyStream(
                url,
                referer,
                proxyBaseUrl,
                isSegment === 'true'
            );

            if (contentType) {
                res.setHeader('Content-Type', contentType);
            }

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.status(HttpStatus.OK).send(data);
        } catch (error) {
            res.status(HttpStatus.BAD_GATEWAY).send({ message: 'Proxy failed' });
        }
    }

    /**
     * Proxy an image to bypass Referer checks
     * GET /api/v1/streaming/proxy/image?url=...&provider=...
     */
    @Get('proxy/image')
    async proxyImage(
        @Query('url') url: string,
        @Query('provider') provider: string,
        @Res() res: Response,
    ) {
        if (!url) {
            throw new HttpException('URL parameter is required', HttpStatus.BAD_REQUEST);
        }

        try {
            const { data, contentType } = await this.streamingService.proxyImage(url, provider);

            if (contentType) {
                res.setHeader('Content-Type', contentType);
            }

            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.status(HttpStatus.OK).send(data);
        } catch (error) {
            res.status(HttpStatus.BAD_GATEWAY).send({ message: 'Image proxy failed' });
        }
    }
}
