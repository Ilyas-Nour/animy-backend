import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ANIME } from "@consumet/extensions";
import axios from "axios";

@Injectable()
export class ConsumetService {
  private readonly logger = new Logger(ConsumetService.name);

  private readonly animepahe = new ANIME.AnimePahe();
  private readonly kickass = new ANIME.KickAssAnime();
  private readonly animekai = new ANIME.AnimeKai();
  private readonly hianime = new ANIME.Hianime();

  constructor() {
    // Override base URLs to working 2026 domains
    (this.animepahe as any).baseUrl = "https://animepahe.ru";
    (this.kickass as any).baseUrl = "https://kaas.am";
    (this.animekai as any).baseUrl = "https://animekai.to";
    (this.hianime as any).baseUrl = "https://hianime.to";
  }

  /**
   * Resilience Search Mesh v10 — searches available providers
   */
  async search(query: string) {
    try {
      const normalizedQuery = this.normalizeTitle(query);
      this.logger.debug(
        `Searching consumet mesh: "${query}" (Normalized: "${normalizedQuery}")`,
      );

      const queries = [query];
      if (normalizedQuery !== query) queries.push(normalizedQuery);
      const results = await Promise.allSettled(
        queries.flatMap((q) => [
          // 1. AnimePahe (Strict 3.5s timeout)
          Promise.race([
            this.animepahe.search(q).then((res) =>
              (res.results || []).map((r: any) => ({
                ...r,
                provider: "animepahe",
              })),
            ),
            new Promise<any[]>((resolve) =>
              setTimeout(() => resolve([]), 3500),
            ),
          ]).catch(() => []),

          // 4. HiAnime (via Consumet)
          Promise.race([
            this.hianime.search(q).then((res) =>
              (res.results || []).map((r: any) => ({
                ...r,
                provider: "hianime",
              })),
            ),
            new Promise<any[]>((resolve) =>
              setTimeout(() => resolve([]), 3500),
            ),
          ]).catch(() => []),

          // 3. Anify (Fast & Stable)
          axios
            .get(`https://api.anify.tv/search/anime/${encodeURIComponent(q)}`, {
              timeout: 3000,
            })
            .then((res) =>
              (res.data || []).map((r: any) => ({
                id: r.id,
                title: r.title.english || r.title.romaji,
                image: r.coverImage,
                provider: "anify",
              })),
            )
            .catch(() => [] as any[]),
        ]),
      );

      const flattened = results
        .filter(
          (r): r is PromiseFulfilledResult<any[]> => r.status === "fulfilled",
        )
        .flatMap((r) => r.value);

      // Deduplicate by provider + id
      const unique = Array.from(
        new Map(
          flattened.map((item) => [`${item.provider}-${item.id}`, item]),
        ).values(),
      );

      this.logger.debug(
        `Search mesh found ${unique.length} results for "${query}"`,
      );
      return unique;
    } catch (error) {
      this.logger.error(`Search mesh failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Title Stripper: Removes colons and sub-titles for better search matching
   * Example: "Dr. STONE: SCIENCE FUTURE" -> "Dr. Stone"
   */
  private normalizeTitle(title: string): string {
    if (!title) return "";
    let normalized = title.split(":")[0]; // Remove subtitle
    normalized = normalized.split("-")[0]; // Remove dash subtitles
    normalized = normalized.split("Season")[0]; // Remove season tags
    return normalized.trim();
  }

  /**
   * Get Anime Info — races multiple providers for the fastest response
   */
  async getAnimeInfo(id: string) {
    try {
      this.logger.debug(`Fetching anime info for ID: ${id}`);

      // Race all providers for the fastest response
      return await Promise.any([
        this.animepahe.fetchAnimeInfo(id),
        this.hianime.fetchAnimeInfo(id),
        // Global safety timeout to prevent hanging the whole request
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("Global Info Timeout")), 8000),
        ),
      ]);
    } catch (error) {
      if (error.name === "AggregateError") {
        this.logger.warn(`All providers failed for anime info ${id}`);
        return null;
      }
      this.logger.warn(
        `Unified getAnimeInfo failed for ${id}: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Resolves episode number to a provider-specific episode ID
   */
  async resolveEpisodeId(
    animeId: string,
    episodeNum: number,
    provider: string = "animepahe",
  ): Promise<string | null> {
    try {
      this.logger.debug(
        `Resolving EP${episodeNum} for "${animeId}" on ${provider}`,
      );

      const info: any = await this.getAnimeInfo(animeId).catch(() => null);
      if (info?.episodes?.length) {
        const ep = info.episodes.find((e: any) => e.number === episodeNum);
        if (ep) return ep.id || ep.episodeId || null;
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get Episode Sources from a specific provider
   */
  async getEpisodeSources(episodeId: string, provider: string = "animepahe") {
    try {
      let targetProvider: any = this.animepahe;
      let referer = "https://animepahe.com/";

      if (provider === "hianime") {
        targetProvider = this.hianime;
        referer = "https://hianime.to/";
      }

      let sources: any = null;

      try {
        sources = await Promise.race([
          targetProvider.fetchEpisodeSources(episodeId),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), 15000),
          ),
        ]);
      } catch (e) {
        this.logger.warn(
          `Source extraction timeout on ${provider} for ${episodeId}`,
        );
        if (!sources) return null;
      }

      if (!sources || !sources.sources) return null;

      return {
        sources: sources.sources.map((s: any) => ({
          url: s.url,
          quality: s.quality || "default",
          isM3U8: s.url?.includes(".m3u8") ?? false,
        })),
        subtitles: sources.subtitles || [],
        headers: {
          Referer: referer,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
      };
    } catch (error) {
      this.logger.error(`Source fetch failed: ${error.message}`);
      return null;
    }
  }
}
