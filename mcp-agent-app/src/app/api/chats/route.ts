import { NextResponse, NextRequest } from 'next/server';
import prisma from '@/lib/prisma'; // Use the centralized Prisma client
import { Content } from '@google/genai'; // Import Content type for validation/casting

// Define the expected structure for the POST request body
interface CreateChatRequestBody {
    title: string;
    history: Content[]; // Expecting the full Gemini history format
    systemPrompt?: string;
    // userId?: string; // Add later if implementing user accounts
}

// GET /api/chats - List saved chats (metadata only)
export async function GET(request: NextRequest) {
    console.log("[API GET /api/chats] Request received");
    try {
        // TODO: Add filtering by userId if/when user accounts are implemented
        const chats = await prisma.chat.findMany({
            select: {
                id: true,
                title: true,
                createdAt: true,
                lastModified: true,
            },
            orderBy: {
                lastModified: 'desc', // Show most recent first
            },
        });
        console.log(`[API GET /api/chats] Found ${chats.length} chats`);
        return NextResponse.json(chats);
    } catch (error) {
        console.error("[API GET /api/chats] Failed to fetch chats:", error); // Keep error log
        return NextResponse.json({ message: "Failed to fetch chat list" }, { status: 500 });
    }
}

// POST /api/chats - Create a new chat
export async function POST(request: NextRequest) {
    console.log("[API POST /api/chats] Request received");
    try {
        const body = await request.json() as CreateChatRequestBody;
        // console.log("[API POST /api/chats] Received body:", JSON.stringify(body, null, 2)); // Removed log

        // Basic validation
        if (!body.title || !body.history || !Array.isArray(body.history) || body.history.length === 0) {
            console.error("[API POST /api/chats] Validation failed: Missing title or history."); // Keep error log
            return NextResponse.json({ message: "Missing required fields: title and history" }, { status: 400 });
        }

        // TODO: Add userId if/when user accounts are implemented
        const newChat = await prisma.chat.create({
            data: {
                title: body.title,
                history: body.history as any, // Cast to 'any' for Prisma Json type
                systemPrompt: body.systemPrompt,
            },
        });
        console.log(`[API POST /api/chats] Created new chat with ID: ${newChat.id}`);
        return NextResponse.json(newChat, { status: 201 }); // Return the created chat object
    } catch (error) {
        console.error("[API POST /api/chats] Failed to create chat:", error); // Keep error log
        return NextResponse.json({ message: "Failed to save chat" }, { status: 500 });
    }
}