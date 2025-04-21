"use client";

import React, { useEffect, useRef, FormEvent } from 'react';
import Message from './Message';
import ChatInput from './ChatInput';
// Import context hook and MessageData type (for mapping)
import { useChat as useChatContext, MessageData } from '@/context/ChatContext';
// Import AiMessage type for mapping function
import { type Message as AiMessage } from '@ai-sdk/react';

// Helper function to map context's AiMessage to MessageData for display
function mapAiMessageToMessageData(aiMsg: AiMessage): MessageData {
    // Basic mapping, assuming 'assistant' role maps to 'llm'
    // TODO: Handle tool/data roles if needed for display
    return {
        sender: aiMsg.role === 'user' ? 'user' : 'llm',
        text: aiMsg.content,
    };
}

const ChatInterface: React.FC = () => {
    // Destructure everything needed directly from the context
    const {
        messages, // These are AiMessage[] from the hook inside the context
        input,
        handleInputChange,
        handleSubmit,
        isLoading,
        error,
    } = useChatContext();

    const messagesEndRef = useRef<null | HTMLDivElement>(null);

    // Scroll to bottom effect - depends on messages from context
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Map context's AiMessage[] to MessageData[] for rendering
    const displayMessages = messages.map(mapAiMessageToMessageData);

    // Wrapper for form submission using handleSubmit from context
    const handleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        handleSubmit(e); // Call the context's (hook's) submit handler
    };

    // Wrapper for ChatInput's onSend
    const handleSendWrapper = (text: string) => {
        // Simulate form submission event to trigger handleSubmit from context
        const fakeForm = document.createElement('form');
        // Create a basic event object; the hook primarily uses the 'input' state
        const fakeEvent = {
            preventDefault: () => { },
            currentTarget: fakeForm,
        } as unknown as FormEvent<HTMLFormElement>;
        handleSubmit(fakeEvent);
    };

    return (
        <div className="flex flex-col h-full w-full max-w-5xl mx-auto px-4 pt-6 pb-2">
            {/* Message display area */}
            <div className="flex-grow overflow-y-auto mb-4 pr-2 flex flex-col">
                {displayMessages.length === 0 ? (
                    // Initial Welcome Message State
                    <div className="flex-grow flex flex-col items-center justify-center text-center">
                        <h1 className="text-4xl font-semibold animate-text-gradient">
                            Welcome Allan! How can I assist you?
                        </h1>
                    </div>
                ) : (
                    // Regular Message Display using messages from context
                    <div className="space-y-2">
                        {displayMessages.map((msg, index) => (
                            <Message
                                key={messages[index].id} // Use stable ID from context's messages
                                sender={msg.sender}
                                text={msg.text}
                            />
                        ))}
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area Container - Use a form for handleSubmit */}
            <form onSubmit={handleFormSubmit} className="relative mb-2">
                <ChatInput
                    value={input} // Use input from context
                    onChange={handleInputChange} // Use handler from context
                    onSend={handleSendWrapper} // Use wrapper to trigger submit
                />
            </form>

            {/* Status Display Area */}
            <div className="text-center text-xs text-gray-500 dark:text-gray-400 pt-1 h-5">
                {isLoading ? "Generating response..." : error ? `Error: ${error.message}` : ""}
            </div>
            {/* Placeholder for height consistency */}
            {!isLoading && !error && <div className="h-5 pt-1"></div>}
        </div>
    ); // Ensure closing parenthesis is present
}; // Ensure closing brace is present

export default ChatInterface;