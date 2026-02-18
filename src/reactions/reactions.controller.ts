import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ReactionsService } from './reactions.service';
import { AuthGuard } from '@nestjs/passport';
@Controller('reactions')
export class ReactionsController {
    constructor(private readonly reactionsService: ReactionsService) { }

    @Post()
    @UseGuards(AuthGuard('jwt'))
    toggle(@Req() req: any, @Body() body: { type: string, providerId?: string, commentId?: string }) {
        return this.reactionsService.toggleReaction(req.user.id, body);
    }
}
