import { Module, forwardRef } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { XpService } from "./xp.service";
import { FriendsModule } from "../friends/friends.module";
import { SupabaseService } from "../common/supabase.service";

@Module({
  imports: [forwardRef(() => FriendsModule)],
  controllers: [UsersController],
  providers: [UsersService, XpService, SupabaseService],
  exports: [UsersService, XpService],
})
export class UsersModule {}
