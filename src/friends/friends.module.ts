import { Module, forwardRef } from "@nestjs/common";
import { FriendsController } from "./friends.controller";
import { FriendsService } from "./friends.service";
import { DatabaseModule } from "../database/database.module";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [DatabaseModule, forwardRef(() => UsersModule)],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
