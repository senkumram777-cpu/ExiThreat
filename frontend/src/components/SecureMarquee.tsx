'use client';

/**
 * SecureMarquee — First-Look unredacted viewer.
 *
 * Security model:
 *  1. The text is a PNG the backend draws, in rows of up to 60 characters. There is no raw
 *     text in the DOM, so nothing can be selected or copied.
 *  2. The rows are laid end to end into one line, shown in a window 16 characters wide that
 *     scrolls slowly from right to left and starts again. It is read only.
 *  3. A transparent "glass-pane" div covers the window to block the right-click menu,
 *     long-press save on mobile and drag-to-save. CSS user-select: none everywhere.
 *  4. The look ends when the reader taps "Done reading" or leaves the page. Only then is it
 *     used up on the server; onViewComplete() switches the parent to the redacted view.
 *     If the strip cannot be loaded, onUnavailable() does the same without using the look up.
 *
 * None of this stops a screenshot or a photo of the screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { posts as postsApi, type PaperStrip } from '@/lib/api';

// The strip is drawn in DejaVu Sans Mono at 16px, whose characters are 0.602em wide.
const CHAR_PX = 16 * 0.602;
const WINDOW_CHARS = 16;
const WINDOW_PX = Math.round(WINDOW_CHARS * CHAR_PX);
const CHARS_PER_SECOND = 4;

interface SecureMarqueeProps {
  postId: string;
  onViewComplete: () => void;
  onUnavailable: (reason: string) => void;
}

export default function SecureMarquee({ postId, onViewComplete, onUnavailable }: SecureMarqueeProps) {
  const [strip, setStrip] = useState<{ data: PaperStrip; url: string; width: number; height: number } | null>(null);
  const shownRef = useRef(false);
  const closedRef = useRef(false);
  const mountedRef = useRef(false);

  // Tells the server the look is over. Does nothing if the strip never reached the screen.
  const close = useCallback((reason: 'done' | 'left' = 'left') => {
    if (closedRef.current || !shownRef.current) return;
    closedRef.current = true;
    postsApi.stripDone(postId, reason);
  }, [postId]);

  // Fetch the PNG strip from the backend, and show it once the browser has decoded it.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const data = await postsApi.getStrip(postId);
        if (cancelled) return;
        const bytes = Uint8Array.from(atob(data.image), (c) => c.charCodeAt(0));
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
        url = objectUrl;
        const image = new Image();
        image.onload = () => {
          if (cancelled) return;
          shownRef.current = true;
          setStrip({ data, url: objectUrl, width: image.naturalWidth, height: image.naturalHeight });
        };
        image.onerror = () => {
          if (!cancelled) onUnavailable('The first look could not be displayed');
        };
        image.src = objectUrl;
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
    const leave = () => close('left');
    window.addEventListener('pagehide', leave);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('pagehide', leave);
      setTimeout(() => {
        if (!mountedRef.current) close();
      }, 0);
    };
  }, [close]);

  const handleDone = () => {
    close('done');
    onViewComplete();
  };

  const blockInteraction = (e: React.SyntheticEvent) => e.preventDefault();

  if (!strip) {
    return (
      <div className="flex flex-col items-center gap-2 w-full">
        <div className="text-xs text-accent-teal font-mono tracking-widest uppercase mb-1">
          ▼ First Look — Unredacted ▼
        </div>
        <div className="flex items-center justify-center h-12 w-full bg-navy-800 rounded-lg">
          <span className="text-accent-teal text-sm font-mono animate-pulse">Loading strip…</span>
        </div>
      </div>
    );
  }

  // The rows, in screen pixels, side by side with a space between them.
  const { scale, rows } = strip.data;
  const rowHeight = strip.data.rowHeight / scale;
  const lineWidth = rows.reduce((sum, w) => sum + w / scale + CHAR_PX, 0);
  const seconds = Math.max(8, (WINDOW_PX + lineWidth) / (CHAR_PX * CHARS_PER_SECOND));

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <div className="text-xs text-accent-teal font-mono tracking-widest uppercase mb-1">
        ▼ First Look — Unredacted ▼
      </div>

      <div
        role="marquee"
        aria-label="First look"
        className="relative rounded-lg border border-accent-teal/30"
        style={{
          padding: '8px',
          backgroundColor: '#1a1a2e',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onContextMenu={blockInteraction}
      >
        <div className="overflow-hidden" style={{ width: `${WINDOW_PX}px`, height: `${rowHeight}px` }}>
          <div
            className="flex"
            style={{
              width: 'max-content',
              paddingLeft: `${WINDOW_PX}px`,
              animation: `ticker ${seconds}s linear infinite`,
            }}
          >
            {rows.map((w, i) => (
              <div
                key={i}
                style={{
                  flex: 'none',
                  width: `${w / scale}px`,
                  height: `${rowHeight}px`,
                  marginRight: `${CHAR_PX}px`,
                  backgroundImage: `url(${strip.url})`,
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: `${strip.width / scale}px ${strip.height / scale}px`,
                  backgroundPosition: `0 ${-i * rowHeight}px`,
                }}
              />
            ))}
          </div>
        </div>

        {/* Glass-pane overlay — blocks right-click, long-press, drag */}
        <div
          aria-hidden="true"
          onContextMenu={blockInteraction}
          onDragStart={blockInteraction}
          onMouseDown={blockInteraction}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'transparent',
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            cursor: 'default',
            zIndex: 10,
          }}
        />
      </div>

      <div className="text-xs text-gray-500 font-mono mt-1 text-center">
        You can read this once. It closes when you tap Done or leave this page.
      </div>
      <button
        onClick={handleDone}
        className="px-6 py-2 border border-accent-teal text-accent-teal rounded-lg font-mono text-sm hover:bg-accent-teal/10 transition-colors"
      >
        Done reading
      </button>
    </div>
  );
}
