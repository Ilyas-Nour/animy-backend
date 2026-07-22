import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import axios from "axios";

interface WitanimeServer {
  name: string;
  url: string;
}

interface ExtractedStream {
  provider: string;
  embedUrl: string;
  streamUrl?: string;
  referer?: string;
  isNative: boolean;
  quality?: string;
}

/**
 * WitanimeExtractorService
 *
 * Fetches episode server list from Witanime's hidden WordPress REST API.
 * Prioritizes providers whose embed pages expose a raw .m3u8 in HTML
 * (e.g. Dailymotion via public API, StreamWish via JSON blob).
 * Falls back to returning the embed URL for client-side rendering in an iframe.
 */
@Injectable()
export class WitanimeExtractorService {
  private readonly logger = new Logger(WitanimeExtractorService.name);
  private readonly BASE = "https://witanime.you";

  constructor(private readonly prisma: PrismaService) {}

  // Cached WP REST route paths (discovered once per process lifetime)
  private episodeListRoute: string | null = null;
  private episodeDetailRoute: string | null = null;
  private routeDiscoveredAt = 0;
  private readonly ROUTE_TTL_MS = 3_600_000; // 1 hour

  private readonly HEADERS = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
  };

  // ─── Route Discovery ─────────────────────────────────────────────────────────

  private async discoverRoutes(): Promise<void> {
    if (
      this.episodeListRoute &&
      this.episodeDetailRoute &&
      Date.now() - this.routeDiscoveredAt < this.ROUTE_TTL_MS
    )
      return;

    try {
      const { data } = await axios.get(`${this.BASE}/wp-json`, {
        timeout: 5000,
        headers: this.HEADERS,
      });

      const routes: string[] = Object.keys(data?.routes || {});

      const listRoute = routes.find((r) => r.includes("anime-episodes"));
      if (listRoute) {
        this.episodeListRoute = listRoute.split("(?P<")[0];
      }

      const detailRoute = routes.find((r) => r.includes("episode/(?P<"));
      if (detailRoute) {
        this.episodeDetailRoute = detailRoute.split("(?P<")[0];
      }

      this.routeDiscoveredAt = Date.now();
      this.logger.debug(
        `Witanime routes discovered: list=${this.episodeListRoute} detail=${this.episodeDetailRoute}`,
      );
    } catch (e) {
      this.logger.warn(`Route discovery failed: ${e.message}. Using defaults.`);
      this.episodeListRoute = "/custom-api/v1/anime-episodes/green/blue/ldu/";
      this.episodeDetailRoute =
        "/custom-api/blue/ldo/frum/chd/not/loaded/v1/episode/";
    }
  }

  // ─── Anime Search ─────────────────────────────────────────────────────────────

  private normalizeTitle(title: string): string {
    if (!title) return "";
    let normalized = title.split(":")[0]; // Remove subtitle
    normalized = normalized.split("-")[0]; // Remove dash subtitles
    normalized = normalized.split("Season")[0]; // Remove season tags
    normalized = normalized.split("Part")[0]; // Remove part tags
    return normalized.trim();
  }

  async searchAnime(
    query: string,
  ): Promise<{ id: number; name: string; slug: string }[]> {
    try {
      const { data } = await axios.get(
        `${this.BASE}/wp-json/custom-api/v1/search-anime?search=${encodeURIComponent(query)}`,
        { timeout: 5000, headers: this.HEADERS },
      );
      return Array.isArray(data) ? data : [];
    } catch (e) {
      this.logger.warn(`Witanime search failed: ${e.message}`);
      return [];
    }
  }

  // ─── Episode ID Resolution ───────────────────────────────────────────────────

  async getEpisodePostIds(slug: string): Promise<number[]> {
    await this.discoverRoutes();
    const route =
      this.episodeListRoute || "/custom-api/v1/anime-episodes/green/blue/ldu/";
    try {
      const { data } = await axios.get(`${this.BASE}/wp-json${route}${slug}`, {
        timeout: 6000,
        headers: this.HEADERS,
      });
      return Array.isArray(data) ? data : [];
    } catch (e) {
      this.logger.warn(`Episode ID list failed for ${slug}: ${e.message}`);
      return [];
    }
  }

  // ─── Episode Meta ─────────────────────────────────────────────────────────────

  async getEpisodeMeta(postId: number): Promise<any> {
    await this.discoverRoutes();
    const route =
      this.episodeDetailRoute ||
      "/custom-api/blue/ldo/frum/chd/not/loaded/v1/episode/";
    try {
      const { data } = await axios.get(
        `${this.BASE}/wp-json${route}${postId}`,
        {
          timeout: 6000,
          headers: this.HEADERS,
        },
      );
      return data;
    } catch (e) {
      this.logger.warn(`Episode meta failed for ${postId}: ${e.message}`);
      return null;
    }
  }

  // ─── Binary Search for Episode ────────────────────────────────────────────────

  private async findEpisodePostId(
    postIds: number[],
    targetEpNum: number,
  ): Promise<number | null> {
    if (!postIds.length) return null;

    // Fast path: check expected index
    const expectedIdx = targetEpNum - 1;
    if (expectedIdx >= 0 && expectedIdx < postIds.length) {
      const meta = await this.getEpisodeMeta(postIds[expectedIdx]);
      if (Number(meta?.meta?.episode_number) === targetEpNum) {
        return postIds[expectedIdx];
      }
    }

    // Binary search fallback
    let left = 0;
    let right = postIds.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const meta = await this.getEpisodeMeta(postIds[mid]);
      const currentNum = Number(meta?.meta?.episode_number);

      if (currentNum === targetEpNum) return postIds[mid];
      if (currentNum < targetEpNum) left = mid + 1;
      else right = mid - 1;
    }

    return null;
  }

  // ─── Dailymotion Native .m3u8 Extraction ─────────────────────────────────────

  private async extractDailymotionStream(url: string): Promise<string | null> {
    try {
      // Extract video ID from embed URL
      const match = url.match(/\/embed\/video\/([a-zA-Z0-9]+)/);
      if (!match) return null;
      const videoId = match[1];

      const apiUrl = `https://www.dailymotion.com/player/metadata/video/${videoId}?embedder=https%3A%2F%2Fwitanime.you%2F&locale=en&dmV1st=&dmTs=&is_iab_vast=1&app=sirius-v6801`;
      const { data } = await axios.get(apiUrl, {
        timeout: 6000,
        headers: {
          ...this.HEADERS,
          Referer: "https://witanime.you/",
          Origin: "https://witanime.you",
        },
      });

      // Prefer auto/h264 m3u8
      const qualities = data?.qualities;
      if (qualities) {
        const auto =
          qualities["auto"] ||
          qualities["1080"] ||
          qualities["720"] ||
          qualities["480"];
        if (auto && auto[0] && auto[0].url) {
          return auto[0].url;
        }
      }

      // Fallback: look for m3u8 in any URL
      const allUrls: string[] = [];
      if (qualities) {
        Object.values(qualities).forEach((q: any) => {
          if (Array.isArray(q)) {
            q.forEach((item: any) => {
              if (item.url && item.url.includes(".m3u8"))
                allUrls.push(item.url);
            });
          }
        });
      }
      return allUrls[0] || null;
    } catch (e) {
      this.logger.warn(`Dailymotion extraction failed: ${e.message}`);
      return null;
    }
  }

  // ─── StreamWish .m3u8 Extraction ─────────────────────────────────────────────

  private async extractStreamWishStream(url: string): Promise<string | null> {
    try {
      const resp = await axios.get(url, {
        timeout: 8000,
        headers: {
          ...this.HEADERS,
          Referer: "https://witanime.you/",
        },
        maxRedirects: 5,
      });
      const html: string = resp.data;

      // StreamWish embeds its m3u8 in a packed/obfuscated script
      // Pattern 1: jwplayer sources array
      const jwMatch = html.match(
        /"file"\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/,
      );
      if (jwMatch) return jwMatch[1];

      // Pattern 2: direct .m3u8 URL in script
      const m3u8Match = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/);
      if (m3u8Match) return m3u8Match[1];

      // Pattern 3: sources: [{file: "..."}]
      const srcMatch = html.match(
        /sources\s*:\s*\[\s*\{\s*file\s*:\s*"([^"]+)"/,
      );
      if (srcMatch) return srcMatch[1];

      return null;
    } catch (e) {
      this.logger.warn(`StreamWish extraction failed: ${e.message}`);
      return null;
    }
  }

  // ─── Witanime Slug Resolution (AniList ID → slug) ─────────────────────────────

  /**
   * Resolves an AniList ID to a Witanime anime slug.
   * 1. Checks DB cache (AnimeMapping.witanimeSlug)
   * 2. Queries MAL-Sync for canonical title
   * 3. Searches Witanime with canonical title (then fallback title)
   * 4. Caches the discovered slug for future requests
   */
  private async resolveWitanimeSlug(
    anilistId: number,
    fallbackTitle?: string,
  ): Promise<{ slug: string; name: string } | null> {
    // 1. Check DB cache
    try {
      // Temporarily disabled until production database schema is migrated
      // const cached = await this.prisma.animeMapping.findUnique({
      //   where: { id: anilistId },
      // });
      // if (cached?.witanimeSlug) {
      //   this.logger.debug(`Witanime CACHE HIT: AL ${anilistId} → slug "${cached.witanimeSlug}"`);
      //   return { slug: cached.witanimeSlug, name: cached.witanimeSlug };
      // }
    } catch (e) {
      // DB miss or error, continue to live resolution
    }

    // 2. Query MAL-Sync for canonical title
    let canonicalTitle: string | null = null;
    try {
      const malsyncRes = await axios.get(
        `https://api.malsync.moe/mal/anime/anilist:${anilistId}`,
        { timeout: 4000 },
      );
      canonicalTitle = malsyncRes.data?.title || null;
      this.logger.debug(
        `MAL-Sync canonical title for AL ${anilistId}: "${canonicalTitle}"`,
      );
    } catch (e) {
      this.logger.debug(
        `MAL-Sync lookup failed for AL ${anilistId}: ${e.message}`,
      );
    }

    // 3. Build search queries: canonical title first, then fallback, then normalized variants
    const queries: string[] = [];
    if (canonicalTitle) queries.push(canonicalTitle);
    if (fallbackTitle && fallbackTitle !== canonicalTitle)
      queries.push(fallbackTitle);
    // Add normalized variants
    for (const q of [...queries]) {
      const normalized = this.normalizeTitle(q);
      if (normalized && !queries.includes(normalized)) queries.push(normalized);
    }

    // 4. Search Witanime with each query
    for (const query of queries) {
      const results = await this.searchAnime(query);
      if (results.length > 0) {
        const match = results[0];
        this.logger.log(
          `Witanime slug resolved: AL ${anilistId} → "${match.slug}" (via search: "${query}")`,
        );

        // 5. Cache the slug in DB
        try {
          // Temporarily disabled until production database schema is migrated
          // await this.prisma.animeMapping.upsert({
          //   where: { id: anilistId },
          //   update: { witanimeSlug: match.slug, lastChecked: new Date() },
          //   create: { id: anilistId, witanimeSlug: match.slug },
          // });
        } catch (e) {
          this.logger.warn(
            `Failed to cache Witanime slug for AL ${anilistId}: ${e.message}`,
          );
        }

        return { slug: match.slug, name: match.name };
      }
    }

    this.logger.warn(
      `Witanime slug resolution FAILED for AL ${anilistId} (tried: ${queries.join(", ")})`,
    );
    return null;
  }

  // ─── Main Orchestrator (AniList ID aware) ─────────────────────────────────────

  /**
   * Primary extraction method — resolves AniList ID to Witanime slug via
   * MAL-Sync enrichment + DB caching, then extracts episode streams.
   * Falls back to title-based search if ID resolution fails.
   */
  async extractEpisodeStreamsByAnilistId(
    anilistId: number,
    episodeNumber: number,
    fallbackTitle?: string,
  ): Promise<ExtractedStream[]> {
    // Try ID-based resolution first
    if (!isNaN(anilistId) && anilistId > 0) {
      const resolved = await this.resolveWitanimeSlug(anilistId, fallbackTitle);
      if (resolved) {
        return this.extractEpisodeStreamsBySlug(resolved.slug, episodeNumber);
      }
    }

    // Fallback to title-based search if ID resolution failed
    if (fallbackTitle) {
      this.logger.debug(
        `Witanime: falling back to title-based search for "${fallbackTitle}"`,
      );
      return this.extractEpisodeStreams(fallbackTitle, episodeNumber);
    }

    return [];
  }

  /**
   * Extracts streaming sources given a known Witanime slug + episode number.
   * Skips the search step entirely — goes straight to episode resolution.
   */
  private async extractEpisodeStreamsBySlug(
    slug: string,
    episodeNumber: number,
  ): Promise<ExtractedStream[]> {
    const results: ExtractedStream[] = [];

    try {
      this.logger.debug(
        `Witanime slug extraction: "${slug}" EP${episodeNumber}`,
      );

      // Get episode post IDs
      const postIds = await this.getEpisodePostIds(slug);
      if (!postIds.length) {
        this.logger.warn(`Witanime: no episodes found for slug "${slug}"`);
        return [];
      }

      // Find the correct episode via binary search
      const postId = await this.findEpisodePostId(postIds, episodeNumber);
      if (!postId) {
        this.logger.warn(
          `Witanime: ep ${episodeNumber} not found in "${slug}"`,
        );
        return [];
      }

      // Get episode meta (server list)
      const meta = await this.getEpisodeMeta(postId);
      const servers: WitanimeServer[] = meta?.meta?.servers || [];

      this.logger.debug(
        `Witanime: ${servers.length} servers for slug "${slug}" EP${episodeNumber}`,
      );

      // Process servers (reuse existing extraction logic)
      return this.processServers(servers);
    } catch (e) {
      this.logger.error(`Witanime slug extraction failed: ${e.message}`);
    }

    return results;
  }

  /**
   * Processes a list of Witanime servers, extracting native .m3u8 where possible.
   */
  private async processServers(
    servers: WitanimeServer[],
  ): Promise<ExtractedStream[]> {
    const results: ExtractedStream[] = [];

    for (const server of servers) {
      const name = server.name?.toLowerCase() || "";
      const url = server.url;

      if (!url) continue;

      // --- Dailymotion: Use public metadata API to get .m3u8
      if (name.includes("dailymotion") || url.includes("dailymotion.com")) {
        const streamUrl = await this.extractDailymotionStream(url);
        if (streamUrl) {
          results.push({
            provider: "witanime-dailymotion",
            embedUrl: url,
            streamUrl,
            referer: "https://witanime.you/",
            isNative: true,
            quality: name.includes("fhd") ? "1080p" : "720p",
          });
          continue;
        }
      }

      // --- StreamWish: Try to extract .m3u8 from embed HTML
      if (
        name.includes("streamwish") ||
        url.includes("hgcloud.to") ||
        url.includes("streamwish")
      ) {
        const streamUrl = await this.extractStreamWishStream(url);
        if (streamUrl) {
          results.push({
            provider: "witanime-streamwish",
            embedUrl: url,
            streamUrl,
            referer: "https://witanime.you/",
            isNative: true,
            quality: name.includes("fhd") ? "1080p" : "720p",
          });
          continue;
        }
      }

      // --- All others: Return as embeddable iframe
      results.push({
        provider: `witanime-${name.split(" ")[0]}`,
        embedUrl: url,
        isNative: false,
        quality: name.includes("fhd")
          ? "1080p"
          : name.includes("multi")
            ? "multi"
            : "720p",
      });
    }

    return results;
  }

  // ─── Legacy Main Orchestrator (title-based) ───────────────────────────────────

  /**
   * Extracts streaming sources for a given anime title + episode number.
   * This is the legacy method — prefer extractEpisodeStreamsByAnilistId().
   *
   * Returns an array of server objects compatible with the streaming service format.
   * Native servers (with .m3u8) are returned with isNative=true.
   * Embed-only servers are returned with isNative=false (rendered as iframe in player).
   */
  async extractEpisodeStreams(
    animeTitle: string,
    episodeNumber: number,
  ): Promise<ExtractedStream[]> {
    const results: ExtractedStream[] = [];

    try {
      // 1. Search for the anime on Witanime
      let searchResults = await this.searchAnime(animeTitle);

      // Fallback to normalized title if exact title yields no results
      if (!searchResults.length) {
        const normalized = this.normalizeTitle(animeTitle);
        if (normalized && normalized !== animeTitle) {
          this.logger.debug(
            `Witanime: falling back to normalized title "${normalized}"`,
          );
          searchResults = await this.searchAnime(normalized);
        }
      }

      if (!searchResults.length) {
        this.logger.warn(`Witanime: no results for "${animeTitle}"`);
        return [];
      }

      const anime = searchResults[0];
      this.logger.debug(
        `Witanime: found "${anime.name}" (slug: ${anime.slug})`,
      );

      // 2. Get episode post IDs
      const postIds = await this.getEpisodePostIds(anime.slug);
      if (!postIds.length) return [];

      // 3. Find the correct episode via binary search
      const postId = await this.findEpisodePostId(postIds, episodeNumber);
      if (!postId) {
        this.logger.warn(
          `Witanime: ep ${episodeNumber} not found in ${anime.slug}`,
        );
        return [];
      }

      // 4. Get episode meta (server list)
      const meta = await this.getEpisodeMeta(postId);
      const servers: WitanimeServer[] = meta?.meta?.servers || [];

      this.logger.debug(
        `Witanime: ${servers.length} servers for EP${episodeNumber}`,
      );

      // 5. Process each server using shared extraction logic
      const extracted = await this.processServers(servers);
      results.push(...extracted);

      this.logger.log(
        `Witanime extraction complete: ${results.filter((r) => r.isNative).length} native, ${results.filter((r) => !r.isNative).length} embed servers`,
      );
    } catch (e) {
      this.logger.error(`Witanime extraction failed: ${e.message}`);
    }

    return results;
  }
}
