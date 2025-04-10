import React from 'react';

interface ChatInputProps {
    value: string;
    onChange: (value: string) => void;
    onSend: (text: string) => void;
}

const ChatInput: React.FC<ChatInputProps> = ({ value, onChange, onSend }) => {
    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        onChange(event.target.value);
    };

    const handleSendClick = () => {
        onSend(value);
    };

    return (
        <div className="p-4 bg-white border-t border-gray-200 flex items-center">
            <input
                type="text"
                placeholder="Type your message..."
                className="flex-grow p-2 border border-gray-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                value={value}
                onChange={handleInputChange}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSendClick(); }} // Optional: Send on Enter key
            />
            <button
                className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-r-md"
                onClick={handleSendClick}
            >
                Send
            </button>
        </div>
    );
};

export default ChatInput;