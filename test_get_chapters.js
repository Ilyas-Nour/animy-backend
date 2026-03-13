const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

async function test() {
  const prisma = new PrismaClient();
  
  // mock anilist service
  const logger = console;
  
  async function getMangaChapters(id) {
    logger.debug(`Fetching chapters for manga ${id}`);
    let title = "Jujutsu Kaisen";
    
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
        const searchRes = await axios.get(`https://consumet-api-clone.vercel.app/manga/${provider}/${title}`);
        
        if (searchRes.data?.results?.length > 0) {
          const providerId = searchRes.data.results[0].id;
          
          // Note: consumet-api endpoints vary slighty (info?id= vs info/id)
          // DO NOT encode the providerId because it contains '/' which Consumet needs unencoded
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
  
  const res = await getMangaChapters(101517);
  console.log('Chapters found:', res.chapters.length);
  if (res.chapters.length > 0) {
     console.log('First chapter id:', res.chapters[0].id);
  }
  await prisma.$disconnect();
}
test();
