import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy, VerifyCallback } from "passport-google-oauth20";

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
  constructor() {
    super({
      clientID: (process.env.GOOGLE_CLIENT_ID || 'missing').trim(),
      clientSecret: (process.env.GOOGLE_CLIENT_SECRET || 'missing').trim(),
      callbackURL: (process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/api/v1/auth/google/callback').trim(),
      scope: ["email", "profile"],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { name, emails, photos, id } = profile;
    const user = {
      email: emails[0].value,
      firstName: name.givenName,
      lastName: name.familyName,
      picture: photos[0].value,
      providerId: id,
      accessToken,
    };
    done(null, user);
  }
}
