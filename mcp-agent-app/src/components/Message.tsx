import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MessageProps {
    sender: 'user' | 'llm';
    text: string;
}

const Message: React.FC<MessageProps> = ({ sender, text }) => {
    const isUser = sender === 'user';

    // Define base styles
    const alignment = isUser ? 'self-end' : 'self-start';
    // Adjusted max-width based on previous feedback
    const baseClasses = 'max-w-xl md:max-w-2xl lg:max-w-3xl p-3 rounded-lg mb-2';

    // Define light and dark mode styles conditionally
    const userStyles = 'bg-blue-100 dark:bg-slate-700 text-gray-900 dark:text-gray-100';
    const llmStyles = 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100';

    const combinedClasses = `${baseClasses} ${alignment} ${isUser ? userStyles : llmStyles}`;

    // Markdown component overrides for styling - Enhanced for spacing/indentation
    const markdownComponents = {
        // Headings: Add vertical margins
        h1: ({ node, ...props }: any) => <h1 className="text-2xl font-bold my-4" {...props} />,
        h2: ({ node, ...props }: any) => <h2 className="text-xl font-semibold my-3" {...props} />,
        h3: ({ node, ...props }: any) => <h3 className="text-lg font-semibold my-2" {...props} />,
        h4: ({ node, ...props }: any) => <h4 className="text-base font-semibold my-2" {...props} />,
        h5: ({ node, ...props }: any) => <h5 className="text-sm font-semibold my-1" {...props} />,
        h6: ({ node, ...props }: any) => <h6 className="text-xs font-semibold my-1" {...props} />,

        // Lists: Add padding for indentation and margins
        ul: ({ node, ...props }: any) => <ul className="list-disc pl-6 my-2" {...props} />,
        ol: ({ node, ...props }: any) => <ol className="list-decimal pl-6 my-2" {...props} />,
        li: ({ node, ...props }: any) => <li className="mb-1" {...props} />,

        // Code Blocks: Keep previous styling
        pre: ({ node, ...props }: any) => <pre className="bg-gray-200 dark:bg-gray-900 p-3 rounded my-2 overflow-x-auto text-sm font-mono text-gray-800 dark:text-gray-200" {...props} />,
        code: ({ node, inline, className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || '');
            return !inline ? (
                <code className={`block ${className || ''}`} {...props}>
                    {children}
                </code>
            ) : (
                <code className={`text-sm font-mono bg-gray-200 dark:bg-gray-700 rounded px-1 py-0.5 ${className || ''}`} {...props}>
                    {children}
                </code>
            );
        },
        // Links: Keep previous styling
        a: ({ node, ...props }: any) => <a className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
        // Paragraphs: Add slight bottom margin for spacing
        p: ({ node, ...props }: any) => <p className="mb-2" {...props} />,
    };

    return (
        <div className={combinedClasses}>
            {isUser ? (
                // Render user messages as plain text
                <p className="whitespace-pre-wrap">{text}</p>
            ) : (
                // Render LLM messages using ReactMarkdown with enhanced components
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                >
                    {text}
                </ReactMarkdown>
            )}
        </div>
    );
};

export default Message;