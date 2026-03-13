const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

async function test(id) {
  const prisma = new PrismaClient();
  const logger = console;
  
  async function getMangaChapters(id) {
    logger.debug(`Fetching chapters for manga ${id}`);
    let title = "";
    
    const cachedManga = await prisma.manga.findUnique({ where: { id } });
    if (cachedManga && cachedManga.title) {
      title = cachedManga.title;
      logger.debug(`Found title in DB: ${title}`);
    } else {
      logger.debug(`Fetching title from Anilist API`);
      const { data } = await axios.post('https://graphql.anilist.co', {
          query: `
            query ($id: Int) {
              Media(id: $id, type: MANGA) {
                title {
                  romaji
                  english
                }
              }
            }
          `,
          variables: { id }
      });
      const anilistInfo = data.data.Media;
      if (anilistInfo) {
          title = anilistInfo.title.english || anilistInfo.title.romaji;
          logger.debug(`Found title from Anilist: ${title}`);
      }
    }

    if (!title) {
      logger.warn(`Could not find title for manga ${id}`);
      return { chapters: [] };
    }

    // 1. Try meta/anilist-manga with mangadex first
    try {
      const { data } = await axios.get(`https://consumet-api-clone.vercel.app/meta/anilist-manga/${id}?provider=mangadex`);
      if (data.chapters && data.chapters.length > 0) {
        const chapters = data.chapters.map(c => ({ 
          ...c, 
          id: `anilist___${Buffer.from(c.id).toString('base64url')}` 
        }));
        return { chapters };
      }
    } catch (e) {
      logger.debug(`meta/anilist-manga failed for ${id}, falling back...`);
    }

    // 2. Try direct provider search fallback
    const providers = ['mangapill', 'mangadex'];
    
    for (const provider of providers) {
      try {
        logger.debug(`Searching ${provider} for: ${title}`);
        const searchRes = await axios.get(`https://consumet-api-clone.vercel.app/manga/${provider}/${encodeURIComponent(title)}`);
        
        if (searchRes.data?.results?.length > 0) {
            let bestMatch = searchRes.data.results[0];
            
            // Helper to normalize strings for comparison (removes punctuation, multiple spaces, makes lowercase)
            const normalize = (str) => str.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim();
            const normalizedTargetTitle = normalize(title);

            for (const res of searchRes.data.results) {
              const normalizedResTitle = normalize(res.title);
              if (normalizedResTitle === normalizedTargetTitle || normalizedResTitle.includes(normalizedTargetTitle) || normalizedTargetTitle.includes(normalizedResTitle)) {
                  bestMatch = res; 
                  break;
              }
            }
            
            const providerId = bestMatch.id;
            logger.debug(`Matched title for ${title}: ${bestMatch.title} (ID: ${providerId})`);
            
            const infoUrl = `https://consumet-api-clone.vercel.app/manga/${provider}/info?id=${providerId}`;
            const infoRes = await axios.get(infoUrl);
            
            if (infoRes.data?.chapters && infoRes.data.chapters.length > 0) {
              const chapters = infoRes.data.chapters.map(c => ({
                ...c,
                id: `${provider}___${Buffer.from(c.id).toString('base64url')}`
              }));
              logger.debug(`Found ${chapters.length} chapters on ${provider}`);
              return { chapters };
            }
        }
      } catch (e) {
        logger.debug(`${provider} fallback failed: ${e.message}`);
      }
    }

    return { chapters: [] };
  }
  
  const res = await getMangaChapters(id);
  console.log(`Final chapters count for ${id}:`, res.chapters.length);
  await prisma.$disconnect();
}
test(108556);
