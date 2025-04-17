import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Fingerprint, BrainCircuit } from 'lucide-react'; // Changed User to Fingerprint

interface MessageProps {
    sender: 'user' | 'llm';
    text: string;
}

const Message: React.FC<MessageProps> = ({ sender, text }) => {
    const isUser = sender === 'user';

    // Define base styles
    // Define alignment for the outer container (icon + message bubble)
    const containerAlignment = isUser ? 'justify-end' : 'justify-start';
    // Define alignment for the message bubble itself (already handled by self-start/end)
    const bubbleAlignment = isUser ? 'self-end' : 'self-start';
    // Adjusted max-width, padding, margin, added border and subtle shared background for the bubble
    const bubbleBaseClasses = 'max-w-xl md:max-w-2xl lg:max-w-3xl p-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800/50 shadow-sm'; // Reduced padding/margin, changed rounding, added border/bg/shadow

    // Removed user/llm specific background styles

    const bubbleCombinedClasses = `${bubbleBaseClasses} ${bubbleAlignment}`; // Classes for the message bubble itself

    // Markdown component overrides for styling - Enhanced for spacing/indentation
    const markdownComponents = {
        // Headings: Add vertical margins
        // Reduced vertical margins for headings
        h1: ({ node, ...props }: any) => <h1 className="text-2xl font-bold my-2" {...props} />,
        h2: ({ node, ...props }: any) => <h2 className="text-xl font-semibold my-2" {...props} />,
        h3: ({ node, ...props }: any) => <h3 className="text-lg font-semibold my-1" {...props} />,
        h4: ({ node, ...props }: any) => <h4 className="text-base font-semibold my-1" {...props} />,
        h5: ({ node, ...props }: any) => <h5 className="text-sm font-semibold my-1" {...props} />,
        h6: ({ node, ...props }: any) => <h6 className="text-xs font-semibold my-1" {...props} />,

        // Lists: Add padding for indentation and margins
        // Reduced list padding/margins
        ul: ({ node, ...props }: any) => <ul className="list-disc pl-5 my-1" {...props} />,
        ol: ({ node, ...props }: any) => <ol className="list-decimal pl-5 my-1" {...props} />,
        li: ({ node, ...props }: any) => <li className="mb-0.5" {...props} />,

        // Code Blocks: Keep previous styling
        // Simplified code block styling
        pre: ({ node, ...props }: any) => <pre className="bg-gray-100 dark:bg-gray-900/50 p-2 rounded my-1 whitespace-pre-wrap break-words text-sm font-mono text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700" {...props} />,
        code: ({ node, inline, className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || '');
            return (
                <code className={`blocktext-sm ${className || ''}`} {...props}>
                    {children}
                </code>
            );
        },
        // Links: Keep previous styling
        a: ({ node, ...props }: any) => <a className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
        // Paragraphs: Add slight bottom margin for spacing
        // Reduced paragraph margin
        p: ({ node, ...props }: any) => <p className="mb-1" {...props} />,
    };

    return (
        // Outer container for icon + message bubble
        <div className={`flex items-start space-x-2 mb-2 ${containerAlignment}`}>
            {/* Icon */}
            <div className={`flex-shrink-0 w-6 h-6 mt-1 ${isUser ? 'order-last ml-2' : 'mr-2'}`}> {/* Adjust margin/order based on sender */}
                {isUser ? (
                    <Fingerprint className="text-blue-600 dark:text-blue-400" />
                ) : (
                    <BrainCircuit className="text-gray-600 dark:text-gray-400" />
                )}
            </div>

            {/* Message Bubble */}
            <div className={bubbleCombinedClasses}>
                {isUser ? (
                    // Render user messages as plain text
                    <p className="whitespace-pre-wrap text-gray-900 dark:text-gray-100">{text}</p>
                ) : (
                    // Render LLM messages using ReactMarkdown with enhanced components
                    // Wrap with a div for prose styling
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                        >
                            {text}
                        </ReactMarkdown>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Message;