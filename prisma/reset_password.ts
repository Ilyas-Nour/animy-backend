
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const email = 'eliasnourelislam@gmail.com';
    const newPassword = 'AnimeHub123!';

    console.log(`Resetting password for ${email}...`);

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
        where: { email },
        data: {
            password: hashedPassword,
            emailVerified: true, // Ensure verified
            provider: 'EMAIL' // Ensure provider is EMAIL
        }
    });

    console.log('Password reset successfully.');
    console.log(`New Password: ${newPassword}`);
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
