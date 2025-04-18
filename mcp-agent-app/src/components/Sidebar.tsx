"use client"; // Required for useState

import React, { useState, useEffect } from 'react'; // Import useEffect
import Link from 'next/link';
// Placeholder icons - replace with actual icons later (e.g., from lucide-react)
import { MessageSquare, PanelLeftClose, PanelRightClose, BrainCircuit } from 'lucide-react'; // Changed Bot to BrainCircuit

const Sidebar: React.FC = () => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [hasMounted, setHasMounted] = useState(false); // State to track client mount

    useEffect(() => {
        setHasMounted(true); // Set mounted state after initial render
    }, []);

    return (
        // Apply width class only after mount to prevent hydration mismatch
        <div className={`transition-all duration-300 ease-in-out flex flex-col h-screen bg-gray-100 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 ${hasMounted ? (isExpanded ? 'w-64' : 'w-20') : 'w-20'}`}>
            {/* Header */}
            <div className="flex items-center justify-between p-4 h-16 border-b border-gray-200 dark:border-gray-700">
                {/* Render expanded content only after mount */}
                {hasMounted && isExpanded && (
                    <div className="flex items-center space-x-2">
                        <BrainCircuit className="w-6 h-6 text-gray-800 dark:text-gray-200" /> {/* Changed Bot to BrainCircuit */}
                        <span className="font-semibold text-lg text-gray-800 dark:text-gray-200">MCP Agent</span>
                    </div>
                )}
                {/* Render placeholder or adjust layout if needed when collapsed/not mounted */}
                {(!hasMounted || !isExpanded) && <div className="w-6 h-6"></div>} {/* Placeholder to maintain layout */}

                {/* Toggle button - Render icon based on state only after mount */}
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="p-2 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none"
                    aria-label={hasMounted && isExpanded ? "Collapse sidebar" : "Expand sidebar"}
                >
                    {hasMounted && isExpanded ? <PanelLeftClose className="w-6 h-6" /> : <PanelRightClose className="w-6 h-6" />}
                </button>
            </div>

            {/* Navigation */}
            <nav className="flex-grow p-4 space-y-2">
                {/* Removed legacyBehavior and inner <a> tag */}
                <Link
                    href="/"
                    className="flex items-center p-2 space-x-3 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                    <MessageSquare className="w-6 h-6" />
                    {/* Render text only after mount and if expanded */}
                    {hasMounted && isExpanded && <span className="font-medium">Chat</span>}
                </Link>
                {/* Add more navigation items here later */}
            </nav>

            {/* Footer or other elements can go here */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                {/* Footer content if needed */}
            </div>
        </div>
    );
};

export default Sidebar;