import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ExiThreat',
  description: 'Secure workplace disclosure platform',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ExiThreat',
  },
};

export const viewport: Viewport = {
  themeColor: '#e94560',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className="min-h-dvh flex flex-col">
        {/* Top nav */}
        <nav className="sticky top-0 z-50 border-b border-gray-800 bg-navy-900/95 backdrop-blur-sm">
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
            <a href="/" className="text-accent-red font-mono font-bold text-lg tracking-tight no-underline hover:no-underline">
              ExiThreat
            </a>
            <div className="flex gap-4 text-sm font-mono text-gray-400">
              <a href="/groups" className="hover:text-accent-teal transition-colors">Groups</a>
              <a href="/post/new" className="text-accent-red hover:text-accent-red/80 transition-colors">+ Disclose</a>
            </div>
          </div>
        </nav>

        {/* Page content */}
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
          {children}
        </main>

        <footer className="border-t border-gray-800 py-4 text-center text-xs font-mono text-gray-700">
          ExiThreat · Security through Friction
        </footer>
      </body>
    </html>
  );
}
