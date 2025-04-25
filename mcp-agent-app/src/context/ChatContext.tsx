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
// Import UI Part types/shapes based on documentation
// Remove ChatRequestOptions import
import { useChat as useAiChat, type Message as AiMessage } from '@ai-sdk/react';
// Define local interfaces for UI parts based on documentation for clarity in mapping
interface TextUIPart { type: "text"; text: string; }
interface ToolInvocationForLoading { // Reconstructing the 'call' state from saved data
    state: 'call'; // Assume 'call' state when loading saved ToolCallPart
    toolCallId: string;
    toolName: string;
    args: any;
}
interface ToolInvocationUIPart { type: "tool-invocation"; toolInvocation: ToolInvocationForLoading; }
// Add other UI part types like ReasoningUIPart etc. here if needed for loading/display later
type AiMessagePartForLoading = TextUIPart | ToolInvocationUIPart;

// Import Core types needed
import { CoreMessage, CoreUserMessage, CoreAssistantMessage, TextPart, ToolCallPart, type ToolInvocation } from 'ai';
import llmConfigData from '../../llm-config.json';

// Define Attachment type based on Vercel AI SDK docs
export interface Attachment {
    name?: string;
    contentType?: string;
    url: string; // Data URL or regular URL
}

// Define local type for handleSubmit options based on docs
interface SubmitOptions {
    experimental_attachments?: Attachment[];
    // Add other options like data, headers, body if needed later
}


// Keep MessageData for potential display mapping if needed, but primary state is AiMessage
export interface MessageData {
    sender: 'user' | 'llm' | 'tool'; // Keep 'tool' here for potential future display logic if needed
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
    history: CoreMessage[]; // This can still contain CoreToolMessage if loaded from elsewhere, but saveCurrentChat won't create them
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
    // Update handleSubmit signature to use local SubmitOptions type
    handleSubmit: (e: FormEvent<HTMLFormElement>, chatRequestOptions?: SubmitOptions) => void;
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

    // Helper function to map Core parts back to UI parts for loading/display
    function mapCoreMessagePartsToAiMessageParts(coreContent: CoreMessage['content']): AiMessagePartForLoading[] | undefined {
        if (!Array.isArray(coreContent)) return undefined; // Only process if content is an array of parts

        const uiParts: AiMessagePartForLoading[] = [];
        for (const part of coreContent) {
            if (part.type === 'text') {
                uiParts.push({ type: 'text', text: part.text });
            } else if (part.type === 'tool-call') {
                // Reconstruct the ToolInvocationUIPart structure assuming 'call' state
                const toolInvocationData: ToolInvocationForLoading = {
                    state: 'call', // Assume 'call' state when loading from saved CoreMessage
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    args: part.args,
                };
                uiParts.push({
                    type: 'tool-invocation',
                    toolInvocation: toolInvocationData
                });
            }
            // Ignore other core part types (like 'tool-result') when reconstructing UI parts for display
        }
        return uiParts.length > 0 ? uiParts : undefined;
    }


