import { IsEmail, IsOptional, IsString } from "class-validator";

export class ForgotPasswordDto {
  @IsEmail({}, { message: "Please enter a valid email address" })
  email: string;

  @IsString()
  @IsOptional()
  "cf-turnstile-response"?: string;
}
