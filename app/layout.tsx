import './globals.css';
import type { Metadata } from 'next';
import { Sidebar } from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'THE SYNDICATE — NHL Betting Intelligence',
  description: 'Multi-agent sports betting intelligence system. Beat the closing line.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-x-hidden">{children}</main>
        </div>
      </body>
    </html>
  );
}
