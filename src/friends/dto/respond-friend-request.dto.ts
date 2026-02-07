import { IsNotEmpty, IsString, IsUUID } from "class-validator";

export class RespondFriendRequestDto {
  @IsNotEmpty()
  @IsString()
  requestId: string;
}
