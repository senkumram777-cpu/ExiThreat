'use client';

/**
 * SecureMarquee — First-Look unredacted viewer.
 *
 * Security model:
 *  1. The strip is rendered as an <img> from a PNG the backend draws.
 *     There is no raw text in the DOM.
 *  2. A transparent "glass-pane" div covers the whole image, however far it is scrolled, to
 *     block the right-click menu, long-press save on mobile and drag-to-save. It lets vertical
 *     swipes through (touch-action: pan-y) so the strip can be scrolled on a phone.
 *  3. CSS user-select: none everywhere.
 *  4. The strip is 25 characters wide and scrolls vertically within the container.
 *  5. The look ends when the reader taps "Done reading" or leaves the page. Only then is it
 *     used up on the server; onViewComplete() switches the parent to the redacted view.
 *     If the strip cannot be loaded, onUnavailable() does the same without using the look up.
 *
 * None of this stops a screenshot or a photo of the screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { posts as postsApi } from '@/lib/api';

interface SecureMarqueeProps {
  postId: string;
  onViewComplete: () => void;
  onUnavailable: (reason: string) => void;
}

export default function SecureMarquee({ postId, onViewComplete, onUnavailable }: SecureMarqueeProps) {
  const [stripUrl, setStripUrl] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const shownRef = useRef(false);
  const closedRef = useRef(false);
  const mountedRef = useRef(false);

  // Tells the server the look is over. Does nothing if the strip never reached the screen.
  const close = useCallback(() => {
    if (closedRef.current || !shownRef.current) return;
    closedRef.current = true;
    postsApi.stripDone(postId);
  }, [postId]);

  // Fetch PNG strip from backend
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const blob = await postsApi.getStrip(postId);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setStripUrl(url);
      } catch (err) {
        if (!cancelled) onUnavailable((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [postId, onUnavailable]);

  // Leaving the page ends the look. The check is deferred because React's development mode
  // unmounts and remounts every component once, which must not count as leaving.
  useEffect(() => {
    mountedRef.current = true;
    window.addEventListener('pagehide', close);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('pagehide', close);
      setTimeout(() => {
        if (!mountedRef.current) close();
      }, 0);
    };
  }, [close]);

  const handleDone = () => {
    close();
    onViewComplete();
  };

  const blockInteraction = (e: React.SyntheticEvent) => e.preventDefault();

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <div className="text-xs text-accent-teal font-mono tracking-widest uppercase mb-1">
        ▼ First Look — Unredacted ▼
      </div>

      {!shown && (
        <div className="flex items-center justify-center h-48 w-full bg-navy-800 rounded-lg">
          <span className="text-accent-teal text-sm font-mono animate-pulse">Loading strip…</span>
        </div>
      )}

      {/* Scrolling container: as wide as the strip (25 * 14px + 2 * 12px padding = 374px), or
          the screen if that is narrower. Hidden until the image has actually been drawn. */}
      <div
        className="overflow-y-auto rounded-lg border border-accent-teal/30 w-full"
        style={{
          display: shown ? 'block' : 'none',
          maxWidth: '374px',
          maxHeight: '480px',
          backgroundColor: '#1a1a2e',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onContextMenu={blockInteraction}
      >
        {/* As tall as the image, so the glass pane inside it covers all of it */}
        <div style={{ position: 'relative' }}>
          {stripUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={stripUrl}
              alt=""
              draggable={false}
              onDragStart={blockInteraction}
              onLoad={() => {
                shownRef.current = true;
                setShown(true);
              }}
              onError={() => onUnavailable('The first look could not be displayed')}
              style={{
                display: 'block',
                width: '100%',
                pointerEvents: 'none',
                WebkitTouchCallout: 'none',
              }}
            />
          )}

          {/* Glass-pane overlay — blocks right-click, long-press, drag */}
          <div
            aria-hidden="true"
            onContextMenu={blockInteraction}
            onDragStart={blockInteraction}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'transparent',
              touchAction: 'pan-y',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              cursor: 'default',
              zIndex: 10,
            }}
          />
        </div>
      </div>

      {shown && (
        <>
          <div className="text-xs text-gray-500 font-mono mt-1 text-center">
            You can read this once. It closes when you tap Done or leave this page.
          </div>
          <button
            onClick={handleDone}
            className="px-6 py-2 border border-accent-teal text-accent-teal rounded-lg font-mono text-sm hover:bg-accent-teal/10 transition-colors"
          >
            Done reading
          </button>
        </>
      )}
    </div>
  );
}
