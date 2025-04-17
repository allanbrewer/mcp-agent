"use client";

import React, { useState, useEffect, useRef } from 'react'; // Added useEffect, useRef
import Message from './Message';
import ChatInput from './ChatInput';

interface MessageData {
    sender: 'user' | 'llm';
    text: string;
}

const ChatInterface: React.FC = () => {
    const [messages, setMessages] = useState<MessageData[]>([
        { sender: 'llm', text: "Welcome! How can I assist you?" } // Initial welcome message
    ]);
    const [inputValue, setInputValue] = useState<string>('');
    const [backendStatus, setBackendStatus] = useState<string | null>(null); // State for backend status
    const messagesEndRef = useRef<null | HTMLDivElement>(null); // Ref for scrolling

    const handleSendMessage = (text: string) => { // Removed async
        if (!text.trim()) return;

        const newUserMessage: MessageData = { sender: 'user', text };
        // Add user message and an initial empty placeholder for the LLM response
        const updatedMessages = [...messages, newUserMessage, { sender: 'llm' as const, text: '' }]; // Explicitly type sender
        setMessages(updatedMessages);
        setInputValue('');
        setBackendStatus('Connecting...'); // Initial status

        const eventSource = new EventSource('/api/chat', {
            // EventSource doesn't directly support sending POST body in the standard way.
            // We need to pass the data via query parameters or use a different approach if large data is needed.
            // For simplicity, let's assume the backend can handle GET or we adjust later.
            // A common workaround is to initiate the SSE connection and then send the data via a separate POST.
            // Here, we'll stick to the standard EventSource which uses GET.
            // The backend needs to be adapted to read messages from context/session or another mechanism if GET is used.
            // *** OR *** we can use fetch with a ReadableStream response (more complex).
            // Let's proceed assuming the backend /api/chat can handle the POST request body even when establishing SSE
            // (This is non-standard but some frameworks might allow it, or we adjust backend later)
            // **Correction**: Standard EventSource uses GET. We MUST adapt the backend or use a fetch-based stream approach.
            // Let's switch to using fetch to handle POST and read the stream.

        });

        // --- Using Fetch API for SSE Stream Handling ---
        fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream' // Indicate we expect an SSE stream
            },
            body: JSON.stringify({ messages: updatedMessages.slice(0, -1) }), // Send history *before* the placeholder LLM message
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
                            // Check if the last message is still empty (error before any text?)
                            setMessages(prev => {
                                const lastMsg = prev[prev.length - 1];
                                if (lastMsg && lastMsg.sender === 'llm' && lastMsg.text === '') {
                                    // Remove empty placeholder if stream ends without content
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

                                    if (eventType === 'status' || eventType === 'log') {
                                        setBackendStatus(parsedData.message || 'Processing...');
                                    } else if (eventType === 'llm_chunk') {
                                        setMessages(prevMessages => {
                                            const lastMessageIndex = prevMessages.length - 1;
                                            // Ensure we are updating the placeholder LLM message
                                            if (lastMessageIndex >= 0 && prevMessages[lastMessageIndex].sender === 'llm') {
                                                const updatedMessages = [...prevMessages];
                                                updatedMessages[lastMessageIndex] = {
                                                    ...updatedMessages[lastMessageIndex],
                                                    text: updatedMessages[lastMessageIndex].text + parsedData.text,
                                                };
                                                return updatedMessages;
                                            }
                                            return prevMessages; // Should not happen if placeholder was added correctly
                                        });
                                    } else if (eventType === 'error') {
                                        console.error('SSE Error Event:', parsedData.message);
                                        setBackendStatus(`Error: ${parsedData.message}`);
                                        // Add error message to chat?
                                        setMessages(prev => [...prev.slice(0, -1), { sender: 'llm' as const, text: `Sorry, an error occurred: ${parsedData.message}` }]); // Explicitly type sender
                                        reader.cancel(); // Stop reading on error
                                        return; // Stop processing chunks
                                    }
                                } catch (e) {
                                    console.error('Error parsing SSE data:', e, 'Data:', eventData);
                                }
                            }
                            eventBoundary = buffer.indexOf('\n\n'); // Look for next event
                        }
                        processChunk(); // Continue processing
                    }).catch(error => {
                        console.error('Error reading stream:', error);
                        setBackendStatus(`Stream error: ${error.message}`);
                        setMessages(prev => [...prev.slice(0, -1), { sender: 'llm' as const, text: `Sorry, a stream error occurred: ${error.message}` }]); // Explicitly type sender
                    });
                }
                processChunk(); // Start processing the stream

            })
            .catch(error => {
                console.error('Error sending message or establishing stream:', error);
                setBackendStatus(`Connection error: ${error.message}`);
                // Remove the placeholder and add error message
                setMessages(prevMessages => [...prevMessages.slice(0, -1), { sender: 'llm' as const, text: `Sorry, could not connect: ${error.message}` }]); // Explicitly type sender
            });
    };

    // Scroll to bottom effect
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]); // Scroll when messages change

    const handleInputChange = (value: string) => {
        setInputValue(value);
    };

    return (
        // Adjusted container: removed outer bg/margin, added padding, changed max-width
        <div className="flex flex-col h-full w-full max-w-5xl mx-auto px-4 pt-6 pb-2">
            {/* Message display area - adjusted padding/spacing */}
            <div className="flex-grow overflow-y-auto mb-4 pr-2 space-y-2"> {/* Reduced space-y, added pr for scrollbar */}
                {messages.map((msg, index) => (
                    <Message key={index} sender={msg.sender} text={msg.text} />
                ))}
                {/* Dummy div to target for scrolling */}
                <div ref={messagesEndRef} />
            </div>

            {/* Chat input area */}
            <ChatInput
                value={inputValue}
                onChange={handleInputChange}
                onSend={handleSendMessage}
            />
            {/* Status Display Area */}
            {backendStatus && (
                <div className="text-center text-xs text-gray-500 dark:text-gray-400 pt-1 h-5">
                    {backendStatus}
                </div>
            )}
            {!backendStatus && <div className="h-5 pt-1"></div>} {/* Placeholder for height consistency */}
        </div>
    );
};

export default ChatInterface;