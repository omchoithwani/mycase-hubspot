import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MyCase ↔ HubSpot Sync',
  description: 'Bidirectional sync between HubSpot and MyCase',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground min-h-screen">
        {children}
      </body>
    </html>
  );
}
