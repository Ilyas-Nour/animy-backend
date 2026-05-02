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
  /**
   * Proxies a request to a remote video source and pipes result to response
   * Rewrites manifest files to proxy chunks as well
   * @param url The target URL to proxy
   * @param referer The referer to use for the upstream request
   * @param res The Express response object
   * @param req The Express request object
   * @param proxyBaseUrl The base URL of this proxy endpoint (for manifest rewriting)
   */
  async proxy(url: string, referer: string, res: Response, req?: any, proxyBaseUrl?: string) {
    try {
      const urlObj = new URL(url);
      const origin = `${urlObj.protocol}//${urlObj.host}`;

      // Default to hianime referer if none provided
      const finalReferer = referer || "https://hianime.to/";

      const headers: any = {
        Referer: finalReferer,
        "User-Agent":
          req?.headers?.["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: new URL(finalReferer).origin,
      };

      // Forward Range header if present (crucial for some players/CDNs)
      if (req?.headers?.range) {
        headers.Range = req.headers.range;
      }

      this.logger.debug(`Proxying: ${url} (Referer: ${finalReferer})`);

      const response = await axios.get(url, {
        headers,
        responseType: "stream",
        timeout: 20000,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 206,
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
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader("Cache-Control", "public, max-age=3600");

      if (response.headers["content-range"]) {
        res.setHeader("Content-Range", String(response.headers["content-range"]));
        res.status(HttpStatus.PARTIAL_CONTENT);
      }
      
      if (response.headers["content-length"] && !contentType.includes("mpegurl")) {
        res.setHeader("Content-Length", String(response.headers["content-length"]));
      }

      // If it's a manifest file, we MUST rewrite it to ensure segments are also proxied
      if (
        contentType.includes("mpegurl") ||
        contentType.includes("application/vnd.apple.mpegurl") ||
        url.includes(".m3u8")
      ) {
        let manifestData = "";

        return new Promise((resolve, reject) => {
          response.data.on("data", (chunk: any) => {
            manifestData += chunk.toString();
          });

          response.data.on("end", () => {
            try {
              const rewrittenManifest = this.rewriteManifest(
                manifestData,
                url,
                finalReferer,
                proxyBaseUrl,
              );
              res.send(rewrittenManifest);
              resolve(true);
            } catch (err) {
              this.logger.error(`Manifest rewrite error: ${err.message}`);
              res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(manifestData);
              resolve(false);
            }
          });

          response.data.on("error", (err: any) => {
            this.logger.error(`Manifest stream error for ${url}: ${err.message}`);
            if (!res.headersSent) res.status(HttpStatus.BAD_GATEWAY).end();
            reject(err);
          });
        });
      }

      // For segments or other files, pipe directly
      // Cleanup logic to prevent memory leaks and "write after end" errors
      const cleanup = () => {
        response.data.unpipe(res);
        response.data.destroy();
      };

      req?.on("close", cleanup);
      
      response.data.pipe(res);

      return new Promise((resolve, reject) => {
        response.data.on("end", () => {
          req?.off("close", cleanup);
          resolve(true);
        });
        response.data.on("error", (err: any) => {
          this.logger.error(`Pipe error for ${url}: ${err.message}`);
          req?.off("close", cleanup);
          if (!res.headersSent) res.status(HttpStatus.BAD_GATEWAY).end();
          reject(err);
        });
      });
    } catch (error: any) {
      this.logger.error(`Proxy failure for ${url}: ${error.message}`);

      if (!res.headersSent) {
        const status = error.response?.status || HttpStatus.BAD_GATEWAY;
        res.status(status).json({
          error: "Proxy error",
          message: error.message,
          url: url
        });
      }
    }
  }

  /**
   * Rewrites URLs in M3U8 manifest to point back to our proxy.
   * This ensures that every segment (.ts) or sub-playlist requested by the player
   * also carries the correct Referer and bypasses CORS.
   */
  private rewriteManifest(
    content: string,
    originalUrl: string,
    referer: string,
    proxyBaseUrl?: string,
  ): string {
    const urlObj = new URL(originalUrl);
    // Base URL of the manifest itself, used to resolve relative paths
    const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf("/") + 1)}`;
    const origin = `${urlObj.protocol}//${urlObj.host}`;

    // Use provided proxyBaseUrl or fallback to relative path
    const effectiveProxyBase = proxyBaseUrl || "/api/v1/streaming/proxy";
    const proxyPrefix = `${effectiveProxyBase}?referer=${encodeURIComponent(referer)}&url=`;

    return content
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();

        if (!trimmed) return line;

        // 1. Rewrite Tags with URI attributes (e.g. #EXT-X-KEY, #EXT-X-MEDIA)
        if (trimmed.startsWith("#")) {
          return line.replace(/URI=(['"])([^'"]+)(['"])/g, (match, quote, p2, endQuote) => {
            const absoluteUrl = this.resolveUrl(p2, baseUrl, origin);
            return `URI=${quote}${proxyPrefix}${encodeURIComponent(absoluteUrl)}${endQuote}`;
          }).replace(/URI=([^'",\s]+)/g, (match, p1) => {
            // Handle unquoted URIs (rare but possible)
            if (match.includes("URI=\"") || match.includes("URI='")) return match;
            const absoluteUrl = this.resolveUrl(p1, baseUrl, origin);
            return `URI="${proxyPrefix}${encodeURIComponent(absoluteUrl)}"`;
          });
        }

        // 2. Rewrite Segment URLs or Sub-playlist URLs
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
