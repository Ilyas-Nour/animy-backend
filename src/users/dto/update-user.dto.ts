import { IsString, IsOptional, IsEmail, IsArray, IsUrl, Matches } from "class-validator";

export class UpdateUserDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  bio?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  interests?: string[];

  // Social Links
  @IsOptional()
  @IsUrl({}, { message: 'Instagram must be a valid URL' })
  instagram?: string;

  @IsOptional()
  @IsUrl({}, { message: 'GitHub must be a valid URL' })
  github?: string;

  @IsOptional()
  @IsUrl({}, { message: 'LinkedIn must be a valid URL' })
  linkedin?: string;

  @IsOptional()
  @IsUrl({}, { message: 'TikTok must be a valid URL' })
  tiktok?: string;

  @IsOptional()
  @IsUrl({}, { message: 'WhatsApp must be a valid URL' })
  whatsapp?: string;

  @IsOptional()
  @IsUrl({}, { message: 'Facebook must be a valid URL' })
  facebook?: string;

  @IsOptional()
  @IsUrl({}, { message: 'Snapchat must be a valid URL' })
  snapchat?: string;
}
