"use client";

import React, {
    createContext,
    useState,
    useContext,
    useCallback,
    ReactNode,
    useEffect,
    ChangeEvent,
    FormEvent
} from 'react';
import { useChat as useAiChat, type Message as AiMessage } from '@ai-sdk/react';
import { CoreMessage, CoreUserMessage, CoreAssistantMessage } from 'ai';
import llmConfigData from '../../llm-config.json';

// Keep MessageData for potential display mapping if needed, but primary state is AiMessage
export interface MessageData {
    sender: 'user' | 'llm' | 'tool';
    text: string;
}

// Metadata for sidebar
export interface ChatMetadata {
    id: string;
    title: string;
    createdAt: string;
    lastModified: string;
}

// Full record for saving/loading - uses CoreMessage[] for history
export interface ChatRecord extends ChatMetadata {
    history: CoreMessage[];
    systemPrompt?: string;
    providerId?: string;
    modelId?: string;
}

// LLM Config types
export interface LlmModel { id: string; name: string; }
export interface LlmProvider { id: string; name: string; models: LlmModel[]; defaultModelId: string; }
export interface LlmConfig { providers: LlmProvider[]; }

const llmConfig: LlmConfig = llmConfigData as LlmConfig;

// Define the context type, exposing hook values + context actions
interface ChatContextType {
    currentChatId: string | null;
    setCurrentChatId: (id: string | null) => void;
    loadChat: (chatId: string) => Promise<void>;
    startNewChat: () => void;
    saveCurrentChat: (title: string) => Promise<ChatRecord | null>;
    fetchChatList: () => Promise<ChatMetadata[]>;
    triggerListRefresh: () => void;
    refreshCounter: number;
    // --- LLM Selection State ---
    llmConfig: LlmConfig;
    currentModelId: string;
    setCurrentModelId: (modelId: string) => void;
    currentProviderId: string;
    setCurrentProviderId: (providerId: string) => void;
    // --- Values/Functions from useAiChat ---
    messages: AiMessage[]; // Use AiMessage type from the hook
    input: string;
    handleInputChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    handleSubmit: (e: FormEvent<HTMLFormElement>) => void;
    status: 'error' | 'submitted' | 'streaming' | 'ready';
    error: Error | undefined;
    reload: () => void;
    stop: () => void;
    setMessages: (messages: AiMessage[]) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currentChatId, setCurrentChatId] = useState<string | null>(null);
    const [refreshCounter, setRefreshCounter] = useState(0);

    // --- LLM Selection State ---
    const initialProviderId = llmConfig.providers[1]?.id || 'xai';
    const initialProvider = llmConfig.providers.find(p => p.id === initialProviderId);
    if (!initialProvider) {
        throw new Error(`Initial provider configuration ('${initialProviderId}') not found in llm-config.json`);
    }
    const initialModelId = initialProvider.defaultModelId;

    const [currentProviderId, setCurrentProviderId] = useState<string>(initialProviderId);
    const [currentModelId, setCurrentModelId] = useState<string>(initialModelId);

    // --- Instantiate useAiChat Hook ---
    const aiChatHook = useAiChat({
        api: '/api/chat',
        body: {
            providerId: currentProviderId,
            modelId: currentModelId,
        },
        initialMessages: [], // Start empty, loadChat will populate
        onError: (err) => {
            console.error("[useAiChat Hook Error]", err);
        },
        onFinish: (message) => {
            console.log("[useAiChat Hook] Stream finished.");
        }
    });

    // --- Sync useAiChat body with context state ---
    useEffect(() => {
        console.log(`[CONTEXT] Provider/Model changed. Next submit will use: ${currentProviderId}/${currentModelId}`);
    }, [currentProviderId, currentModelId]);


    const triggerListRefresh = useCallback(() => {
        setRefreshCounter(prev => prev + 1);
    }, []);

    // --- Context Actions ---
    const startNewChat = useCallback(() => {
        setCurrentChatId(null);
        aiChatHook.setMessages([]);
        setCurrentProviderId(initialProviderId); // Reset provider
        setCurrentModelId(initialModelId); // Reset model
    }, [aiChatHook, initialProviderId, initialModelId]);

    const loadChat = useCallback(async (chatId: string) => {
        setCurrentChatId(chatId);
        aiChatHook.stop(); // Stop any ongoing generation
        aiChatHook.setMessages([]); // Clear hook's messages immediately
        try {
            const response = await fetch(`/api/chats/${chatId}`);
            if (!response.ok) throw new Error(`Failed to load chat: ${response.statusText}`);
            const chatData: ChatRecord = await response.json();

            // Sync provider/model from loaded chat back to context state
            const loadedProviderId = chatData.providerId || initialProviderId;
            const loadedModelId = chatData.modelId || initialModelId;
            setCurrentProviderId(loadedProviderId);
            setCurrentModelId(loadedModelId);

            // Map loaded CoreMessage[] history to AiMessage[]
            const loadedAiMessages: AiMessage[] = (chatData.history || [])
                .filter(coreMsg => coreMsg.role === 'user' || coreMsg.role === 'assistant')
                .map((coreMsg, index) => ({
                    id: `loaded-${chatId}-${index}`,
                    role: coreMsg.role as 'user' | 'assistant', // Cast role
                    content: typeof coreMsg.content === 'string' ? coreMsg.content : JSON.stringify(coreMsg.content),
                }));

            aiChatHook.setMessages(loadedAiMessages); // Set messages in the hook

        } catch (error: any) {
            console.error("[CONTEXT] Error in loadChat function:", error);
            aiChatHook.setMessages([{ id: 'error', role: 'assistant', content: `Error loading chat: ${error.message}` }]);
            setCurrentProviderId(initialProviderId); // Reset on error
            setCurrentModelId(initialModelId); // Reset on error
        }
    }, [aiChatHook, initialProviderId, initialModelId]);

    const fetchChatList = useCallback(async (): Promise<ChatMetadata[]> => {
        try {
            const response = await fetch('/api/chats');
            if (!response.ok) throw new Error(`Failed to fetch chats: ${response.statusText}`);
            const data: ChatMetadata[] = await response.json();
            return data;
        } catch (err) {
            console.error("[CONTEXT] Error fetching chats in context:", err);
            return [];
        }
    }, []);

    // saveCurrentChat: Reverted to require title, removed auto-save logic
    const saveCurrentChat = useCallback(async (title: string): Promise<ChatRecord | null> => {
        // Use current hook messages directly
        const messagesForHistory: AiMessage[] = [...aiChatHook.messages];

        // Now map AiMessage[] to CoreMessage[]
        const historyToSave: CoreMessage[] = messagesForHistory
            .filter(aiMsg => aiMsg.role === 'user' || aiMsg.role === 'assistant')
            .map(aiMsg => {
                const contentStr = typeof aiMsg.content === 'string' ? aiMsg.content : JSON.stringify(aiMsg.content);
                if (aiMsg.role === 'user') {
                    return { role: 'user', content: contentStr } as CoreUserMessage;
                } else {
                    return { role: 'assistant', content: contentStr } as CoreAssistantMessage;
                }
            });

        // Filter out messages with empty string content
        const filteredHistory = historyToSave.filter(msg => {
            return (msg.content as string).trim() !== '';
        });

        if (filteredHistory.length === 0) {
            console.error("[CONTEXT] Cannot save chat with no valid user or LLM messages.");
            return null;
        }

        const url = currentChatId ? `/api/chats/${currentChatId}` : '/api/chats';
        const method = currentChatId ? 'PUT' : 'POST';

        // --- Prepare Request Body ---
        // Title is now always required by the function signature for POST/PUT
        const requestBody: any = {
            title: title, // Use the provided title
            history: filteredHistory,
            providerId: currentProviderId,
            modelId: currentModelId,
        };

        // --- Logging before Fetch ---
        console.log(`[CONTEXT saveCurrentChat] Attempting ${method} to ${url}`);
        console.log(`[CONTEXT saveCurrentChat] Title being sent:`, title);
        console.log(`[CONTEXT saveCurrentChat] Request Body being sent:`, JSON.stringify(requestBody, null, 2));
        // --- End Logging ---

        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `Failed to ${method} chat: ${response.statusText}`);
            }
            const savedOrUpdatedChat: ChatRecord = await response.json();
            triggerListRefresh();
            if (!currentChatId) { // If it was a new chat, set its ID
                setCurrentChatId(savedOrUpdatedChat.id);
                console.log(`[CONTEXT saveCurrentChat] New chat saved with ID: ${savedOrUpdatedChat.id}`);
            } else {
                console.log(`[CONTEXT saveCurrentChat] Chat updated: ${currentChatId}`);
            }
            return savedOrUpdatedChat;
        } catch (error: any) {
            console.error(`[CONTEXT] Error ${currentChatId ? 'updating' : 'saving'} chat:`, error);
            throw error;
        }
    }, [aiChatHook.messages, currentChatId, currentProviderId, currentModelId, triggerListRefresh]);


    return (
        <ChatContext.Provider value={{
            currentChatId,
            setCurrentChatId,
            loadChat,
            startNewChat,
            fetchChatList,
            saveCurrentChat,
            triggerListRefresh,
            refreshCounter,
            // --- LLM Selection ---
            llmConfig: llmConfig,
            currentProviderId,
            setCurrentProviderId,
            currentModelId,
            setCurrentModelId,
            // --- Values/Functions from useAiChat ---
            messages: aiChatHook.messages,
            input: aiChatHook.input,
            handleInputChange: aiChatHook.handleInputChange as (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void, // Re-add cast
            handleSubmit: aiChatHook.handleSubmit,
            status: aiChatHook.status,
            error: aiChatHook.error,
            reload: aiChatHook.reload,
            stop: aiChatHook.stop,
            setMessages: aiChatHook.setMessages,
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