'use client';

/** Shown by the service worker when a page is opened without a connection. */
export default function OfflinePage() {
  return (
    <div className="flex flex-col items-center text-center gap-4 pt-16">
      <div className="text-2xl font-mono font-bold text-accent-red">You are offline</div>
      <p className="text-gray-400 font-mono text-sm max-w-sm leading-relaxed">
        ExiThreat needs a connection to show groups and disclosures. Nothing is kept on this
        device to read without one.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-6 py-3 border border-accent-teal text-accent-teal rounded-lg font-mono font-bold text-sm hover:bg-accent-teal/10 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
