"use client";

import React, { useEffect, useRef, FormEvent } from 'react';
import Message from './Message';
import ChatInput from './ChatInput';
import { useChat as useChatContext } from '@/context/ChatContext';
import ToolInvocationPart from './ToolInvocationPart';

const ChatInterface: React.FC = () => {
    // Destructure everything needed directly from the context
    const {
        messages, // These are AiMessage[] from the hook inside the context
        input,
        handleInputChange,
        handleSubmit,
        status,
        error,
    } = useChatContext();

    const messagesEndRef = useRef<null | HTMLDivElement>(null);

    // Scroll to bottom effect - depends on messages from context
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

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
                {messages.length === 0 ? (
                    // Initial Welcome Message State
                    <div className="flex-grow flex flex-col items-center justify-center text-center">
                        <h1 className="text-4xl font-semibold animate-text-gradient">
                            Welcome Allan! How can I assist you?
                        </h1>
                    </div>
                ) : (
                    // Render messages directly, handling different roles and parts
                    <div className="space-y-2">
                        {messages.map((msg) => {
                            if (msg.role === 'user') {
                                return (
                                    <Message
                                        key={msg.id}
                                        sender="user"
                                        text={msg.content}
                                    />
                                );
                            } else if (msg.role === 'assistant') {
                                // Check for parts - render parts if they exist
                                if (msg.parts && msg.parts.length > 0) {
                                    // Wrap the mapped parts in a Fragment with a key
                                    return (
                                        <React.Fragment key={`${msg.id}-parts`}>
                                            {msg.parts.map((part, index) => {
                                                if (part.type === 'text') {
                                                    // Render text part using Message component styling
                                                    return (
                                                        <Message
                                                            key={`${msg.id}-part-${index}`}
                                                            sender="llm"
                                                            text={part.text}
                                                        />
                                                    );
                                                } else if (part.type === 'tool-invocation') {
                                                    // Render tool invocation part using new component
                                                    return (
                                                        <ToolInvocationPart
                                                            key={`${msg.id}-part-${index}`}
                                                            toolInvocation={part.toolInvocation as any} // Use 'any' for now
                                                        />
                                                    );
                                                }
                                                return null; // Handle other part types if necessary
                                            })}
                                        </React.Fragment>
                                    );
                                } else {
                                    // Fallback: Render assistant message content directly if no parts
                                    return (
                                        <Message
                                            key={msg.id} // Corrected key
                                            sender="llm"
                                            text={msg.content} // Corrected content source
                                        />
                                    );
                                }
                            }
                            // Ignore other roles like 'system', 'tool' for now
                            return null;
                        })}
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

            {/* Status Display Area - Use correct status values and add pulsing dots */}
            <div className="text-center text-xs text-gray-500 dark:text-gray-400 pt-1 h-5">
                {status === 'streaming' || status === 'submitted' ? (
                    <span className="inline-flex items-center">
                        Thinking
                        <span className="animate-pulse delay-0 duration-1000">.</span>
                        <span className="animate-pulse delay-150 duration-1000">.</span>
                        <span className="animate-pulse delay-300 duration-1000">.</span>
                    </span>
                ) : error ? (
                    `Error: ${error.message}`
                ) : (
                    ""
                )}
            </div>
            {/* Placeholder for height consistency - simplified */}
            {status === 'ready' && !error && <div className="h-5 pt-1"></div>}
        </div>
    ); // Ensure closing parenthesis is present
}; // Ensure closing brace is present

export default ChatInterface;