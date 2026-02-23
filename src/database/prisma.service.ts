import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import prisma from "./prisma-client";

@Injectable()
export class PrismaService
  implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  public readonly client = prisma;

  async onModuleInit() {
    try {
      await prisma.$connect();
      this.logger.log("✅ Database connected successfully (Singleton)");
    } catch (error) {
      this.logger.error("❌ Database connection failed", error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await prisma.$disconnect();
    this.logger.log("Database disconnected");
  }

  async cleanDatabase() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Cannot clean database in production");
    }

    const models = Reflect.ownKeys(prisma).filter((key) => key[0] !== "_");

    return Promise.all(
      models.map((modelKey) => {
        if (typeof prisma[modelKey]?.deleteMany === 'function') {
          return prisma[modelKey].deleteMany();
        }
        return Promise.resolve();
      }),
    );
  }
}
