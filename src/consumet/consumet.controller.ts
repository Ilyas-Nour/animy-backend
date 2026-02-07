import { Controller, Get, Query, Param, HttpException, HttpStatus, Req } from '@nestjs/common';
import { Request } from 'express';
import axios from 'axios';

@Controller('consumet')
export class ConsumetController {
    private readonly CONSUMET_API = 'https://api.consumet.org';

    /**
     * Proxy search requests to Consumet API
     * GET /api/v1/consumet/search?query=Naruto
     */
    @Get('search')
    async search(@Query('query') query: string) {
        if (!query) {
            throw new HttpException('Query is required', HttpStatus.BAD_REQUEST);
        }

        try {
            const url = `${this.CONSUMET_API}/anime/gogoanime/${encodeURIComponent(query)}`;
            const response = await axios.get(url);
            return response.data;
        } catch (error) {
            throw new HttpException('Failed to search anime', HttpStatus.BAD_GATEWAY);
        }
    }

    /**
     * Proxy info requests to Consumet API
     * GET /api/v1/consumet/info/naruto-dub
     */
    @Get('info/*')
    async getInfo(@Req() req: Request) {
        const animeId = req.params[0];
        if (!animeId) {
            throw new HttpException('Anime ID is required', HttpStatus.BAD_REQUEST);
        }

        try {
            const url = `${this.CONSUMET_API}/anime/gogoanime/info/${animeId}`;
            const response = await axios.get(url);
            return response.data;
        } catch (error) {
            throw new HttpException('Failed to get anime info', HttpStatus.BAD_GATEWAY);
        }
    }

    /**
     * Proxy watch requests to Consumet API
     * GET /api/v1/consumet/watch/naruto-dub-episode-1
     */
    @Get('watch/*')
    async getWatch(@Req() req: Request) {
        const episodeId = req.params[0];
        if (!episodeId) {
            throw new HttpException('Episode ID is required', HttpStatus.BAD_REQUEST);
        }

        try {
            const url = `${this.CONSUMET_API}/anime/gogoanime/watch/${episodeId}`;
            const response = await axios.get(url);
            return response.data;
        } catch (error) {
            throw new HttpException('Failed to get streaming links', HttpStatus.BAD_GATEWAY);
        }
    }
}
