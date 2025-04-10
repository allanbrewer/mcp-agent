"use client";

import React, { useState } from 'react';
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

    const handleSendMessage = async (text: string) => {
        if (!text.trim()) return;

        const newUserMessage: MessageData = { sender: 'user', text };
        const updatedMessages = [...messages, newUserMessage];
        setMessages(updatedMessages);
        setInputValue('');

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ messages: updatedMessages }), // Send the updated message list
            });

            if (response.ok) {
                const data = await response.json();
                const replyMessage: MessageData = data.reply;
                setMessages(prevMessages => [...prevMessages, replyMessage]);
            } else {
                console.error('API request failed:', response.statusText);
                // Optionally add a user-facing error message to the chat
                setMessages(prevMessages => [...prevMessages, { sender: 'llm', text: 'Sorry, something went wrong.' }]);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            // Optionally add a user-facing error message to the chat
            setMessages(prevMessages => [...prevMessages, { sender: 'llm', text: 'Sorry, could not connect to the server.' }]);
        }
    };

    const handleInputChange = (value: string) => {
        setInputValue(value);
    };

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            {/* Message display area */}
            <div className="flex-grow overflow-y-auto p-4 space-y-4">
                {messages.map((msg, index) => (
                    <Message key={index} sender={msg.sender} text={msg.text} />
                ))}
            </div>

            {/* Chat input area */}
            <ChatInput
                value={inputValue}
                onChange={handleInputChange}
                onSend={handleSendMessage}
            />
        </div>
    );
};

export default ChatInterface;