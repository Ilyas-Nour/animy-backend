import { IsNumber, IsString, IsOptional } from "class-validator";

export class AddFavoriteCharacterDto {
  @IsNumber()
  characterId: number;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsString()
  @IsOptional()
  role?: string;
}
