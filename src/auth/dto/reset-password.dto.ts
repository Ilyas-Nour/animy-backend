import { IsString, MinLength, Matches, IsOptional } from "class-validator";

export class ResetPasswordDto {
  @IsString({ message: "Invalid or missing reset token" })
  token: string;

  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters long" })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: "Password must contain uppercase, lowercase, and a number",
  })
  password: string;

  @IsString()
  @IsOptional()
  "cf-turnstile-response"?: string;
}
