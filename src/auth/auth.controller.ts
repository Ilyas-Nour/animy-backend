import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  Res,
  HttpStatus,
  Query,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { Public } from "../common/decorators/public.decorator";
import { UsersService } from "../users/users.service";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  // Direct Registration
  @Public()
  @Post("register")
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @Post("login")
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Get("verify")
  async verifyEmail(@Query("token") token: string) {
    return this.authService.verifyEmail(token);
  }

  @Public()
  @Post("resend-verification")
  async resendVerification(@Body("email") email: string) {
    return this.authService.resendVerification(email);
  }

  @Get("me")
  @UseGuards(AuthGuard("jwt"))
  async getProfile(@Req() req: Request) {
    const user: any = req.user;
    // req.user comes from JWT strategy, which might be stale.
    // Fetch fresh user data.
    const fullProfile: any = await this.usersService.findById(user.id);

    // Self-healing: If user has 0 XP and Level 1, try to recalculate
    if (fullProfile.level === 1 && fullProfile.xp === 0) {
      return this.usersService.recalculateXp(user.id);
    }

    return fullProfile;
  }

  @Public()
  @Get("google")
  @UseGuards(AuthGuard("google"))
  async googleAuth(@Req() req) {
    // Initiates the Google OAuth flow
  }

  @Public()
  @Get("google/callback")
  @UseGuards(AuthGuard("google"))
  async googleAuthRedirect(@Req() req, @Res() res: Response) {
    const { token, user } = await this.authService.googleLogin(req.user);
    
    // Determine frontend URL dynamically and trim any accidental whitespace/newlines
    const frontendUrl = process.env.FRONTEND_URL?.trim() || "https://animy.xyz";
    
    // Redirect to frontend with token
    return res.redirect(`${frontendUrl}/?token=${token}`);
  }
}
