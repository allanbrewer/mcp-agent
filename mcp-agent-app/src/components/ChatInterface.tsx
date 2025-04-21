"use client";

import React, { useEffect, useRef, FormEvent } from 'react'; // Removed useState
import Message from './Message';
import ChatInput from './ChatInput';
import { useChat as useChatContext, MessageData } from '@/context/ChatContext'; // Renamed context hook
import { useChat as useAiChat, type Message as AiMessage } from 'ai/react'; // Import Vercel AI hook and type

// Helper function to map ai/react Message to our MessageData for display consistency
// Note: This might need adjustment based on how tool calls/results are represented in ai/react's Message type
function mapAiMessageToMessageData(aiMsg: AiMessage): MessageData {
    // Basic mapping, assuming 'assistant' role maps to 'llm'
    // TODO: Handle potential tool call/result messages if needed for display
    return {
        sender: aiMsg.role === 'user' ? 'user' : 'llm',
        text: aiMsg.content,
    };
}


const ChatInterface: React.FC = () => {
    // Get necessary values from our application's context
    const { currentChatId, currentModelId, currentProviderId, messages: contextMessages, setMessages: setContextMessages } = useChatContext();

    // Use Vercel AI SDK's useChat hook
    const {
        messages: aiMessages, // Messages managed by the hook
        input,               // Input field value managed by the hook
        handleInputChange,   // Input change handler from the hook
        handleSubmit: handleAiSubmit, // Form submission handler from the hook
        isLoading,           // Loading state from the hook
        error,               // Error state from the hook
        // reload,           // Function to reload last response
        // stop,             // Function to stop generation
    } = useAiChat({
        api: '/api/chat', // Target API endpoint
        // Send providerId and modelId in the body with each request
        body: {
            providerId: currentProviderId,
            modelId: currentModelId,
        },
        // We manage initial messages via context loading, so start empty here
        initialMessages: [],
        // Optional: Handle errors from the hook
        onError: (err) => {
            console.error("Error from useAiChat:", err);
            // Optionally display error to user
        },
        // Optional: Handle stream finishing
        onFinish: (message) => {
            console.log("useAiChat stream finished. Final message:", message);
            // Potentially sync final message back to ChatContext if needed for saving
            // This requires careful state management to avoid loops/conflicts
        }
    });

    const messagesEndRef = useRef<null | HTMLDivElement>(null); // Ref for scrolling

    // Scroll to bottom effect - depends on aiMessages now
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [aiMessages]);

    // Map aiMessages to MessageData for rendering with existing Message component
    const displayMessages = aiMessages.map(mapAiMessageToMessageData);

    // Wrapper for form submission to potentially add custom logic if needed
    const handleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault(); // Prevent default form submission
        handleAiSubmit(e); // Call the hook's submit handler
    };

    // Wrapper for ChatInput's onSend if it expects a string argument
    const handleSendWrapper = (text: string) => {
        // The hook's handleSubmit doesn't need the text directly if using the bound input
        // We simulate a form submission event
        const fakeForm = document.createElement('form');
        const fakeEvent = new Event('submit', { bubbles: true, cancelable: true }) as unknown as FormEvent<HTMLFormElement>;
        Object.defineProperty(fakeEvent, 'target', { value: fakeForm, enumerable: true });
        handleAiSubmit(fakeEvent);
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
                    // Regular Message Display using messages from useAiChat
                    <div className="space-y-2">
                        {displayMessages.map((msg, index) => (
                            <Message
                                key={aiMessages[index].id} // Use stable ID from ai/react message
                                sender={msg.sender}
                                text={msg.text}
                            />
                        ))}
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area Container - Use a form for handleSubmit */}
            {/* Use a form element to work naturally with useAiChat's handleSubmit */}
            <form onSubmit={handleFormSubmit} className="relative mb-2">
                <ChatInput
                    value={input} // Use input from useAiChat
                    onChange={handleInputChange} // Use handler from useAiChat
                    // onSend needs to trigger form submission
                    onSend={handleSendWrapper} // Use wrapper to trigger submit
                />
                {/* Submit button could be added inside ChatInput or here if needed */}
                {/* <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-2">Send</button> */}
            </form>

            {/* Status Display Area */}
            <div className="text-center text-xs text-gray-500 dark:text-gray-400 pt-1 h-5">
                {isLoading ? "Generating response..." : error ? `Error: ${error.message}` : ""}
            </div>
            {/* Placeholder for height consistency */}
            {!isLoading && !error && <div className="h-5 pt-1"></div>}
        </div>
    );
};

export default ChatInterface;