import { PrismaClient } from '../generated/prisma';

let prisma: PrismaClient;

if (process.env.NODE_ENV === 'production') {
    prisma = new PrismaClient();
} else {
    // Ensure the prisma instance is re-used during hot-reloading in development
    // Avoid creating too many connections
    if (!global.prisma) {
        global.prisma = new PrismaClient();
    }
    prisma = global.prisma;
}

export default prisma;

// Add prisma to the NodeJS global type
declare global {
    var prisma: PrismaClient | undefined;
}