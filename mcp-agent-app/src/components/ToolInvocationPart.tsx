import React, { useState } from 'react';

// Define a more specific type if possible, otherwise use 'any'
interface ToolInvocationPartProps {
    toolInvocation: {
        state: 'call' | 'result';
        toolCallId: string;
        toolName: string;
        args: any;
        result?: any; // Only present when state is 'result'
    };
}

const ToolInvocationPart: React.FC<ToolInvocationPartProps> = ({ toolInvocation }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const toggleExpand = () => setIsExpanded(!isExpanded);

    const { state, toolName, args, result } = toolInvocation;

    const renderContent = () => {
        if (state === 'call') {
            return (
                <>
                    <span className="font-semibold">Calling tool:</span> {toolName}
                    {isExpanded && (
                        <div className="mt-1 p-2 bg-gray-200 dark:bg-gray-700 rounded text-xs overflow-auto max-h-32">
                            <span className="font-medium">Arguments:</span>
                            <pre className="whitespace-pre-wrap break-all">
                                {JSON.stringify(args, null, 2)}
                            </pre>
                        </div>
                    )}
                </>
            );
        } else if (state === 'result') {
            return (
                <>
                    <span className="font-semibold">Tool result:</span> {toolName}
                    {isExpanded && (
                        <div className="mt-1 p-2 bg-gray-200 dark:bg-gray-700 rounded text-xs overflow-auto max-h-48">
                            <span className="font-medium">Result Data:</span>
                            <pre className="whitespace-pre-wrap break-all">
                                {JSON.stringify(result, null, 2)}
                            </pre>
                        </div>
                    )}
                </>
            );
        }
        return null; // Should not happen based on type
    };

    return (
        <div className="my-2 p-2 border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm text-gray-700 dark:text-gray-300">
            <div
                className="flex justify-between items-center cursor-pointer"
                onClick={toggleExpand}
                title={isExpanded ? 'Collapse details' : 'Expand details'}
            >
                <div className="flex items-center space-x-2">
                    {/* Replaced placeholder with Cog icon (Heroicons outline style) */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="truncate">{renderContent()}</span>
                </div>
                {/* Expand/Collapse Icon */}
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
            </div>
        </div>
    );
};

export default ToolInvocationPart;