
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Unlocking all existing users...');
    try {
        const result = await prisma.user.updateMany({
            data: {
                emailVerified: true,
            },
        });
        console.log(`Successfully updated ${result.count} users to Verified status.`);
    } catch (error) {
        console.error('Error updating users:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
