"use client"; // Keep as client component if it needs client-side logic, otherwise can be server

// No longer need useState here
import React from 'react';
import ChatInterface from '@/components/ChatInterface';
import { useChat } from '@/context/ChatContext'; // Import the context hook

export default function Home() {
  // Get currentChatId from context to use as key
  const { currentChatId } = useChat();

  return (
    // The outer div and Sidebar rendering are handled by layout.tsx
    // This component now just renders the main content area's children
    // Adjust styling if needed, but flex-grow etc. should be in layout's <main>
    <>
      {/* Pass chatId to ChatInterface */}
      {/* Using key prop forces re-mount of ChatInterface on chat change, simplifying state reset */}
      {/* ChatInterface will get currentChatId from context internally */}
      {/* Still use key prop to force re-mount on chat change */}
      <ChatInterface key={currentChatId || 'new'} />
    </>
  );
}
