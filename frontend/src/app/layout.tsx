import type { Metadata, Viewport } from 'next';
import './globals.css';
import NavLinks from '@/components/NavLinks';
import ServiceWorker from '@/components/ServiceWorker';
import ActivityHeartbeat from '@/components/ActivityHeartbeat';

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
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-dvh flex flex-col">
        <ServiceWorker />
        <ActivityHeartbeat />
        {/* Top nav */}
        <nav className="sticky top-0 z-50 border-b border-gray-800 bg-navy-900/95 backdrop-blur-sm">
          {/* On a narrow phone the links drop to a second line under the name. */}
          <div className="max-w-2xl mx-auto px-4 min-h-14 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <a href="/" className="text-accent-red font-mono font-bold text-lg tracking-tight no-underline hover:no-underline">
              ExiThreat
            </a>
            <NavLinks />
          </div>
        </nav>

        {/* Page content */}
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
          {children}
        </main>

        <footer className="border-t border-gray-800 py-4 text-center text-xs font-mono text-gray-700">
          ExiThreat · Security through Friction ·{' '}
          <a href="/privacy" className="text-gray-500">Privacy</a>
        </footer>
      </body>
    </html>
  );
}
