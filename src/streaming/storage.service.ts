import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client | null = null;
  private bucket: string | null = null;
  private publicUrl: string | null = null;

  constructor(private configService: ConfigService) {
    const region = this.configService.get<string>("AWS_REGION");
    const endpoint = this.configService.get<string>("AWS_S3_ENDPOINT"); // For Cloudflare R2 or MinIO
    const accessKeyId = this.configService.get<string>("AWS_ACCESS_KEY_ID");
    const secretAccessKey = this.configService.get<string>(
      "AWS_SECRET_ACCESS_KEY",
    );
    this.bucket = this.configService.get<string>("AWS_S3_BUCKET");
    this.publicUrl = this.configService.get<string>("AWS_S3_PUBLIC_URL"); // Optional public CDN URL

    if (region && accessKeyId && secretAccessKey && this.bucket) {
      this.s3Client = new S3Client({
        region,
        endpoint,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        // Optional: force path style for some S3 compatible providers
        forcePathStyle: !!endpoint && endpoint.includes("localhost"),
      });
      this.logger.log(`Initialized S3 Client for bucket: ${this.bucket}`);
    } else {
      this.logger.warn(
        "S3/R2 credentials not fully provided. StorageService will be disabled.",
      );
    }
  }

  /**
   * Uploads a buffer or stream to S3.
   */
  async uploadFile(
    key: string,
    body: Buffer | any,
    contentType: string,
  ): Promise<string | null> {
    if (!this.s3Client || !this.bucket) return null;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Depending on your S3 provider, ACL may not be supported or required.
        // ACL: "public-read",
      });

      await this.s3Client.send(command);
      this.logger.debug(`Successfully uploaded to S3: ${key}`);
      return this.getFileUrl(key);
    } catch (error) {
      this.logger.error(`Error uploading file to S3 (${key}):`, error.message);
      return null;
    }
  }

  /**
   * Checks if a file exists in the bucket.
   */
  async fileExists(key: string): Promise<boolean> {
    if (!this.s3Client || !this.bucket) return false;

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      this.logger.error(`Error checking HeadObject for ${key}:`, error.message);
      return false;
    }
  }

  /**
   * Returns the URL for accessing the file.
   * If a public CDN URL is configured, it uses that.
   * Otherwise, generates a presigned URL or direct S3 URL.
   */
  async getFileUrl(key: string): Promise<string | null> {
    if (!this.s3Client || !this.bucket) return null;

    // Use a custom public CDN domain (e.g. Cloudflare)
    if (this.publicUrl) {
      return `${this.publicUrl}/${key}`;
    }

    // Default to a presigned URL if no public URL is provided
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const url = await getSignedUrl(this.s3Client, command, {
        expiresIn: 3600,
      });
      return url;
    } catch (error) {
      this.logger.error(`Error getting signed URL for ${key}:`, error.message);
      return null;
    }
  }

  isReady(): boolean {
    return this.s3Client !== null;
  }
}
