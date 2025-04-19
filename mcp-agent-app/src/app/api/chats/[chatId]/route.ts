import { NextResponse, NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { Content } from '@google/genai';

// Define a type for the params object expected in the context
interface RouteParams {
    chatId: string;
}

// GET /api/chats/{chatId} - Retrieve a specific chat
export async function GET(request: NextRequest, context: { params: RouteParams }) {
    // console.log("[API GET /api/chats/[chatId]] Context received:", JSON.stringify(context, null, 2)); // Removed log
    try {
        // Await the params object as per Next.js 15 documentation
        const { chatId } = await context.params;

        if (!chatId) {
            console.error("[API GET /api/chats/[chatId]] Error: chatId is missing after await."); // Keep error log
            return NextResponse.json({ message: "Chat ID is required" }, { status: 400 });
        }
        console.log("[API GET /api/chats/[chatId]] Accessed chatId:", chatId);

        const chat = await prisma.chat.findUnique({
            where: { id: chatId },
        });

        if (!chat) {
            // console.log(`[API GET /api/chats/[chatId]] Chat not found for ID: ${chatId}`); // Removed log
            return NextResponse.json({ message: "Chat not found" }, { status: 404 });
        }
        console.log(`[API GET /api/chats/[chatId]] Found chat: ${chatId}`);
        return NextResponse.json(chat);

    } catch (error: any) {
        console.error(`[API GET /api/chats/[chatId]] Error processing request.`, error); // Keep error log
        const potentialChatId = (typeof context?.params?.chatId === 'string') ? context.params.chatId : 'unknown';
        console.error(`[API GET /api/chats/[chatId]] Failed for potential chatId ${potentialChatId}:`, error); // Keep error log
        return NextResponse.json({ message: "Failed to retrieve chat" }, { status: 500 });
    }
}

// DELETE /api/chats/{chatId} - Delete a specific chat
export async function DELETE(request: NextRequest, context: { params: RouteParams }) {
    // console.log("[API DELETE /api/chats/[chatId]] Context received:", JSON.stringify(context, null, 2)); // Removed log
    try {
        // Await the params object as per Next.js 15 documentation
        const { chatId } = await context.params;

        if (!chatId) {
            console.error("[API DELETE /api/chats/[chatId]] Error: chatId is missing after await."); // Keep error log
            return NextResponse.json({ message: "Chat ID is required" }, { status: 400 });
        }
        console.log("[API DELETE /api/chats/[chatId]] Accessed chatId:", chatId);

        const existingChat = await prisma.chat.findUnique({
            where: { id: chatId },
            select: { id: true }
        });

        if (!existingChat) {
            console.log(`[API DELETE /api/chats/[chatId]] Chat not found for ID: ${chatId}`);
            return NextResponse.json({ message: "Chat not found" }, { status: 404 });
        }

        await prisma.chat.delete({
            where: { id: chatId },
        });
        console.log(`[API DELETE /api/chats/[chatId]] Deleted chat: ${chatId}`);
        return NextResponse.json({ message: "Chat deleted successfully" }, { status: 200 });
    } catch (error: any) {
        console.error(`[API DELETE /api/chats/[chatId]] Error processing request.`, error); // Keep error log
        const potentialChatId = (typeof context?.params?.chatId === 'string') ? context.params.chatId : 'unknown';
        console.error(`[API DELETE /api/chats/[chatId]] Failed for potential chatId ${potentialChatId}:`, error); // Keep error log
        return NextResponse.json({ message: "Failed to delete chat" }, { status: 500 });
    }
}

// PUT /api/chats/{chatId} - Update an existing chat
export async function PUT(request: NextRequest, context: { params: RouteParams }) {
    // console.log("[API PUT /api/chats/[chatId]] Context received:", JSON.stringify(context, null, 2)); // Removed log
    try {
        // Await the params object as per Next.js 15 documentation
        const { chatId } = await context.params;

        if (!chatId) {
            console.error("[API PUT /api/chats/[chatId]] Error: chatId is missing after await."); // Keep error log
            return NextResponse.json({ message: "Chat ID is required" }, { status: 400 });
        }
        console.log("[API PUT /api/chats/[chatId]] Accessed chatId:", chatId);

        const body = await request.json();
        // console.log(`[API PUT /api/chats/[chatId]] Received body for ID ${chatId}:`, JSON.stringify(body, null, 2)); // Removed log

        if (!body.history || !Array.isArray(body.history)) {
            console.error(`[API PUT /api/chats/[chatId]] Missing history for ID: ${chatId}`); // Keep error log
            return NextResponse.json({ message: "Missing required field: history" }, { status: 400 });
        }

        const updatedChat = await prisma.chat.update({
            where: { id: chatId },
            data: {
                title: body.title,
                history: body.history as any,
                systemPrompt: body.systemPrompt,
            },
        });
        console.log(`[API PUT /api/chats/[chatId]] Updated chat: ${chatId}`);
        return NextResponse.json(updatedChat);
    } catch (error: any) {
        console.error(`[API PUT /api/chats/[chatId]] Error processing request.`, error); // Keep error log
        const potentialChatId = (typeof context?.params?.chatId === 'string') ? context.params.chatId : 'unknown';
        console.error(`[API PUT /api/chats/[chatId]] Failed for potential chatId ${potentialChatId}:`, error); // Keep error log
        if (error.code === 'P2025') {
            return NextResponse.json({ message: "Chat not found" }, { status: 404 });
        }
        return NextResponse.json({ message: "Failed to update chat" }, { status: 500 });
    }
}