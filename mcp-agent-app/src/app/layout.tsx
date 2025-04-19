"use client"; // Make layout a Client Component to manage state

import type { Metadata } from "next"; // Keep for potential static metadata
import React from 'react'; // No longer need useState here
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar"; // Import the Sidebar component
import { ChatProvider } from "@/context/ChatContext"; // Import the provider

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// export const metadata: Metadata = { ... }; // Static metadata can still be defined

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // State and handlers are now managed by ChatProvider

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-950`} // Added default text/bg colors
      >
        <ChatProvider> {/* Wrap content with the provider */}
          <div className="flex h-screen overflow-hidden">
            {/* Sidebar now uses context, no props needed here */}
            <Sidebar />
            <main className="flex-1 overflow-y-auto"> {/* Main content area */}
              {/* Children (page) will also use context */}
              {children}
            </main>
          </div>
        </ChatProvider>
      </body>
    </html>
  );
}
