"use client";

import React, { useEffect, useRef, FormEvent } from 'react';
import Message from './Message';
import ChatInput from './ChatInput';
// Import Attachment type defined in ChatContext
import { useChat as useChatContext, type Attachment } from '@/context/ChatContext';
import ToolInvocationPart from './ToolInvocationPart';

// Define Attachment type locally matching the one in ChatContext
// interface AttachmentForSubmit {
//     name?: string;
//     contentType?: string;
//     url: string; // This will be the Data URL
// }


const ChatInterface: React.FC = () => {
    // Destructure everything needed directly from the context
    const {
        messages, // These are AiMessage[] from the hook inside the context
        input,
        handleInputChange,
        handleSubmit, // This now correctly accepts the options object
        status,
        error,
        stop, // <<< Get stop function from context
    } = useChatContext();

    const messagesEndRef = useRef<null | HTMLDivElement>(null);

    // Scroll to bottom effect - depends on messages from context
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // This form wrapper is likely redundant now, relying on button click
    // const handleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    //     e.preventDefault();
    //     handleSubmit(e);
    // };

    // Wrapper for ChatInput's onSend, now accepting an array of files
    const handleSendWrapper = (text: string, files?: { name: string; type: string; dataUrl: string }[]) => {

        // Prepare attachments array if files exist
        let attachmentsForSubmit: Attachment[] | undefined = undefined;
        if (files && files.length > 0) {
            attachmentsForSubmit = files.map(file => ({
                name: file.name,
                contentType: file.type,
                url: file.dataUrl
            }));
        }

        // Update the input state with ONLY the text part
        const syntheticEvent = {
            target: { value: text } // Only pass the typed text
        } as React.ChangeEvent<HTMLTextAreaElement>;
        handleInputChange(syntheticEvent);

        // Use a minimal timeout to allow state update before submitting
        setTimeout(() => {
            // Simulate form submission event for the first argument
            const fakeForm = document.createElement('form');
            const fakeEvent = {
                preventDefault: () => { },
                currentTarget: fakeForm,
            } as unknown as FormEvent<HTMLFormElement>;

            // Call handleSubmit from context with the event and the options object
            handleSubmit(fakeEvent, {
                experimental_attachments: attachmentsForSubmit
            });
        }, 0);
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
                            // --- Render User Message ---
                            if (msg.role === 'user') {
                                return (
                                    <Message
                                        key={msg.id}
                                        sender="user"
                                        text={msg.content}
                                    // TODO: Add rendering for attachments if needed here
                                    // attachments={msg.experimental_attachments}
                                    />
                                );
                            }
                            // --- Render Assistant Message ---
                            else if (msg.role === 'assistant') {
                                // Check for parts - render parts if they exist
                                if (msg.parts && msg.parts.length > 0) {
                                    return (
                                        <React.Fragment key={`${msg.id}-parts`}>
                                            {msg.parts.map((part, index) => {
                                                if (part.type === 'text') {
                                                    // Render text part using Message component styling
                                                    // Only render if text is not empty, as parts might contain only tool calls
                                                    if (part.text.trim()) {
                                                        return (
                                                            <Message
                                                                key={`${msg.id}-part-${index}-text`}
                                                                sender="llm"
                                                                text={part.text}
                                                            />
                                                        );
                                                    }
                                                    return null; // Don't render empty text parts
                                                } else if (part.type === 'tool-invocation') {
                                                    // Render tool invocation part
                                                    return (
                                                        <ToolInvocationPart
                                                            key={`${msg.id}-part-${index}-tool`}
                                                            toolInvocation={part.toolInvocation as any} // Cast for now
                                                        />
                                                    );
                                                }
                                                // Add rendering for other part types if needed (e.g., step-start)
                                                // else if (part.type === 'step-start' && index > 0) {
                                                //     return <hr key={`${msg.id}-part-${index}-step`} className="my-2 border-gray-300 dark:border-gray-600" />;
                                                // }
                                                return null;
                                            })}
                                        </React.Fragment>
                                    );
                                } else {
                                    // Fallback: Render assistant message content directly if no parts
                                    // Only render if content is not empty
                                    if (msg.content.trim()) {
                                        return (
                                            <Message
                                                key={`${msg.id}-content`}
                                                sender="llm"
                                                text={msg.content}
                                            />
                                        );
                                    }
                                    return null; // Don't render empty assistant messages
                                }
                            }
                            // Ignore other roles like 'system', 'tool' for display for now
                            return null;
                        })}
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area Container - Removed form wrapper, rely on button click */}
            <div className="relative mb-2">
                <ChatInput
                    value={input}
                    onChange={handleInputChange}
                    onSend={handleSendWrapper} // Pass the updated wrapper
                    status={status}
                    onStop={stop}
                />
            </div>

            {/* Status Display Area */}
            <div className="text-center text-xs text-gray-500 dark:text-gray-400 pt-1 h-5">
                {status === 'streaming' || status === 'submitted' ? (() => {
                    const lastUserMessageIndex = messages.findLastIndex(m => m.role === 'user');
                    let stepCount = 0;
                    if (lastUserMessageIndex !== -1) {
                        for (let i = lastUserMessageIndex + 1; i < messages.length; i++) {
                            const msg = messages[i];
                            if (msg.role === 'assistant' && msg.parts) {
                                stepCount += msg.parts.filter(p => p.type === 'tool-invocation').length;
                            }
                        }
                    }
                    const displayStep = stepCount > 0 ? ` (Step ${stepCount})` : '';
                    return (
                        <span className="inline-flex items-center animate-text-gradient">
                            Thinking{displayStep}...
                        </span>
                    );
                })() : error ? (
                    `Error: ${error.message}`
                ) : (
                    ""
                )}
            </div>
            {/* Placeholder for height consistency */}
            {status === 'ready' && !error && <div className="h-5 pt-1"></div>}
        </div>
    );
};

export default ChatInterface;