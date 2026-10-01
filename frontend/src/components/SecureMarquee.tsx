'use client';

/**
 * SecureMarquee — First-Look unredacted viewer.
 *
 * Security model:
 *  1. The strip is rendered as an <img> pointing at the backend PNG endpoint.
 *     There is no raw text in the DOM.
 *  2. A transparent "glass-pane" div covers the image to block:
 *       - Right-click context menu (onContextMenu preventDefault)
 *       - Long-press save on mobile (touch-action: none + onTouchStart preventDefault)
 *       - Drag-to-save (draggable=false + onDragStart preventDefault)
 *  3. CSS user-select: none everywhere.
 *  4. The container is exactly 25 characters wide (monospace, 14px = 350px).
 *  5. The image scrolls vertically within the container.
 *  6. On scroll-end (IntersectionObserver on a sentinel) OR on component
 *     unmount, onViewComplete() is called — the parent marks the post as seen
 *     in RxDB and switches to the redacted view.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { posts as postsApi } from '@/lib/api';

interface SecureMarqueeProps {
  postId: string;
  onViewComplete: () => void;
}

export default function SecureMarquee({ postId, onViewComplete }: SecureMarqueeProps) {
  const [stripUrl, setStripUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef(false);
  const blobUrlRef = useRef<string | null>(null);

  const triggerComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onViewComplete();
  }, [onViewComplete]);

  // Fetch PNG strip from backend
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const blob = await postsApi.getStrip(postId);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setStripUrl(url);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  // Revoke blob URL on unmount, trigger complete
  useEffect(() => {
    return () => {
      triggerComplete();
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, [triggerComplete]);

  // IntersectionObserver: fire onViewComplete when the bottom sentinel is visible
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) triggerComplete();
      },
      { root: containerRef.current, threshold: 0.9 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [stripUrl, triggerComplete]);

  const blockInteraction = (e: React.SyntheticEvent) => e.preventDefault();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 bg-navy-800 rounded-lg">
        <span className="text-accent-teal text-sm font-mono animate-pulse">
          Decrypting strip…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 bg-navy-800 rounded-lg border border-accent-red">
        <span className="text-accent-red text-sm font-mono px-4 text-center">{error}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-xs text-accent-teal font-mono tracking-widest uppercase mb-1">
        ▼ First Look — Unredacted ▼
      </div>

      {/* 25-char wide scrolling container: 25 * 14px char + 2*12px padding = 374px */}
      <div
        ref={containerRef}
        className="relative overflow-y-auto rounded-lg border border-accent-teal/30"
        style={{
          width: '374px',
          maxHeight: '480px',
          backgroundColor: '#1a1a2e',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onContextMenu={blockInteraction}
      >
        {/* The PNG strip */}
        {stripUrl && (
          <img
            src={stripUrl}
            alt=""
            draggable={false}
            onDragStart={blockInteraction}
            style={{ display: 'block', width: '100%' }}
          />
        )}

        {/* Scroll-end sentinel */}
        <div ref={sentinelRef} style={{ height: 1 }} />

        {/* Glass-pane overlay — blocks right-click, long-press, drag */}
        <div
          aria-hidden="true"
          onContextMenu={blockInteraction}
          onTouchStart={blockInteraction}
          onDragStart={blockInteraction}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'transparent',
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            cursor: 'default',
            zIndex: 10,
          }}
        />
      </div>

      <div className="text-xs text-gray-500 font-mono mt-1">
        Scroll to the end • View closes automatically
      </div>
    </div>
  );
}
