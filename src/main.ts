import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestExpressApplication } from "@nestjs/platform-express";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Enable WebSocket support
  app.useWebSocketAdapter(new IoAdapter(app));

  // Security Headers
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  // Get config service
  const configService = app.get(ConfigService);
  const port = configService.get<number>("PORT") || 3001;
  const apiPrefix = configService.get<string>("API_PREFIX") || "api/v1";
  const frontendUrl =
    configService.get<string>("FRONTEND_URL") || "http://localhost:3000";

  // Create uploads directories if they don't exist
  // Use process.cwd() to consistently point to project root
  const uploadsDir = join(process.cwd(), "uploads");
  const avatarsDir = join(uploadsDir, "avatars");
  const bannersDir = join(uploadsDir, "banners");

  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir);
  if (!existsSync(avatarsDir)) mkdirSync(avatarsDir);
  if (!existsSync(bannersDir)) mkdirSync(bannersDir);

  // Serve static files from uploads directory
  app.useStaticAssets(uploadsDir, {
    prefix: "/uploads/",
    setHeaders: (res) => {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Cross-Origin-Resource-Policy", "cross-origin");
    },
  });

  // Global prefix
  app.setGlobalPrefix(apiPrefix);

  // CORS configuration
  app.enableCors({
    origin: [frontendUrl, "http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "Range",
      "Origin",
      "X-Requested-With",
      "Referer",
    ],
    exposedHeaders: [
      "Content-Range",
      "X-Content-Range",
      "Content-Type",
      "Content-Length",
    ],
  });

  // Global pipes for validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global filters
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(new TransformInterceptor());

  await app.listen(port);
  // console.log(`🚀 Application is running on: http://localhost:${port}/${apiPrefix}`);
}

bootstrap();
