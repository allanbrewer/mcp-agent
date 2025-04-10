import React from 'react';

interface MessageProps {
    sender: 'user' | 'llm';
    text: string;
}

const Message: React.FC<MessageProps> = ({ sender, text }) => {
    const bgColor = sender === 'user' ? 'bg-blue-100' : 'bg-gray-100';
    const alignment = sender === 'user' ? 'self-end' : 'self-start';
    const textColor = sender === 'user' ? 'text-blue-900' : 'text-gray-900';

    return (
        <div className={`max-w-xs md:max-w-md lg:max-w-lg p-3 rounded-lg mb-2 ${alignment} ${bgColor} ${textColor}`}>
            {text}
        </div>
    );
};

export default Message;