import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Fingerprint, BrainCircuit, Plug } from 'lucide-react'; // Added Plug icon

interface MessageProps {
    sender: 'user' | 'llm' | 'tool'; // Added 'tool' sender type
    text: string;
    // Removed displayHint prop
}

const Message: React.FC<MessageProps> = ({ sender, text }) => { // Removed displayHint
    const isUser = sender === 'user';
    const isTool = sender === 'tool';

    // Define base styles
    // Define alignment for the outer container (icon + message bubble)
    // Container alignment: user right, llm/tool left
    const containerAlignment = isUser ? 'justify-end' : 'justify-start';
    // Bubble alignment: user right, llm/tool left
    const bubbleAlignment = isUser ? 'self-end' : 'self-start';
    // Base classes for the bubble
    const bubbleBaseClasses = 'max-w-xl md:max-w-2xl lg:max-w-3xl p-2 rounded-md border shadow-sm'; // Base styles

    // Conditional bubble styling
    const bubbleUserStyles = 'border-blue-200 dark:border-blue-800/60 bg-white dark:bg-slate-900'; // User specific border/bg
    const bubbleLlmStyles = 'border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800/50'; // LLM specific border/bg
    const bubbleToolStyles = 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 italic text-gray-600 dark:text-gray-400 text-sm'; // Tool specific border/bg/text style

    // Removed user/llm specific background styles

    // Combine bubble classes based on sender
    const bubbleCombinedClasses = `${bubbleBaseClasses} ${bubbleAlignment} ${isUser ? bubbleUserStyles : (isTool ? bubbleToolStyles : bubbleLlmStyles)}`;

    // Markdown component overrides for styling - Enhanced for spacing/indentation
    const markdownComponents = {
        // Reduced vertical margins for headings
        h1: ({ node, ...props }: any) => <h1 className="text-2xl font-bold my-2" {...props} />,
        h2: ({ node, ...props }: any) => <h2 className="text-xl font-semibold my-2" {...props} />,
        h3: ({ node, ...props }: any) => <h3 className="text-lg font-semibold my-1" {...props} />,
        h4: ({ node, ...props }: any) => <h4 className="text-base font-semibold my-1" {...props} />,
        h5: ({ node, ...props }: any) => <h5 className="text-sm font-semibold my-1" {...props} />,
        h6: ({ node, ...props }: any) => <h6 className="text-xs font-semibold my-1" {...props} />,

        // Reduced list padding/margins
        ul: ({ node, ...props }: any) => <ul className="list-disc pl-5 my-1" {...props} />,
        ol: ({ node, ...props }: any) => <ol className="list-decimal pl-5 my-1" {...props} />,
        li: ({ node, ...props }: any) => <li className="mb-0.5" {...props} />,

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
                ) : isTool ? (
                    <Plug className="text-gray-500 dark:text-gray-400" />
                ) : ( // LLM
                    <BrainCircuit className="text-gray-600 dark:text-gray-400" />
                )}
            </div>

            {/* Message Bubble */}
            <div className={bubbleCombinedClasses}>
                {/* Content Rendering */}
                {isUser ? (
                    // User message: Plain text
                    <p className="whitespace-pre-wrap text-gray-900 dark:text-gray-100">{text}</p>
                ) : isTool ? (
                    // Tool message: Plain text (already styled via bubbleCombinedClasses)
                    <p className="whitespace-pre-wrap">{text}</p>
                ) : ( // LLM message - Always render as Markdown now
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {text}
                        </ReactMarkdown>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Message;