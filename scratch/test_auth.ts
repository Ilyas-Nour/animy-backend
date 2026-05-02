import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";

async function testAuth() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const auth = app.get(AuthService);

  console.log("Testing Auth Service...");
  // Just check if we can reach it
  console.log("Auth Service found:", !!auth);

  await app.close();
}

testAuth().catch(console.error);
