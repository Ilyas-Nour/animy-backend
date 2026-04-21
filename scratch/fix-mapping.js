const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixMapping() {
    console.log('Fixing JJK mapping...');
    try {
        const result = await prisma.animeMapping.upsert({
            where: { id: 101517 },
            update: { mangaDexId: 'c430e381-e23a-4933-bf41-e94589d8be8d' },
            create: { id: 101517, mangaDexId: 'c430e381-e23a-4933-bf41-e94589d8be8d' }
        });
        console.log('Successfully updated mapping:', result);
    } catch (e) {
        console.error('Failed to fix mapping:', e);
    } finally {
        await prisma.$disconnect();
    }
}

fixMapping();
