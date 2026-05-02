import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import axios from "axios";

async function run() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  await app.listen(3002);
  
  try {
    const res = await axios.get("http://localhost:3002/api/v1/streaming/proxy?url=https://example.com");
    console.log("Status without slash:", res.status);
  } catch (err: any) {
    console.log("Error Status without slash:", err.response?.status);
  }

  try {
    const res = await axios.get("http://localhost:3002/api/v1/streaming/proxy/https://example.com");
    console.log("Status with slash:", res.status);
  } catch (err: any) {
    console.log("Error Status with slash:", err.response?.status);
  }
  
  await app.close();
}

run().catch(console.error);