    const loadChat = useCallback(async (chatId: string) => {
        setCurrentChatId(chatId);
        aiChatHook.stop(); // Stop any ongoing generation
        aiChatHook.setMessages([]); // Clear hook's messages immediately
        try {
            const response = await fetch(`/api/chats/${chatId}`);
            if (!response.ok) throw new Error(`Failed to load chat: ${response.statusText}`);
            const chatData: ChatRecord = await response.json();

            // --- DEBUG LOG: Inspect history loaded from DB ---
            // console.log('Loaded chatData.history from DB:', JSON.stringify(chatData.history, null, 2));
            // --- END DEBUG LOG ---

            // Sync provider/model from loaded chat back to context state
            const loadedProviderId = chatData.providerId || initialProviderId;
            const loadedModelId = chatData.modelId || initialModelId;
            setCurrentProviderId(loadedProviderId);
            setCurrentModelId(loadedModelId);

            // Map loaded CoreMessage[] history to AiMessage[]
            const loadedAiMessages: AiMessage[] = (chatData.history || [])
                // Filter only user/assistant roles from saved history
                .filter(coreMsg => coreMsg.role === 'user' || coreMsg.role === 'assistant')
                .map((coreMsg, index): AiMessage => {
                    const baseAiMsg = {
                        id: `loaded-${chatId}-${index}`,
                        role: coreMsg.role as 'user' | 'assistant', // Role is guaranteed by filter
                        content: '', // Initialize content, will be overwritten
                        parts: undefined as AiMessage['parts'] | undefined, // Initialize parts
                    };

                    if (coreMsg.role === 'assistant' && Array.isArray(coreMsg.content)) {
                        const uiParts = mapCoreMessagePartsToAiMessageParts(coreMsg.content);
                        if (uiParts) {
                            const textContent = uiParts
                                .filter((p): p is TextUIPart => p.type === 'text')
                                .map(p => p.text)
                                .join('');
                            baseAiMsg.content = textContent;
                            baseAiMsg.parts = uiParts as AiMessage['parts'];
                        } else {
                            const contentStr = JSON.stringify(coreMsg.content);
                            console.warn(`[loadChat] Assistant message content was array but mapping yielded no UI parts. Stringifying: ${contentStr}`);
                            baseAiMsg.content = contentStr;
                        }
                        // REMOVED: Logic for loading 'tool' role
                        // } else if (coreMsg.role === 'tool' && Array.isArray(coreMsg.content) && coreMsg.content[0]?.type === 'tool-result') {
                        //      // ... logic removed ...
                    }
                    else {
                        // Handle user messages or assistant messages with simple string content
                        const contentStr = typeof coreMsg.content === 'string' ? coreMsg.content : JSON.stringify(coreMsg.content);
                        baseAiMsg.content = contentStr;
                    }

                    return baseAiMsg as AiMessage; // Cast the final object
                });

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

    // Helper function to map UI parts to Core parts for saving
    function mapAiMessagePartsToCoreMessageParts(parts: AiMessage['parts']): (TextPart | ToolCallPart)[] {
        if (!parts) return [];
        const coreParts: (TextPart | ToolCallPart)[] = [];
        for (const part of parts) {
            if (part.type === 'text') {
                coreParts.push({ type: 'text', text: part.text });
            } else if (part.type === 'tool-invocation') {
                // Ensure the structure matches ToolCallPart
                // Cast toolInvocation, assuming it has the required fields
                const toolInvocationData = part.toolInvocation as ToolInvocation; // Use imported type
                if (toolInvocationData && toolInvocationData.toolCallId && toolInvocationData.toolName && toolInvocationData.args !== undefined) {
                    coreParts.push({
                        type: 'tool-call',
                        toolCallId: toolInvocationData.toolCallId,
                        toolName: toolInvocationData.toolName,
                        args: toolInvocationData.args,
                    });
                } else {
                    console.warn("[mapAiMessagePartsToCoreMessageParts] Skipping tool-invocation part due to missing data:", part);
                }
            }
            // Ignore other UI-specific parts like 'reasoning', 'source', 'step-start' for saving
        }
        return coreParts;
    }


    // saveCurrentChat: Saves only user and assistant messages, handling parts correctly.
    const saveCurrentChat = useCallback(async (title: string): Promise<ChatRecord | null> => {
        const messagesForHistory: AiMessage[] = [...aiChatHook.messages];

        // --- DEBUG LOG: Inspect message structure before saving ---
        // console.log('Messages state before saving:', JSON.stringify(messagesForHistory, null, 2));
        // --- END DEBUG LOG ---

        // Map messages, allowing null for roles we don't handle or empty messages
        const mappedHistory: (CoreUserMessage | CoreAssistantMessage | null)[] = messagesForHistory
            .map((aiMsg: AiMessage): CoreUserMessage | CoreAssistantMessage | null => {
                if (aiMsg.role === 'user') {
                    // --- User Message ---
                    const contentStr = typeof aiMsg.content === 'string' ? aiMsg.content : JSON.stringify(aiMsg.content);
                    // Ensure content isn't just whitespace
                    if (contentStr.trim() === '') return null;
                    return { role: 'user', content: contentStr };

                } else if (aiMsg.role === 'assistant') {
                    // --- Assistant Message ---
                    if (aiMsg.parts && aiMsg.parts.length > 0) {
                        const coreParts = mapAiMessagePartsToCoreMessageParts(aiMsg.parts);
                        // Only save if we actually mapped some core parts relevant for history
                        if (coreParts.length > 0) {
                            return { role: 'assistant', content: coreParts };
                        } else {
                            // If parts existed but none were mappable to core types, or only UI parts, save simple content as fallback
                            const contentStr = typeof aiMsg.content === 'string' ? aiMsg.content : JSON.stringify(aiMsg.content);
                            // Ensure content isn't just whitespace
                            if (contentStr.trim() === '') return null;
                            return { role: 'assistant', content: contentStr };
                        }
                    } else {
                        // Fallback to string content if no parts array
                        const contentStr = typeof aiMsg.content === 'string' ? aiMsg.content : JSON.stringify(aiMsg.content);
                        // Ensure content isn't just whitespace
                        if (contentStr.trim() === '') return null;
                        return { role: 'assistant', content: contentStr };
                    }
                } else {
                    // Explicitly ignore other roles like 'system', 'data', 'tool' for saving
                    return null;
                }
            });

        // Filter out any nulls (e.g. from empty messages or unhandled roles)
        const historyToSave: CoreMessage[] = mappedHistory.filter(
            (msg): msg is CoreUserMessage | CoreAssistantMessage => msg !== null
        );


        if (historyToSave.length === 0) {
            console.error("[CONTEXT] Cannot save chat with no valid user or assistant messages.");
            return null;
        }

        const url = currentChatId ? `/api/chats/${currentChatId}` : '/api/chats';
        const method = currentChatId ? 'PUT' : 'POST';
        const requestBody: any = {
            title: title,
            history: historyToSave, // Use the correctly filtered and typed history
            providerId: currentProviderId,
            modelId: currentModelId,
        };
        console.log(`[CONTEXT saveCurrentChat] Attempting ${method} to ${url}`);
        console.log(`[CONTEXT saveCurrentChat] Title being sent:`, title);
        // Limit logging potentially large history
        // console.log(`[CONTEXT saveCurrentChat] Request Body being sent:`, JSON.stringify(requestBody, null, 2));
        console.log(`[CONTEXT saveCurrentChat] Sending ${historyToSave.length} messages.`);

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
            if (!currentChatId) {
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
            // Pass the original handleSubmit from the hook, which accepts options
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