
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- USER DIAGNOSIS ---');
    const users = await prisma.user.findMany({
        select: {
            email: true,
            provider: true,
            emailVerified: true,
            username: true,
        }
    });

    console.table(users);
    console.log('----------------------');
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
