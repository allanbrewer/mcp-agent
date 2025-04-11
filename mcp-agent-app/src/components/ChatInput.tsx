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
        // Container for the input area - removed top border, added padding, rounded corners, and background
        <div className="p-2 bg-white dark:bg-gray-800">
            <div className="flex items-end p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                <TextareaAutosize
                    minRows={1} // Start with a single row
                    maxRows={6} // Limit vertical expansion
                    placeholder="Type your message..."
                    className="flex-grow p-2 bg-transparent text-gray-900 dark:text-gray-100 dark:placeholder-gray-400 focus:outline-none resize-none overflow-y-auto" // Removed border, added resize-none
                    value={value}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown} // Use the updated handler
                />
                <button
                    className="ml-2 p-2 bg-slate-500 hover:bg-slate-600 dark:bg-slate-600 dark:hover:bg-slate-700 text-white font-semibold rounded-lg disabled:opacity-50" // Adjusted colors, padding, rounded corners, added disabled state
                    onClick={handleSendClick}
                    disabled={!value.trim()} // Disable button if input is empty
                >
                    {/* Simple Send Icon (SVG or similar could be used here) */}
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                    </svg>
                </button>
            </div>
        </div>
    );
};

export default ChatInput;