import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding Badges...');

    const badges = [
        // Level Milestones
        {
            code: 'LEVEL_1_INITIATE',
            name: 'The Awakening',
            description: 'You have taken your first steps into the world of anime. Your journey begins now.',
            imageUrl: 'badge_level_1.png',
            rarity: 'COMMON',
        },
        {
            code: 'LEVEL_10_OTAKU',
            name: 'Certified Weeb',
            description: 'You\'ve watched enough anime to understand "dattebayo". No turning back now.',
            imageUrl: 'badge_level_10.png',
            rarity: 'RARE',
        },
        {
            code: 'LEVEL_25_ELITE',
            name: 'Elite Watcher',
            description: 'Your watchlist is a badge of honor. You recommend series others haven\'t even heard of.',
            imageUrl: 'badge_level_25.png',
            rarity: 'EPIC',
        },
        {
            code: 'LEVEL_50_SENSEI',
            name: 'Anime Sensei',
            description: 'You guide the uninitiated. Your knowledge is vast, and your taste is refined.',
            imageUrl: 'badge_level_50.png',
            rarity: 'LEGENDARY',
        },
        {
            code: 'LEVEL_100_LEGEND',
            name: 'Living Legend',
            description: 'You have transcended fandom. You are the anime.',
            imageUrl: 'badge_level_100.png',
            rarity: 'LEGENDARY',
        },

        // Activity Badges
        {
            code: 'FIRST_FAVORITE',
            name: 'First Love',
            description: 'You managed to pick a favorite. It\'s special, isn\'t it?',
            imageUrl: 'badge_first_fav.png',
            rarity: 'COMMON',
        },
        {
            code: 'FIRST_FRIEND',
            name: 'Nakama',
            description: 'You found a friend! The power of friendship is on your side.',
            imageUrl: 'badge_friend.png',
            rarity: 'COMMON',
        },
        {
            code: 'LIBRARY_ARCHITECT',
            name: 'Library Architect',
            description: 'You have added 10 items to your lists. A true curator.',
            imageUrl: 'badge_library.png',
            rarity: 'RARE',
        },
        {
            code: 'SOCIAL_BUTTERFLY',
            name: 'Social Butterfly',
            description: 'You have connected with 5 friends. Time to start a guild?',
            imageUrl: 'badge_social.png',
            rarity: 'EPIC',
        },
    ];

    for (const badge of badges) {
        const exists = await prisma.badge.findUnique({
            where: { code: badge.code },
        });

        if (!exists) {
            // @ts-ignore - Enum handling in seed
            await prisma.badge.create({
                data: {
                    ...badge,
                    rarity: badge.rarity as any
                },
            });
            console.log(`Created badge: ${badge.name}`);
        } else {
            console.log(`Badge exists: ${badge.name}`);
        }
    }

    console.log('✅ Badges seeded successfully.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
