"use client";

import React, { createContext, useState, useContext, useCallback, ReactNode } from 'react';
import { Content } from '@google/genai';

// Define the structure for frontend message display
export interface MessageData {
    sender: 'user' | 'llm' | 'tool';
    text: string;
}

// Define the structure for chat metadata (used by Sidebar)
export interface ChatMetadata {
    id: string;
    title: string;
    createdAt: string;
    lastModified: string;
}

// Define the structure for a full chat record (used for loading)
export interface ChatRecord extends ChatMetadata {
    history: Content[]; // Or adjust type if conversion happens elsewhere
    systemPrompt?: string;
}

interface ChatContextType {
    currentChatId: string | null;
    setCurrentChatId: (id: string | null) => void; // Add the setter type
    messages: MessageData[]; // Add messages state
    setMessages: React.Dispatch<React.SetStateAction<MessageData[]>>; // Add setter for messages
    loadChat: (chatId: string) => Promise<void>; // Make async explicit
    startNewChat: () => void;
    saveCurrentChat: (title: string) => Promise<ChatRecord | null>; // Rename saveChat
    fetchChatList: () => Promise<ChatMetadata[]>; // Function to fetch list
    triggerListRefresh: () => void; // Function to trigger refresh
    refreshCounter: number; // State to trigger useEffect in Sidebar
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const initialMessages: MessageData[] = [
    { sender: 'llm', text: "Welcome Allan! How can I assist you?" }
];

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currentChatId, setCurrentChatId] = useState<string | null>(null);
    const [messages, setMessages] = useState<MessageData[]>(initialMessages); // Manage messages state here
    const [refreshCounter, setRefreshCounter] = useState(0); // Refresh trigger state

    const triggerListRefresh = useCallback(() => {
        setRefreshCounter(prev => prev + 1);
    }, []);

    const startNewChat = useCallback(() => {
        setCurrentChatId(null);
        setMessages(initialMessages); // Reset messages to initial state
    }, []);

    // Remove useCallback wrapper from loadChat
    const loadChat = async (chatId: string) => {
        setCurrentChatId(chatId); // Set the ID first (triggers potential re-mount via key)
        try {
            const response = await fetch(`/api/chats/${chatId}`);

            if (!response.ok) {
                throw new Error(`Failed to load chat (${response.status}): ${response.statusText}`);
            }
            // Check content type before parsing JSON
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                throw new Error(`Unexpected content type: ${contentType}`);
            }

            const chatData: ChatRecord = await response.json();

            // Convert loaded history (Content[]) back to MessageData[]
            const loadedMessages: MessageData[] = chatData.history
                .map((content: any) => {
                    const text = content.parts?.map((part: any) => part.text || '').join('') || '';
                    if (content.role === 'user') return { sender: 'user' as const, text };
                    if (content.role === 'model') {
                        const functionCall = content.parts?.find((part: any) => part.functionCall);
                        if (functionCall) return null; // Skip function calls for now
                        return { sender: 'llm' as const, text };
                    }
                    if (content.role === 'function') {
                        const responseData = content.parts?.[0]?.functionResponse?.response?.content;
                        const summary = responseData ? `Tool Result: ${JSON.stringify(responseData)}` : 'Tool executed.';
                        return { sender: 'tool' as const, text: summary };
                    }
                    return null;
                })
                .filter((msg: MessageData | null): msg is MessageData => msg !== null);

            // Set messages only AFTER successful fetch and conversion
            setMessages(loadedMessages.length > 0 ? loadedMessages : initialMessages);
        } catch (error: any) {
            console.error("[CONTEXT] Error in loadChat function:", error); // Keep error log
            setMessages([{ sender: 'llm', text: `Error loading chat: ${error.message}` }]);
        }
    }; // End of loadChat function (no useCallback)

    const fetchChatList = useCallback(async (): Promise<ChatMetadata[]> => {
        try {
            const response = await fetch('/api/chats');
            if (!response.ok) {
                throw new Error(`Failed to fetch chats: ${response.statusText}`);
            }
            const data: ChatMetadata[] = await response.json();
            return data;
        } catch (err) {
            console.error("[CONTEXT] Error fetching chats in context:", err); // Keep error log
            return []; // Return empty on error
        }
    }, []);

    // Renamed to saveCurrentChat, uses context's messages state
    const saveCurrentChat = useCallback(async (title: string): Promise<ChatRecord | null> => {

        // Convert MessageData[] to Content[] (Simplified: Omitting tool messages)
        const historyToSave: any[] = messages
            .map(msg => {
                if (msg.sender === 'user') {
                    return { role: 'user', parts: [{ text: msg.text }] };
                } else if (msg.sender === 'llm') {
                    // Ensure we don't save the initial welcome message if nothing else happened
                    if (currentChatId === null && messages.length === 1 && msg.text === initialMessages[0].text) {
                        return null;
                    }
                    return { role: 'model', parts: [{ text: msg.text }] };
                }
                return null; // Omit 'tool' messages
            })
            .filter(item => item !== null);


        if (historyToSave.length === 0) {
            console.error("[CONTEXT] Cannot save chat with no valid user or LLM messages."); // Keep error log
            throw new Error("Cannot save chat with no user or LLM messages.");
        }

        const url = currentChatId ? `/api/chats/${currentChatId}` : '/api/chats';
        const method = currentChatId ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title, // Send title for both POST and PUT
                    history: historyToSave,
                    // systemPrompt: "..." // TODO: Need to track/pass the system prompt used
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `Failed to ${method} chat: ${response.statusText}`);
            }
            const savedOrUpdatedChat: ChatRecord = await response.json();
            triggerListRefresh(); // Trigger sidebar refresh
            // If it was a new chat (POST), update the currentChatId
            if (!currentChatId) {
                setCurrentChatId(savedOrUpdatedChat.id);
            }
            return savedOrUpdatedChat;
        } catch (error: any) {
            console.error(`[CONTEXT] Error ${currentChatId ? 'updating' : 'saving'} chat in context:`, error); // Keep error log
            throw error; // Re-throw error so UI can handle it
        }
    }, [messages, currentChatId, triggerListRefresh, setCurrentChatId, setMessages]); // Add setMessages dependency

    return (
        <ChatContext.Provider value={{
            currentChatId,
            setCurrentChatId, // Keep setter for direct use if needed elsewhere
            messages, // Provide messages state
            setMessages, // Provide messages setter
            loadChat,
            startNewChat,
            fetchChatList,
            saveCurrentChat, // Provide renamed save function
            triggerListRefresh,
            refreshCounter
        }}>
            {children}
        </ChatContext.Provider>
    );
};

export const useChat = (): ChatContextType => {
    const context = useContext(ChatContext);
    if (context === undefined) {
        throw new Error('useChat must be used within a ChatProvider');
    }
    return context;
};