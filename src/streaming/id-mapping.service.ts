import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import axios from 'axios';

@Injectable()
export class IdMappingService {
  private readonly logger = new Logger(IdMappingService.name);

  // HiAnime API hosts in order of preference
  private readonly hiAnimeHosts = [
    'https://aniwatch-api-net.vercel.app/api/v2/hianime',
    'https://hianime-api.vercel.app/anime',
  ];

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves an AniList anime ID to a HiAnime provider ID.
   * Checks the DB first, then falls back to title-similarity search.
   */
  async resolveHiAnimeId(
    anilistId: number,
    title: string,
    titleEnglish?: string,
  ): Promise<string | null> {
    // Check DB cache
    const cached = await this.prisma.animeMapping.findUnique({
      where: { id: anilistId },
    });

    if (cached?.hiAnimeId) {
      this.logger.debug(`DB HIT: AniList ${anilistId} -> HiAnime ${cached.hiAnimeId}`);
      return cached.hiAnimeId;
    }

    this.logger.debug(`DB MISS: Searching HiAnime for AniList ${anilistId} (${title})`);

    // Try primary title then English fallback
    const titlesToTry = [title, titleEnglish].filter(Boolean) as string[];

    for (const searchTitle of titlesToTry) {
      const match = await this.searchHiAnime(searchTitle, title);
      if (match) {
        await this.saveHiAnimeMapping(anilistId, match);
        return match;
      }
    }

    this.logger.warn(`No HiAnime match found for AniList ${anilistId}`);
    return null;
  }

  /**
   * Resolves an AniList manga ID to a MangaDex UUID.
   * Checks the DB first, then falls back to MangaDex title search.
   */
  async resolveMangaDexId(
    anilistId: number,
    title: string,
  ): Promise<string | null> {
    const cached = await this.prisma.animeMapping.findUnique({
      where: { id: anilistId },
    });

    if (cached?.mangaDexId) {
      this.logger.debug(`DB HIT: AniList ${anilistId} -> MangaDex ${cached.mangaDexId}`);
      return cached.mangaDexId;
    }

    this.logger.debug(`DB MISS: Searching MangaDex for AniList ${anilistId} (${title})`);

    const mangaDexId = await this.searchMangaDex(title);
    if (mangaDexId) {
      await this.saveMangaDexMapping(anilistId, mangaDexId);
    }

    return mangaDexId;
  }

  /**
   * Saves (or updates) a HiAnime ID mapping for a given AniList ID.
   */
  async saveHiAnimeMapping(anilistId: number, hiAnimeId: string): Promise<void> {
    try {
      await this.prisma.animeMapping.upsert({
        where: { id: anilistId },
        update: { hiAnimeId, lastChecked: new Date() },
        create: { id: anilistId, hiAnimeId },
      });
      this.logger.debug(`Saved mapping: AniList ${anilistId} -> HiAnime ${hiAnimeId}`);
    } catch (e) {
      this.logger.error(`Failed to save HiAnime mapping for ${anilistId}: ${e.message}`);
    }
  }

  /**
   * Resolves an AniList ID to a MyAnimeList ID.
   * Uses local cache first, then falls back to MALSync API.
   */
  async getMalId(anilistId: number): Promise<number | null> {
    // 1. Check local mapping cache
    const cached = await this.prisma.animeMapping.findUnique({
      where: { id: anilistId },
    });

    // Note: We don't have a dedicated malId column in anime_mappings yet,
    // but we can reuse the anime table or just query MALSync.
    // For now, let's query MALSync as it's the most reliable source for mapping.
    
    try {
      this.logger.debug(`Fetching MAL ID for AniList ${anilistId} from MALSync`);
      const { data } = await axios.get(`https://api.malsync.moe/mal/anime/anilist:${anilistId}`, { timeout: 5000 });
      if (data && data.malId) {
        this.logger.debug(`Resolved AniList ${anilistId} -> MAL ${data.malId}`);
        return data.malId;
      }
    } catch (e) {
      this.logger.warn(`MALSync resolution failed for AniList ${anilistId}: ${e.message}`);
    }

    return null;
  }

