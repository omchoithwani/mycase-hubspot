import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Sidebar from '@/components/sidebar';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'MyCase ↔ HubSpot Sync',
  description: 'Bidirectional sync between HubSpot and MyCase',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${inter.className} bg-[#f8f9fc] text-slate-800 min-h-screen`}>
        {/* Fixed header */}
        <header className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 z-40 flex items-center px-6 gap-3">
          <div className="flex items-center" style={{ gap: '-4px' }}>
            <div className="w-7 h-7 rounded-full bg-[#fd7958]" />
            <div className="w-7 h-7 rounded-full bg-blue-500 opacity-80 -ml-2" />
          </div>
          <span className="text-base font-semibold text-slate-800 ml-1">Integration Workspace</span>
        </header>

        {/* Sidebar */}
        <Sidebar />

        {/* Main content */}
        <div className="ml-60 mt-16 min-h-[calc(100vh-64px)]">
          {children}
        </div>
      </body>
    </html>
  );
}
