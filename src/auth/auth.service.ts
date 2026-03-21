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
import { AuthProvider } from "@prisma/client";

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

  async validateUser(userId: string) {
    return this.usersService.findById(userId);
  }
}
