"use client"; // Required for useState

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { MessageSquare, PanelLeftClose, BrainCircuit, Plus, Trash2, Loader2, RefreshCw, Save } from 'lucide-react'; // Added Save icon
import { useChat, ChatMetadata, LlmProvider, LlmModel } from '@/context/ChatContext'; // Import LLM types

const Sidebar: React.FC = () => {
    // Get LLM state from context
    const {
        startNewChat, loadChat, currentChatId, fetchChatList, refreshCounter, messages, saveCurrentChat,
        llmConfig, currentProviderId, setCurrentProviderId, currentModelId, setCurrentModelId // Add provider state
    } = useChat();

    const [isExpanded, setIsExpanded] = useState(true);
    const [hasMounted, setHasMounted] = useState(false);
    const [savedChats, setSavedChats] = useState<ChatMetadata[]>([]);
    const [isLoading, setIsLoading] = useState(false); // Loading history list
    const [isSaving, setIsSaving] = useState(false); // Saving state for button
    const [error, setError] = useState<string | null>(null);

    // Find the currently selected provider's config
    const selectedProvider = llmConfig.providers.find(p => p.id === currentProviderId);

    // Handler for provider change
    const handleProviderChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const newProviderId = event.target.value;
        setCurrentProviderId(newProviderId);
        // Reset model to the default for the new provider
        const newProviderConfig = llmConfig.providers.find(p => p.id === newProviderId);
        if (newProviderConfig) {
            setCurrentModelId(newProviderConfig.defaultModelId);
        }
    };

    // Load initial chat list and refresh when counter changes
    const loadInitialChats = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await fetchChatList();
            setSavedChats(data);
        } catch (err: any) {
            console.error("[Sidebar] Error loading initial chats:", err); // Keep error log
            setError(err.message || "Failed to load chats");
        } finally {
            setIsLoading(false);
        }
    }, [fetchChatList]);

    useEffect(() => {
        setHasMounted(true);
        loadInitialChats();
    }, [loadInitialChats, refreshCounter]);

    // Delete chat handler
    const handleDeleteChat = async (chatId: string, event: React.MouseEvent) => {
        event.stopPropagation();
        if (!confirm(`Are you sure you want to delete this chat?`)) {
            return;
        }
        try {
            const response = await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
            if (!response.ok) {
                throw new Error(`Failed to delete chat: ${response.statusText}`);
            }
            // Update local list *after* potential state reset
            setSavedChats(prevChats => prevChats.filter(chat => chat.id !== chatId));

            // Check if the deleted chat was the currently active one
            if (chatId === currentChatId) {
                startNewChat(); // Reset the chat interface to the "New Chat" state
            }
        } catch (err: any) {
            console.error("[Sidebar] Error deleting chat:", err); // Keep error log
            setError(err.message || "Failed to delete chat");
        }
    };

    // Save/Update handler - Uses existing title if updating
    const handleSaveClick = async () => {
        // Check if there are any user or assistant messages to save
        // Use 'assistant' role from AiMessage type
        const hasMessagesToSave = messages.some(msg => msg.role === 'user' || msg.role === 'assistant');
        if (!hasMessagesToSave && currentChatId === null) {
            alert("Nothing to save yet.");
            return;
        }

        let titleToSave: string | null = null;

        if (currentChatId) {
            const currentChat = savedChats.find(chat => chat.id === currentChatId);
            if (currentChat) {
                titleToSave = currentChat.title;
            } else {
                console.error("[Sidebar] Could not find current chat title in list for update."); // Keep error log
                alert("Error: Could not find current chat details to update.");
                return;
            }
        } else {
            titleToSave = prompt(`Enter a title for this chat:`, "New Chat");
        }

        if (!titleToSave) return;

        setIsSaving(true);
        try {
            await saveCurrentChat(titleToSave);
            alert(`Chat "${titleToSave}" ${currentChatId ? 'updated' : 'saved'} successfully!`);
        } catch (error: any) {
            console.error("[Sidebar] Error saving/updating chat from sidebar:", error); // Keep error log
            alert(`Error saving/updating chat: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    // Handler for clicking a chat item
    const handleLoadClick = (chatId: string) => {
        loadChat(chatId);
    };

    return (
        <div className={`transition-all duration-300 ease-in-out flex flex-col h-screen bg-gray-100 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 ${hasMounted ? (isExpanded ? 'w-64' : 'w-20') : 'w-20'}`}>
            {/* Header */}
            <div className="flex items-center justify-between p-4 h-16 border-b border-gray-200 dark:border-gray-700">
                {hasMounted && isExpanded && (
                    <div className="flex items-center space-x-2">
                        <BrainCircuit className="w-6 h-6 text-gray-800 dark:text-gray-200" />
                        <span className="font-semibold text-lg text-gray-800 dark:text-gray-200">bAI MCP</span>
                    </div>
                )}
                {(!hasMounted || !isExpanded) && <div className="w-6 h-6"></div>}
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="p-2 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none"
                    aria-label={hasMounted && isExpanded ? "Collapse sidebar" : "Expand sidebar"}
                >
                    {hasMounted && isExpanded ? <PanelLeftClose className="w-6 h-6" /> : <BrainCircuit className="w-6 h-6" />}
                </button>
            </div>

            {/* Navigation & History */}
            <div className="flex-grow flex flex-col overflow-y-auto">
                {/* New Chat Button */}
                <div className="p-4">
                    <button
                        onClick={startNewChat}
                        className={`flex items-center justify-center w-full p-2 space-x-3 rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 ${!isExpanded ? 'px-2' : ''}`}
                    >
                        <Plus className="w-5 h-5 flex-shrink-0" />
                        {hasMounted && isExpanded && <span className="font-medium text-sm">New Chat</span>}
                    </button>
                </div>

                {/* --- Provider Selection Dropdown --- */}
                {hasMounted && isExpanded && llmConfig.providers.length > 1 && (
                    <div className="px-4 pb-2">
                        <label htmlFor="provider-select" className="block mb-1 text-xs font-semibold text-gray-500 tracking-wider">
                            Provider:
                        </label>
                        <select
                            id="provider-select"
                            value={currentProviderId}
                            onChange={handleProviderChange}
                            className="w-full p-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-blue-500 focus:border-blue-500"
                        >
                            {llmConfig.providers.map((provider: LlmProvider) => (
                                <option key={provider.id} value={provider.id}>
                                    {provider.name}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
                {/* --- End Provider Selection Dropdown --- */}

                {/* --- Model Selection Dropdown (Dynamic) --- */}
                {hasMounted && isExpanded && selectedProvider && (
                    <div className="px-4 pb-2">
                        <label htmlFor="model-select" className="block mb-1 text-xs font-semibold text-gray-500 tracking-wider">
                            Model:
                        </label>
                        <select
                            id="model-select"
                            value={currentModelId}
                            onChange={(e) => setCurrentModelId(e.target.value)}
                            className="w-full p-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-blue-500 focus:border-blue-500"
                        >
                            {selectedProvider.models.map((model: LlmModel) => (
                                <option key={model.id} value={model.id}>
                                    {model.name} {/* Display model name */}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
                {/* --- End Model Selection Dropdown --- */}


                {/* Chat History Section */}
                <nav className="flex-grow p-4 pt-2 space-y-2"> {/* Adjusted pt-2 */}
                    {hasMounted && isExpanded && (
                        <h2 className="px-2 mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Chat History
                        </h2>
                    )}
                    {isLoading && (
                        <div className="flex items-center justify-center p-2 text-gray-500 dark:text-gray-400">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            {hasMounted && isExpanded && <span className="ml-2 text-sm">Loading...</span>}
                        </div>
                    )}
                    {error && (
                        <div className="px-2 text-sm text-red-600 dark:text-red-400">
                            Error: {error}
                        </div>
                    )}
                    {!isLoading && !error && savedChats.length === 0 && (
                        <div className="px-2 text-sm text-gray-500 dark:text-gray-400">
                            {hasMounted && isExpanded ? 'No saved chats yet.' : ''}
                        </div>
                    )}
                    {!isLoading && !error && savedChats.map((chat) => (
                        <button
                            key={chat.id}
                            onClick={() => {
                                handleLoadClick(chat.id);
                            }}
                            className={`w-full flex items-center p-2 space-x-3 rounded-md text-left text-sm group ${currentChatId === chat.id
                                ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                                } ${!isExpanded ? 'justify-center' : ''}`}
                            title={chat.title}
                        >
                            <MessageSquare className="w-5 h-5 flex-shrink-0" />
                            {hasMounted && isExpanded && (
                                <span className="font-medium truncate flex-grow mr-2">{chat.title}</span>
                            )}
                            {/* Restore Trash icon */}
                            {hasMounted && isExpanded && (
                                <Trash2
                                    className="w-4 h-4 text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 hover:text-red-600 dark:hover:text-red-400 flex-shrink-0"
                                    onClick={(e) => handleDeleteChat(chat.id, e)}
                                    aria-label="Delete chat"
                                />
                            )}
                        </button>
                    ))}
                </nav>
            </div>

            {/* Footer with Save/Update Button */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 space-y-2">
                {/* Show button if there are user or assistant messages */}
                {/* Use 'assistant' role from AiMessage type */}
                {messages.some(msg => msg.role === 'user' || msg.role === 'assistant') && (
                    <button
                        onClick={handleSaveClick}
                        className={`flex items-center justify-center w-full p-2 space-x-3 rounded-md text-sm ${currentChatId
                            ? 'bg-green-600 hover:bg-green-700 text-white'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                        disabled={isLoading || isSaving}
                        title={currentChatId ? "Update Saved Chat" : "Save New Chat"}
                    >
                        <Save className={`w-4 h-4 ${hasMounted && isExpanded ? 'mr-2' : ''}`} />
                        {/* Only show text when expanded */}
                        {hasMounted && isExpanded && <span>{isSaving ? 'Saving...' : (currentChatId ? 'Update Chat' : 'Save Chat')}</span>}
                        {/* Removed the span that showed 'U' or 'S' when collapsed */}
                    </button>
                )}
                {hasMounted && isExpanded && <span className="block text-center text-xs text-gray-500">History stored via backend.</span>}
            </div>
        </div>
    );
};

export default Sidebar;