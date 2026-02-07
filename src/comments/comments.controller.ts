import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards, Req, Query } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('comments')
export class CommentsController {
    constructor(private readonly commentsService: CommentsService) { }

    @Post()
    @UseGuards(AuthGuard('jwt'))
    create(@Req() req: any, @Body() body: { providerId: string, content: string, parentId?: string }) {
        return this.commentsService.create(req.user.id, body);
    }

    @Patch(':id')
    @UseGuards(AuthGuard('jwt'))
    update(@Req() req: any, @Param('id') id: string, @Body('content') content: string) {
        return this.commentsService.update(id, req.user.id, content);
    }

    @Delete(':id')
    @UseGuards(AuthGuard('jwt'))
    remove(@Req() req: any, @Param('id') id: string) {
        return this.commentsService.remove(id, req.user.id);
    }

    @Get(':providerId')
    findAll(
        @Param('providerId') providerId: string,
        @Query('userId') userId?: string
    ) {
        return this.commentsService.findAll(providerId, userId);
    }
}
