import { Injectable, Logger, HttpStatus, HttpException } from "@nestjs/common";
import axios from "axios";
import { Response } from "express";

@Injectable()
export class StreamingProxyService {
  private readonly logger = new Logger(StreamingProxyService.name);

  /**
   * Proxies a request to a remote video source and pipes result to response
   * Rewrites manifest files to proxy chunks as well
   */
  async proxy(url: string, referer: string, res: Response) {
    try {
      const urlObj = new URL(url);
      const origin = `${urlObj.protocol}//${urlObj.host}`;

      const response = await axios.get(url, {
        headers: {
          Referer: referer || "https://hianime.to/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          Origin: referer ? new URL(referer).origin : origin,
          "Sec-Ch-Ua":
            '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
          "Sec-Ch-Ua-Mobile": "?0",
          "Sec-Ch-Ua-Platform": '"Windows"',
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "cross-site",
        },
        responseType: "stream",
        timeout: 10000,
      });

      // Forward relevant headers
      const rawContentType = response.headers["content-type"];
      const contentType = Array.isArray(rawContentType)
        ? rawContentType[0]
        : typeof rawContentType === "string"
          ? rawContentType
          : "application/octet-stream";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=3600");

      // If it's a manifest file, we might need to rewrite it
      if (
        contentType.includes("mpegurl") ||
        contentType.includes("application/vnd.apple.mpegurl") ||
        url.includes(".m3u8")
      ) {
        let manifestData = "";

        // We need to collect the data to rewrite it
        // Note: For very large manifests this could be heavy, but usually it's fine
        return new Promise((resolve, reject) => {
          response.data.on("data", (chunk: any) => {
            manifestData += chunk.toString();
          });

          response.data.on("end", () => {
            const rewrittenManifest = this.rewriteManifest(
              manifestData,
              url,
              referer,
            );
            res.send(rewrittenManifest);
            resolve(true);
          });

          response.data.on("error", (err: any) => {
            this.logger.error(`Stream error for ${url}: ${err.message}`);
            reject(err);
          });
        });
      }

      // For segments or other files, just pipe directly
      response.data.pipe(res);

      return new Promise((resolve, reject) => {
        response.data.on("end", () => resolve(true));
        response.data.on("error", (err: any) => reject(err));
      });
    } catch (error: any) {
      this.logger.error(`Proxy failure for ${url}: ${error.message}`);

      if (error.response) {
        throw new HttpException(
          `Remote server returned ${error.response.status}`,
          error.response.status,
        );
      }

      throw new HttpException(
        "Failed to proxy video source",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Rewrites URLs in M3U8 manifest to point back to our proxy
   */
  private rewriteManifest(
    content: string,
    originalUrl: string,
    referer: string,
  ): string {
    const urlObj = new URL(originalUrl);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf("/") + 1)}`;
    const origin = `${urlObj.protocol}//${urlObj.host}`;

    // Get our own proxy base URL (relative to where the request came from)
    // Hardcoding the relative structure for now or we can pass it
    const proxyPrefix = `/api/v1/streaming/proxy?referer=${encodeURIComponent(referer)}&url=`;

    return content
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();

        // Skip comments except URI attributes in tags
        if (trimmed.startsWith("#")) {
          // Rewrite URI="url" pattern in tags
          return line.replace(/URI="([^"]+)"/g, (match, p1) => {
            const absoluteUrl = this.resolveUrl(p1, baseUrl, origin);
            return `URI="${proxyPrefix}${encodeURIComponent(absoluteUrl)}"`;
          });
        }

        if (trimmed === "") return line;

        // It's a URL
        const absoluteUrl = this.resolveUrl(trimmed, baseUrl, origin);
        return `${proxyPrefix}${encodeURIComponent(absoluteUrl)}`;
      })
      .join("\n");
  }

  private resolveUrl(url: string, baseUrl: string, origin: string): string {
    if (url.startsWith("http")) return url;
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("/")) return `${origin}${url}`;
    return `${baseUrl}${url}`;
  }
}
