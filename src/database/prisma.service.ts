import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    let url = process.env.DATABASE_URL;
    if (url && url.includes(':6543') && !url.includes('pgbouncer=true')) {
      url += (url.includes('?') ? '&' : '?') + 'pgbouncer=true';
    }

    super({
      log: ["error", "warn"],
      datasources: {
        db: {
          url: url,
        },
      },
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log("✅ Database connected successfully");
    } catch (error) {
      this.logger.error("❌ Database connection failed", error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log("Database disconnected");
  }

  async cleanDatabase() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Cannot clean database in production");
    }

    const models = Reflect.ownKeys(this).filter((key) => key[0] !== "_");

    return Promise.all(
      models.map((modelKey) => {
        return this[modelKey].deleteMany();
      }),
    );
  }
}
