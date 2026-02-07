import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Always try to authenticate, even if public
    // The handleRequest method will determine if failure is allowed
    return super.canActivate(context);
  }

  handleRequest(err, user, info, context) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If verification succeeded, return user
    if (user) {
      return user;
    }

    // If verification failed but route is public, allow access (return null for user)
    if (isPublic) {
      return null;
    }

    // Otherwise throw error
    throw err || new UnauthorizedException();
  }
}
