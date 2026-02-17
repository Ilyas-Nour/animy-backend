import { Controller, Get, Param, Query, HttpException, HttpStatus, Req, Logger } from '@nestjs/common';
import { StreamingService } from './streaming.service';
import { Request } from 'express';

@Controller('streaming')
export class StreamingController {
    private readonly logger = new Logger(StreamingController.name);

    constructor(private readonly streamingService: StreamingService) { }

    /**
     * Search for anime on HiAnime
     * GET /api/v1/streaming/search?query=naruto
     */
    @Get('search')
    async searchAnime(
        @Query('query') query: string,
    ) {
        if (!query) {
            throw new HttpException('Query parameter is required', HttpStatus.BAD_REQUEST);
        }

        return this.streamingService.searchAnime(query);
    }

    /**
     * Get anime info and episodes from HiAnime
     * GET /api/v1/streaming/anime/*
     */
    @Get('anime/*')
    async getAnimeInfo(
        @Req() req: Request,
    ) {
        const fullId = req.params[0];
        if (!fullId) {
            throw new HttpException('Anime ID is required', HttpStatus.BAD_REQUEST);
        }
        return this.streamingService.getAnimeInfo(fullId);
    }

    /**
     * Get streaming links for an episode from HiAnime
     * GET /api/v1/streaming/episode/*
     */
    @Get('episode/*')
    async getEpisodeLinks(
        @Req() req: Request,
    ) {
        // Extract the full path after 'episode/' to handle encoded slashes in IDs
        const fullId = req.params[0];

        if (!fullId) {
            throw new HttpException('Episode ID is required', HttpStatus.BAD_REQUEST);
        }

        // We're bypassing the local proxy for now as direct links are more reliable
        // but keeping the hook if we need it later.
        return this.streamingService.getEpisodeLinks(fullId);
    }

    /**
     * Find anime by MAL title (from AniList)
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
}
