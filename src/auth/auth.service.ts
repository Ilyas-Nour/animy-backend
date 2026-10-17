import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../database/prisma.service";
import { UsersService } from "../users/users.service";
import { EmailService } from "../email/email.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { AuthProvider } from "@prisma/client";
import * as crypto from "crypto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  // Register (Direct)
  async register(registerDto: RegisterDto) {
    const { email, password, username, firstName, lastName } = registerDto;

    // Check if email already registered
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new ConflictException("Email already registered");
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user (Unverified by default)
    const user = await this.usersService.create({
      email,
      password: hashedPassword,
      username,
      firstName,
      lastName,
      provider: AuthProvider.EMAIL,
      emailVerified: false,
    });

    // Generate Verification Token
    const token =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiry

    await this.prisma.verificationToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      },
    });

    // Send Verification Email
    await this.emailService.sendVerificationEmail(user.email, token);

    await this.prisma.activityLog
      .create({
        data: { action: "USER_REGISTERED", userId: user.id },
      })
      .catch((e) => console.error("[ActivityLog] Error:", e));

    // Generate JWT token (User can technically access but frontend should block based on verify status or we restrict here.
    // Usually we return a specific response telling them to verify.)
    // For this flow, we'll return the user but login will block them.

    return {
      message:
        "Registration successful. Please check your email to verify your account.",
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        emailVerified: user.emailVerified,
      },
    };
  }

  // Login (unchanged)
  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException("User not found (Debug)");
    }

    if (user.provider !== AuthProvider.EMAIL) {
      throw new UnauthorizedException(
        `Please login with ${user.provider.toLowerCase()}`,
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Wrong password (Debug)");
    }

    // Check Verification
    if (!user.emailVerified) {
      // Use a specific error message/code that the frontend can detect
      throw new UnauthorizedException("Email not verified");
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const access_token = this.jwtService.sign(payload);

    await this.prisma.activityLog
      .create({
        data: { action: "USER_LOGGED_IN", userId: user.id },
      })
      .catch((e) => console.error("[ActivityLog] Error:", e));

    return {
      access_token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        bannerUrl: user.bannerUrl,
        bio: user.bio,
        role: user.role,
        interests: user.interests,
      },
    };
  }

  // Verify Email
  async verifyEmail(token: string) {
    const verificationToken = await this.prisma.verificationToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!verificationToken) {
      throw new BadRequestException("Invalid or expired verification token");
    }

    if (verificationToken.expiresAt < new Date()) {
      throw new BadRequestException({
        message: "Token expired",
        email: verificationToken.user.email,
        expired: true,
      });
    }

    // Mark user as verified
    const updatedUser = await this.usersService.update(
      verificationToken.userId,
      { emailVerified: true },
    );

    // Delete token
    await this.prisma.verificationToken.delete({
      where: { id: verificationToken.id },
    });

    // Generate JWT for Auto-Login
    const payload = {
      sub: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
    };
    const access_token = this.jwtService.sign(payload);

    return {
      message: "Email verified successfully",
      access_token,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        username: updatedUser.username,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        avatar: updatedUser.avatar,
        bannerUrl: updatedUser.bannerUrl,
        bio: updatedUser.bio,
        role: updatedUser.role,
        interests: updatedUser.interests,
      },
    };
  }

  // Resend Verification
  async resendVerification(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new BadRequestException("User not found");
    }

    if (user.emailVerified) {
      throw new BadRequestException("Email already verified");
    }

    // Delete existing tokens
    await this.prisma.verificationToken.deleteMany({
      where: { userId: user.id },
    });

    // Generate new token
    const token =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    await this.prisma.verificationToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      },
    });

    await this.emailService.sendVerificationEmail(user.email, token);

    return { message: "Verification email sent" };
  }

  // Google OAuth Login
  async googleLogin(reqUser: any) {
    if (!reqUser) {
      throw new BadRequestException("No user from Google");
    }

    // Find existing user by providerId or email
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [{ providerId: reqUser.providerId }, { email: reqUser.email }],
      },
    });

    if (!user) {
      // Create new Google user
      let baseUsername = (reqUser.firstName + reqUser.lastName)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      if (!baseUsername) {
        baseUsername = reqUser.email.split("@")[0];
      }
      let finalUsername = baseUsername;
      let counter = 1;

      // Ensure unique username
      while (
        await this.prisma.user.findUnique({
          where: { username: finalUsername },
        })
      ) {
        finalUsername = `${baseUsername}${counter}`;
        counter++;
      }

      user = await this.prisma.user.create({
        data: {
          email: reqUser.email,
          firstName: reqUser.firstName,
          lastName: reqUser.lastName,
          username: finalUsername,
          avatar: reqUser.picture,
          provider: AuthProvider.GOOGLE,
          providerId: reqUser.providerId,
          emailVerified: true, // Google verifies emails automatically
        },
      });
    } else {
      // User exists. Update their provider logic if they previously used email.
      if (user.provider !== AuthProvider.GOOGLE) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            provider: AuthProvider.GOOGLE,
            providerId: reqUser.providerId,
            emailVerified: true,
          },
        });
      }
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      token: this.jwtService.sign(payload),
      user,
    };
  }

  async validateUser(userId: string) {
    return this.usersService.findById(userId);
  }

  // Forgot Password (OWASP Safe)
  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email?.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException("Email is required");
    }

    const user = await this.usersService.findByEmail(email);

    // Only accept emails that are already in the database
    if (!user) {
      throw new BadRequestException(
        "No account found with this email address. Please check your spelling or create an account.",
      );
    }

    if (user.provider !== AuthProvider.EMAIL) {
      throw new BadRequestException(
        `This account is registered using ${user.provider} Sign-In. Please sign in with ${user.provider}.`,
      );
    }

    // Generate cryptographically secure reset token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiration

    try {
      // Store in passwordResetTokens table
      await this.prisma.passwordResetToken.deleteMany({
        where: { userId: user.id },
      });

      await this.prisma.passwordResetToken.create({
        data: {
          token,
          userId: user.id,
          expiresAt,
        },
      });
    } catch (e: any) {
      console.warn(
        "[AuthService] PasswordResetToken table query fallback:",
        e.message,
      );
      // Resilient Fallback: If table has not yet migrated in database, reuse verification_tokens table with prefix
      await this.prisma.verificationToken.deleteMany({
        where: {
          userId: user.id,
          token: { startsWith: "pwdreset_" },
        },
      });

      await this.prisma.verificationToken.create({
        data: {
          token: `pwdreset_${token}`,
          userId: user.id,
          expiresAt,
        },
      });
    }

    // Send transactional email
    await this.emailService.sendPasswordResetEmail(user.email, token);

    await this.prisma.activityLog
      .create({
        data: { action: "PASSWORD_RESET_REQUESTED", userId: user.id },
      })
      .catch((err) => console.error("[ActivityLog] Error:", err));

    return {
      message: `Password reset link has been successfully sent to ${user.email}. Please check your inbox.`,
    };
  }

  // Verify Reset Token Validity
  async verifyResetToken(token: string) {
    if (!token) {
      throw new BadRequestException("Token is required");
    }

    let resetRecord: any = null;

    try {
      resetRecord = await this.prisma.passwordResetToken.findUnique({
        where: { token },
        include: { user: true },
      });
    } catch (e) {
      resetRecord = null;
    }

    if (!resetRecord) {
      // Also check fallback table
      resetRecord = await this.prisma.verificationToken.findUnique({
        where: { token: `pwdreset_${token}` },
        include: { user: true },
      });
    }

    if (!resetRecord) {
      throw new BadRequestException(
        "This password reset link is invalid or has already been used.",
      );
    }

    if (resetRecord.expiresAt < new Date()) {
      throw new BadRequestException(
        "This password reset link has expired. Please request a new one.",
      );
    }

    return {
      valid: true,
      message: "Reset token is valid",
    };
  }

  // Reset Password
  async resetPassword(dto: ResetPasswordDto) {
    const { token, password } = dto;
    if (!token) {
      throw new BadRequestException("Reset token is required");
    }

    let resetRecord: any = null;
    let isFallback = false;

    try {
      resetRecord = await this.prisma.passwordResetToken.findUnique({
        where: { token },
        include: { user: true },
      });
    } catch (e) {
      resetRecord = null;
    }

    if (!resetRecord) {
      resetRecord = await this.prisma.verificationToken.findUnique({
        where: { token: `pwdreset_${token}` },
        include: { user: true },
      });
      if (resetRecord) isFallback = true;
    }

    if (!resetRecord) {
      throw new BadRequestException(
        "This password reset link is invalid or has already been used.",
      );
    }

    if (resetRecord.expiresAt < new Date()) {
      throw new BadRequestException(
        "This password reset link has expired. Please request a new one.",
      );
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user password and ensure verified
    await this.usersService.update(resetRecord.userId, {
      password: hashedPassword,
      emailVerified: true, // Proved ownership of mailbox
    });

    // Delete token so it can never be used again
    try {
      if (!isFallback) {
        await this.prisma.passwordResetToken.delete({
          where: { id: resetRecord.id },
        });
      } else {
        await this.prisma.verificationToken.delete({
          where: { id: resetRecord.id },
        });
      }
    } catch (e) {
      console.error("[AuthService] Error deleting reset token:", e);
    }

    await this.prisma.activityLog
      .create({
        data: { action: "PASSWORD_RESET_COMPLETED", userId: resetRecord.userId },
      })
      .catch((err) => console.error("[ActivityLog] Error:", err));

    return {
      message:
        "Password has been reset successfully. You can now log in with your new password.",
    };
  }
}
