import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
  Post,
  Delete,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Request } from "express";
import { memoryStorage } from "multer";
import { extname } from "path";
import { UsersService } from "./users.service";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdatePasswordDto } from "./dto/update-password.dto";
import { AddToWatchlistDto } from "./dto/add-to-watchlist.dto";
import { UpdateWatchlistStatusDto } from "./dto/update-watchlist-status.dto";
import { AddToMangaListDto } from "./dto/add-to-manga-list.dto";
import { UpdateMangaStatusDto } from "./dto/update-manga-status.dto";
import { AddFavoriteCharacterDto } from "./dto/add-favorite-character.dto";
import { Public } from "../common/decorators/public.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @Get("profile")
  async getProfile(@Req() req: Request) {
    const user: any = req.user;
    const fullProfile: any = await this.usersService.findById(user.id);

    // Self-healing: If user has 0 XP and Level 1, try to recalculate
    if (fullProfile.level === 1 && fullProfile.xp === 0) {
      return this.usersService.recalculateXp(user.id);
    }

    return fullProfile;
  }

  @Post("daily-reward")
  async claimDailyReward(@Req() req: Request) {
    const user: any = req.user;
    return this.usersService.claimDailyReward(user.id);
  }

  @Patch("profile")
  async updateProfile(
    @Req() req: Request,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const user: any = req.user;
    return this.usersService.update(user.id, updateUserDto);
  }

  @Patch("password")
  async updatePassword(
    @Req() req: Request,
    @Body() updatePasswordDto: UpdatePasswordDto,
  ) {
    const user: any = req.user;
    return this.usersService.updatePassword(user.id, updatePasswordDto);
  }

  // Character Favorites (MUST come before favorites/:animeId to avoid route conflict)
  @Get("favorites/characters")
  async getFavoriteCharacters(@Req() req: Request) {
    const user: any = req.user;
    return this.usersService.getFavoriteCharacters(user.id);
  }

  @Post("favorites/characters")
  async addFavoriteCharacter(
    @Req() req: Request,
    @Body() dto: AddFavoriteCharacterDto,
  ) {
    const user: any = req.user;
    return this.usersService.addFavoriteCharacter(user.id, {
      characterId: dto.characterId,
      name: dto.name,
      imageUrl: dto.imageUrl,
      role: dto.role,
    });
  }

  @Delete("favorites/characters/:characterId")
  async removeFavoriteCharacter(
    @Req() req: Request,
    @Param("characterId") characterId: string,
  ) {
    const user: any = req.user;
    return this.usersService.removeFavoriteCharacter(
      user.id,
      parseInt(characterId, 10),
    );
  }

  // Manga Favorites (specific routes before parameterized)
  @Get("favorites/manga")
  async getFavoriteManga(@Req() req: Request) {
    const user: any = req.user;
    return this.usersService.getFavoriteManga(user.id);
  }

  @Post("favorites/manga/:mangaId")
  async addFavoriteManga(
    @Req() req: Request,
    @Param("mangaId") mangaId: string,
    @Body() body: { title: string; image?: string },
  ) {
    const user: any = req.user;
    return this.usersService.addFavoriteManga(
      user.id,
      parseInt(mangaId, 10),
      body.title,
      body.image,
    );
  }

  @Delete("favorites/manga/:mangaId")
  async removeFavoriteManga(
    @Req() req: Request,
    @Param("mangaId") mangaId: string,
  ) {
    const user: any = req.user;
    return this.usersService.removeFavoriteManga(
      user.id,
      parseInt(mangaId, 10),
    );
  }

  // Anime Favorites (general - comes last)
  @Get("favorites")
  async getFavorites(@Req() req: Request) {
    const user: any = req.user;
    return this.usersService.getFavorites(user.id);
  }

  @Post("favorites/:animeId")
  async addFavorite(
    @Req() req: Request,
    @Param("animeId") animeId: string,
    @Body() body: { title: string; image?: string },
  ) {
    const user: any = req.user;
    return this.usersService.addFavorite(
      user.id,
      parseInt(animeId, 10),
      body.title,
      body.image,
    );
  }

  @Delete("favorites/:animeId")
  async removeFavorite(@Req() req: Request, @Param("animeId") animeId: string) {
    const user: any = req.user;
    return this.usersService.removeFavorite(user.id, parseInt(animeId, 10));
  }

  // Watchlist
  @Get("watchlist")
  async getWatchlist(@Req() req: Request) {
    const user: any = req.user;
    return this.usersService.getWatchlist(user.id);
  }

  @Post("watchlist")
  async addToWatchlist(@Req() req: Request, @Body() dto: AddToWatchlistDto) {
    const user: any = req.user;
    return this.usersService.addToWatchlist(user.id, dto);
  }

  @Patch("watchlist/:animeId")
  async updateWatchlistStatus(
    @Req() req: Request,
    @Param("animeId") animeId: string,
    @Body() dto: UpdateWatchlistStatusDto,
  ) {
    const user: any = req.user;
    return this.usersService.updateWatchlistStatus(
      user.id,
      parseInt(animeId, 10),
      dto.status,
    );
  }

  @Delete("watchlist/:animeId")
  async removeFromWatchlist(
    @Req() req: Request,
    @Param("animeId") animeId: string,
  ) {
    const user: any = req.user;
    return this.usersService.removeFromWatchlist(
      user.id,
      parseInt(animeId, 10),
    );
  }

  // Manga List
  @Get("mangalist")
  async getMangaList(@Req() req: Request) {
    const user: any = req.user;
    return this.usersService.getMangaList(user.id);
  }

  @Post("mangalist")
  async addToMangaList(@Req() req: Request, @Body() dto: AddToMangaListDto) {
    const user: any = req.user;
    return this.usersService.addToMangaList(user.id, {
      mangaId: dto.mangaId,
      title: dto.title,
      image: dto.image,
      status: dto.status,
    });
  }

  @Patch("mangalist/:mangaId")
  async updateMangaListStatus(
    @Req() req: Request,
    @Param("mangaId") mangaId: string,
    @Body() dto: UpdateMangaStatusDto,
  ) {
    const user: any = req.user;
    return this.usersService.updateMangaListStatus(
      user.id,
      parseInt(mangaId, 10),
      dto.status,
    );
  }

  @Delete("mangalist/:mangaId")
  async removeFromMangaList(
    @Req() req: Request,
    @Param("mangaId") mangaId: string,
  ) {
    const user: any = req.user;
    return this.usersService.removeFromMangaList(
      user.id,
      parseInt(mangaId, 10),
    );
  }

  // Stats
  @Get("stats")
  async getStats(@Req() req: Request) {
    const user: any = req.user;
    return this.usersService.getStats(user.id);
  }

  @Get("badges")
  async getBadges(@Req() req: Request) {
    const user: any = req.user;
    return this.usersService.getBadges(user.id);
  }

  // Upload Avatar
  @Post("upload-avatar")
  @UseInterceptors(
    FileInterceptor("avatar", {
      storage: memoryStorage(),
      fileFilter: imageFileFilter,
      limits: { fileSize: 4 * 1024 * 1024 }, // 4MB
    }),
  )
  async uploadAvatar(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }
    const user: any = req.user;
    const ext = extname(file.originalname);
    const filename = `user-${user.id}-${Date.now()}${ext}`;
    return this.usersService.uploadAvatar(user.id, file.buffer, filename, file.mimetype);
  }

  // Upload Banner
  @Post("upload-banner")
  @UseInterceptors(
    FileInterceptor("banner", {
      storage: memoryStorage(),
      fileFilter: imageFileFilter,
      limits: { fileSize: 4 * 1024 * 1024 }, // 4MB
    }),
  )
  async uploadBanner(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }
    const user: any = req.user;
    const ext = extname(file.originalname);
    const filename = `user-${user.id}-${Date.now()}${ext}`;
    return this.usersService.uploadBanner(user.id, file.buffer, filename, file.mimetype);
  }
  // Leaderboard
  @Public()
  @Get("leaderboard")
  async getLeaderboard() {
    return this.usersService.getLeaderboard();
  }

  @Get("discovery/suggestions")
  async getSuggestions(@Req() req: Request) {
    const user: any = req.user;
    return this.usersService.getDiscoverySuggestions(user.id);
  }

  @Get("debug/interests")
  async debugInterests() {
    return this.usersService.debugAllUserInterests();
  }

  // Get User by ID (Public)
  @Public()
  @Get("id/:id")
  async getUserById(@Param("id") id: string) {
    const user: any = await this.usersService.findById(id);
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      firstName: user.firstName,
      lastName: user.lastName,
      level: user.level,
      rank: user.rank || "Initiate",
    };
  }

  // Public Profile with optional Auth (Moved to bottom to avoid intercepting specific routes)
  @Public()
  @Get(":username")
  async getPublicProfile(
    @Param("username") username: string,
    @Req() req: Request,
  ) {
    // Requires manual token checking if Public, or assume public view.
    return this.usersService.getUserProfile(
      (req["user"] as any)?.id || null,
      username,
    );
  }
}

// File filter helper - only allow images
function imageFileFilter(
  req: any,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  if (!file.originalname.match(/\.(jpg|jpeg|png|webp)$/i)) {
    return callback(
      new BadRequestException(
        "Only image files are allowed (jpg, jpeg, png, webp)",
      ),
      false,
    );
  }
  callback(null, true);
}
