"use client";

import React, { createContext, useState, useContext, useCallback, ReactNode, useEffect } from 'react'; // Added useEffect
import { Content } from '@google/genai';
import llmConfigData from '../../llm-config.json'; // Import the config data

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
    modelId?: string; // Add optional modelId field
}

// Define structure for LLM config (can be expanded later)
export interface LlmModel { // Export for use elsewhere
    id: string;
    name: string;
}
export interface LlmProvider { // Export for use elsewhere
    id: string;
    name: string;
    models: LlmModel[];
    defaultModelId: string;
}
export interface LlmConfig { // Export for use elsewhere
    providers: LlmProvider[];
}

// Cast the imported data to the defined type
const llmConfig: LlmConfig = llmConfigData as LlmConfig;


interface ChatContextType {
    currentChatId: string | null;
    setCurrentChatId: (id: string | null) => void;
    messages: MessageData[];
    setMessages: React.Dispatch<React.SetStateAction<MessageData[]>>;
    loadChat: (chatId: string) => Promise<void>;
    startNewChat: () => void;
    saveCurrentChat: (title: string) => Promise<ChatRecord | null>;
    fetchChatList: () => Promise<ChatMetadata[]>;
    triggerListRefresh: () => void;
    refreshCounter: number;
    // --- LLM Selection State ---
    llmConfig: LlmConfig; // Expose the loaded config
    currentModelId: string;
    setCurrentModelId: (modelId: string) => void;
    // currentProviderId: string; // Add later in Phase 2
    // setCurrentProviderId: (providerId: string) => void; // Add later in Phase 2
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const initialMessages: MessageData[] = [
    { sender: 'llm', text: "Welcome Allan! How can I assist you?" }
];

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currentChatId, setCurrentChatId] = useState<string | null>(null);
    const [messages, setMessages] = useState<MessageData[]>(initialMessages);
    const [refreshCounter, setRefreshCounter] = useState(0);

    // --- LLM Selection State ---
    // For now, assume Google is the only provider
    const googleProvider = llmConfig.providers.find(p => p.id === 'google');
    if (!googleProvider) {
        // This should ideally not happen if config is valid, but good practice
        throw new Error("Google provider configuration not found in llm-config.json");
    }
    const [currentModelId, setCurrentModelId] = useState<string>(googleProvider.defaultModelId);

    const triggerListRefresh = useCallback(() => {
        setRefreshCounter(prev => prev + 1);
    }, []);

    const startNewChat = useCallback(() => {
        setCurrentChatId(null);
        setMessages(initialMessages);
        // Reset model to default when starting a new chat
        setCurrentModelId(googleProvider.defaultModelId);
    }, [googleProvider?.defaultModelId]); // Add dependency

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

            // Set messages and potentially the model ID if saved with the chat
            setMessages(loadedMessages.length > 0 ? loadedMessages : initialMessages);
            // --- Load Model ID ---
            // Assuming ChatRecord will have an optional modelId field (add to type later)
            const loadedModelId = (chatData as any).modelId; // Use 'any' temporarily
            if (loadedModelId && googleProvider.models.some(m => m.id === loadedModelId)) {
                setCurrentModelId(loadedModelId);
            } else {
                // Fallback to default if not saved or invalid
                setCurrentModelId(googleProvider.defaultModelId);
            }
            // --- End Load Model ID ---
        } catch (error: any) {
            console.error("[CONTEXT] Error in loadChat function:", error);
            setMessages([{ sender: 'llm', text: `Error loading chat: ${error.message}` }]);
            // Reset model to default on error
            setCurrentModelId(googleProvider.defaultModelId);
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
                    modelId: currentModelId, // Include current model ID when saving/updating
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
    }, [messages, currentChatId, currentModelId, triggerListRefresh, setCurrentChatId]); // Removed setMessages, added currentModelId

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
            refreshCounter,
            // --- LLM Selection ---
            llmConfig: llmConfig, // Provide the loaded config
            currentModelId,
            setCurrentModelId
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