"use client";

import React, { useState, useEffect, useRef } from 'react';
import Message from './Message';
import ChatInput from './ChatInput';
import { useChat, MessageData } from '@/context/ChatContext'; // Import context hook and MessageData type

// No longer needs props

const ChatInterface: React.FC = () => {
    // Get state and actions from context
    // Removed saveCurrentChat as it's handled by Sidebar now
    const { currentChatId, messages, setMessages, currentModelId } = useChat(); // Add currentModelId

    // Local state for input and UI status
    const [inputValue, setInputValue] = useState<string>('');
    const [backendStatus, setBackendStatus] = useState<string | null>(null); // For SSE status
    // Removed isSaving state
    const messagesEndRef = useRef<null | HTMLDivElement>(null); // Ref for scrolling
    const eventSourceRef = useRef<EventSource | null>(null); // Ref to manage EventSource lifecycle

    // Remove useEffect for loading history - context handles it via loadChat action
    // Removed handleSaveChat function

    const handleSendMessage = (text: string) => {
        // Prevent sending if loading history (handled by context now?)
        if (!text.trim()) return;

        const newUserMessage: MessageData = { sender: 'user', text };
        // Add user message and an initial empty placeholder for the LLM response
        // Update context state directly
        const currentMessages = [...messages, newUserMessage];
        setMessages([...currentMessages, { sender: 'llm' as const, text: '' }]); // Add placeholder to context state

        setInputValue('');
        setBackendStatus('Connecting...'); // Initial status

        // --- Using Fetch API for SSE Stream Handling ---
        fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            // Send history *before* the placeholder LLM message
            // Use the state *before* adding the placeholder
            // Include the currentModelId from context
            body: JSON.stringify({ messages: currentMessages, modelId: currentModelId }),
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`API request failed: ${response.statusText}`);
                }
                if (!response.body) {
                    throw new Error('Response body is null');
                }

                setBackendStatus('Receiving response...'); // Update status

                const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
                let buffer = '';

                function processChunk() {
                    reader.read().then(({ done, value }) => {
                        if (done) {
                            console.log('Stream finished.');
                            setBackendStatus(null); // Clear status on stream end
                            // Check if the last message is still empty and remove placeholder from context
                            setMessages(prev => {
                                const lastMsg = prev[prev.length - 1];
                                if (lastMsg && lastMsg.sender === 'llm' && lastMsg.text === '') {
                                    return prev.slice(0, -1);
                                }
                                return prev;
                            });
                            return;
                        }

                        buffer += value;
                        let eventBoundary = buffer.indexOf('\n\n');

                        while (eventBoundary !== -1) {
                            const eventString = buffer.substring(0, eventBoundary);
                            buffer = buffer.substring(eventBoundary + 2); // Move past the '\n\n'

                            let eventType = 'message'; // Default type
                            let eventData = '';

                            eventString.split('\n').forEach(line => {
                                if (line.startsWith('event:')) {
                                    eventType = line.substring(6).trim();
                                } else if (line.startsWith('data:')) {
                                    eventData = line.substring(5).trim();
                                }
                            });

                            if (eventData) {
                                try {
                                    const parsedData = JSON.parse(eventData);
                                    console.log(`SSE Event (${eventType}):`, parsedData);

                                    // --- Event Handling Logic ---
                                    if (eventType === 'status' || eventType === 'log') {
                                        setBackendStatus(parsedData.message || 'Processing...');
                                    } else if (eventType === 'tool_completed') {
                                        const newToolMessage: MessageData = {
                                            sender: 'tool' as const,
                                            text: parsedData.summary || 'Tool execution completed.',
                                        };
                                        // Update context state
                                        setMessages(prev => [
                                            ...prev.slice(0, -1),
                                            newToolMessage,
                                            prev[prev.length - 1]
                                        ]);
                                        setBackendStatus(null);
                                    } else if (eventType === 'llm_chunk') {
                                        // Update context state
                                        setMessages(prevMessages => {
                                            const lastMessageIndex = prevMessages.length - 1;
                                            if (lastMessageIndex >= 0 && prevMessages[lastMessageIndex].sender === 'llm') {
                                                const updatedMessages = [...prevMessages];
                                                updatedMessages[lastMessageIndex] = {
                                                    ...updatedMessages[lastMessageIndex],
                                                    text: updatedMessages[lastMessageIndex].text + parsedData.text,
                                                };
                                                if (backendStatus !== null) setBackendStatus('Generating response...');
                                                return updatedMessages;
                                            }
                                            return prevMessages;
                                        });
                                    } else if (eventType === 'error') {
                                        console.error('SSE Error Event:', parsedData.message);
                                        setBackendStatus(`Error: ${parsedData.message}`);
                                        // Update context state
                                        setMessages(prev => [...prev.slice(0, -1), { sender: 'llm' as const, text: `Sorry, an error occurred: ${parsedData.message}` }]);
                                        reader.cancel();
                                        return;
                                    }
                                } catch (e) {
                                    console.error('Error parsing SSE data:', e, 'Data:', eventData);
                                }
                            }
                            eventBoundary = buffer.indexOf('\n\n');
                        }
                        processChunk();
                    }).catch(error => {
                        console.error('Error reading stream:', error);
                        setBackendStatus(`Stream error: ${error.message}`);
                        // Update context state
                        setMessages(prev => [...prev.slice(0, -1), { sender: 'llm' as const, text: `Sorry, a stream error occurred: ${error.message}` }]);
                    });
                }
                processChunk();

            })
            .catch(error => {
                console.error('Error sending message or establishing stream:', error);
                setBackendStatus(`Connection error: ${error.message}`);
                // Update context state
                setMessages(prevMessages => [...prevMessages.slice(0, -1), { sender: 'llm' as const, text: `Sorry, could not connect: ${error.message}` }]);
            });
    };

    // Scroll to bottom effect
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]); // Scroll when messages (from context) change

    const handleInputChange = (value: string) => {
        setInputValue(value);
    };

    return (
        // Adjusted container
        <div className="flex flex-col h-full w-full max-w-5xl mx-auto px-4 pt-6 pb-2">
            {/* Message display area */}
            <div className="flex-grow overflow-y-auto mb-4 pr-2 space-y-2">
                {messages.map((msg, index) => (
                    <Message
                        key={index} // Consider more stable key if messages can be reordered/deleted
                        sender={msg.sender}
                        text={msg.text}
                    />
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area Container */}
            <div className="relative mb-2">
                {/* Chat input area */}
                <ChatInput
                    value={inputValue}
                    onChange={handleInputChange}
                    onSend={handleSendMessage}
                />
                {/* Save Chat Button Removed */}
            </div>

            {/* Status Display Area */}
            <div className="text-center text-xs text-gray-500 dark:text-gray-400 pt-1 h-5">
                {/* Context doesn't expose isLoadingHistory, rely on backendStatus */}
                {backendStatus || ""}
            </div>
            {/* Placeholder for height consistency if nothing is displayed */}
            {!backendStatus && <div className="h-5 pt-1"></div>}
        </div>
    );
};

export default ChatInterface;