  /**
   * Saves (or updates) a MangaDex ID mapping for a given AniList ID.
   */
  async saveMangaDexMapping(anilistId: number, mangaDexId: string): Promise<void> {
    try {
      await this.prisma.animeMapping.upsert({
        where: { id: anilistId },
        update: { mangaDexId, lastChecked: new Date() },
        create: { id: anilistId, mangaDexId },
      });
      this.logger.debug(`Saved mapping: AniList ${anilistId} -> MangaDex ${mangaDexId}`);
    } catch (e) {
      this.logger.error(`Failed to save MangaDex mapping for ${anilistId}: ${e.message}`);
    }
  }

  // --- Private helpers ---

  private async searchHiAnime(
    searchTitle: string,
    originalTitle: string,
  ): Promise<string | null> {
    for (const host of this.hiAnimeHosts) {
      try {
        const url = `${host}/search?q=${encodeURIComponent(searchTitle)}`;
        const { data } = await axios.get(url, { timeout: 8000 });
        const results =
          data.data?.animes ||
          data.data?.results ||
          data.data?.response ||
          [];

        if (results.length === 0) continue;

        const bestMatch = this.findBestMatch(originalTitle, results);
        if (bestMatch) {
          this.logger.debug(
            `HiAnime match: "${bestMatch.title}" (id: ${bestMatch.id}) for "${originalTitle}"`,
          );
          return bestMatch.id;
        }
      } catch (e) {
        this.logger.debug(`HiAnime search failed on ${host}: ${e.message}`);
      }
    }
    return null;
  }

  private async searchMangaDex(title: string): Promise<string | null> {
    try {
      const { data } = await axios.get(
        `https://api.mangadex.org/manga?title=${encodeURIComponent(title)}&limit=5`,
        { 
          timeout: 15000,
          headers: {
            'User-Agent': 'Animy/1.0.0 (https://animy.xyz)'
          }
        },
      );

      const results = data.data || [];
      if (results.length === 0) return null;

      // Pick entry with closest title match
      const normalize = (s: string) =>
        s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

      const normalizedTarget = normalize(title);

      for (const entry of results) {
        const attrs = entry.attributes;
        const titles = [
          attrs.title?.en,
          attrs.title?.['ja-ro'],
          Object.values(attrs.title || {})[0],
        ].filter(Boolean) as string[];

        for (const t of titles) {
          if (normalize(t) === normalizedTarget) {
            return entry.id;
          }
        }
      }

      // Fall back to first result
      return results[0].id;
    } catch (e) {
      this.logger.error(`MangaDex search failed for "${title}": ${e.message}`);
      return null;
    }
  }

  /**
   * Finds the best matching result from a list using normalized string comparison.
   */
  private findBestMatch(
    target: string,
    results: Array<{ id: string; title?: string; name?: string }>,
  ): { id: string; title: string } | null {
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

    const normalizedTarget = normalize(target);

    // Exact match first
    for (const r of results) {
      const t = r.title || r.name || '';
      if (normalize(t) === normalizedTarget) {
        return { id: r.id, title: t };
      }
    }

    // Substring match
    for (const r of results) {
      const t = r.title || r.name || '';
      const normalizedResult = normalize(t);
      if (
        normalizedResult.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedResult)
      ) {
        return { id: r.id, title: t };
      }
    }

    // Best overlap score
    let bestScore = 0;
    let bestResult: { id: string; title: string } | null = null;

    for (const r of results) {
      const t = r.title || r.name || '';
      const score = this.overlapScore(normalizedTarget, normalize(t));
      if (score > bestScore) {
        bestScore = score;
        bestResult = { id: r.id, title: t };
      }
    }

    // Only return if reasonable confidence
    return bestScore > 0.5 ? bestResult : results.length > 0 ? { id: results[0].id, title: results[0].title || results[0].name || '' } : null;
  }

  /**
   * Computes a word-overlap similarity score between two normalized strings (0-1).
   */
  private overlapScore(a: string, b: string): number {
    const wordsA = new Set(a.split(' '));
    const wordsB = new Set(b.split(' '));
    let overlap = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) overlap++;
    }
    return overlap / Math.max(wordsA.size, wordsB.size);
  }
}
