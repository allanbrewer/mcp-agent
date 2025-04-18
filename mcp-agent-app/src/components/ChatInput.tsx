import React from 'react';
import TextareaAutosize from 'react-textarea-autosize'; // Import the component

interface ChatInputProps {
    value: string;
    onChange: (value: string) => void;
    onSend: (text: string) => void;
}

const ChatInput: React.FC<ChatInputProps> = ({ value, onChange, onSend }) => {
    const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => { // Changed to HTMLTextAreaElement
        onChange(event.target.value);
    };

    const handleSendClick = () => {
        if (value.trim()) { // Prevent sending empty messages
            onSend(value);
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Send on Enter key press, but allow Shift+Enter for new lines
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault(); // Prevent default Enter behavior (new line)
            handleSendClick();
        }
    };

    return (
        // Simplified container: removed outer div, added border to inner div
        <div className="flex items-end p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"> {/* Added border, kept bg for contrast */}
            <TextareaAutosize
                minRows={1} // Start with a single row
                maxRows={6} // Limit vertical expansion
                placeholder="Type your message..."
                className="flex-grow p-2 bg-transparent text-gray-900 dark:text-gray-100 dark:placeholder-gray-400 focus:outline-none resize-none overflow-y-auto" // Kept mostly the same
                value={value}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown} // Use the updated handler
            />
            <button
                className="ml-2 p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-md disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-blue-500" // Simplified button: less padding, text color based, subtle hover, focus ring
                onClick={handleSendClick}
                disabled={!value.trim()} // Disable button if input is empty
            >
                {/* Send Icon */}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                </svg>
            </button>
        </div>
    );
};

export default ChatInput;