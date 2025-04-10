import ChatInterface from '@/components/ChatInterface'; // Assuming '@/' resolves to 'src/' based on standard Next.js setup

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between">
      <ChatInterface />
    </main>
  );
}
