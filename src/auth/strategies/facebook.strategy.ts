import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ConfigService } from "@nestjs/config";
import { Strategy, Profile } from "passport-facebook";
import { AuthProvider } from "@prisma/client";

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, "facebook") {
  constructor(private readonly configService: ConfigService) {
    super({
      clientID: configService.get<string>("oauth.facebook.appId"),
      clientSecret: configService.get<string>("oauth.facebook.appSecret"),
      callbackURL: configService.get<string>("oauth.facebook.callbackUrl"),
      scope: ["email"],
      profileFields: ["emails", "name", "picture"],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: (err: any, user: any, info?: any) => void,
  ): Promise<any> {
    const { name, emails, photos, id } = profile;

    const user = {
      email: emails[0].value,
      firstName: name.givenName,
      lastName: name.familyName,
      picture: photos[0].value,
      provider: AuthProvider.FACEBOOK,
      providerId: id,
    };

    done(null, user);
  }
}
