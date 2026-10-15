'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CommonPage, CommonPost } from '@/lib/api';

/**
 * The common page's list: posts that have reached 20% of the groups, fastest spreading first,
 * each tagged with its author's pseudonym. Members get the redacted version; officers
 * (`officer`) the original as well. `load` fetches one page from an offset.
 */

const TICKER_WIDTH_CH = 16;
const TICKER_CHARS_PER_SECOND = 4;

/**
 * The original text for officers: one line, 16 characters wide, scrolling slowly from right to
 * left and starting again. It can't be selected, copied, dragged or right-clicked; nothing stops a
 * screenshot.
 */
function OriginalTicker({ text }: { text: string }) {
  const line = text.replace(/\s+/g, ' ').trim();
  const seconds = Math.max(8, (line.length + TICKER_WIDTH_CH) / TICKER_CHARS_PER_SECOND);
  const block = (e: React.SyntheticEvent) => e.preventDefault();
  return (
    <div
      role="marquee"
      aria-label="Original text"
      className="overflow-hidden whitespace-nowrap font-mono text-sm text-gray-200 rounded border border-gray-800 bg-navy-800 px-2 py-1 select-none cursor-default"
      style={{ width: `calc(${TICKER_WIDTH_CH}ch + 1rem)`, WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
      onCopy={block}
      onCut={block}
      onContextMenu={block}
      onDragStart={block}
      onMouseDown={block}
    >
      <span
        className="inline-block"
        style={{ paddingLeft: `${TICKER_WIDTH_CH}ch`, animation: `ticker ${seconds}s linear infinite` }}
      >
        {line}
      </span>
    </div>
  );
}

function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days ${hours % 24} h`;
}

function PostCard({ post, officer }: { post: CommonPost; officer: boolean }) {
  const share = post.eligibleGroups > 0 ? Math.round((post.reachedGroups / post.eligibleGroups) * 100) : 0;
  return (
    <article className="p-4 bg-navy-800 rounded-xl border border-gray-800 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs font-mono">
        <span className="text-accent-teal font-bold">#{post.rank}</span>
        <span className="text-gray-300">{post.author}</span>
        <span className="text-gray-600 ml-auto">{new Date(post.createdAt).toLocaleDateString()}</span>
      </div>

      {officer && post.originalContent !== undefined && (
        <div className="rounded-lg border border-accent-red/30 bg-navy-900 p-3">
          <div className="text-[11px] font-mono text-accent-red uppercase tracking-widest mb-2">Original</div>
          <OriginalTicker text={post.originalContent} />
        </div>
      )}
      <div className={officer ? 'rounded-lg border border-gray-800 bg-navy-900 p-3' : ''}>
        {officer && (
          <div className="text-[11px] font-mono text-gray-500 uppercase tracking-widest mb-2">Redacted</div>
        )}
        <p className="font-mono text-sm text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
          {post.redactedContent}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 font-mono">
        <div>
          <div className="text-sm font-bold text-accent-teal">{share}%</div>
          <div className="text-[11px] text-gray-500">of groups ({post.reachedGroups}/{post.eligibleGroups})</div>
        </div>
        <div>
          <div className="text-sm font-bold text-gray-200">{duration(post.listedAfterMs)}</div>
          <div className="text-[11px] text-gray-500">to reach 20%</div>
        </div>
        <div>
          <div className="text-sm font-bold text-gray-200">{(post.spreadScore * 100).toFixed(1)}%</div>
          <div className="text-[11px] text-gray-500">of groups a day</div>
        </div>
      </div>
    </article>
  );
}

export default function CommonFeed({
  load,
  officer = false,
  onUnauthorized,
}: {
  load: (offset: number) => Promise<CommonPage>;
  officer?: boolean;
  onUnauthorized?: () => void;
}) {
  const [posts, setPosts] = useState<CommonPost[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFrom = useCallback(async (offset: number) => {
    try {
      const page = await load(offset);
      setTotal(page.total);
      setPosts((prev) => (offset === 0 || !prev ? page.posts : [...prev, ...page.posts]));
      setError(null);
    } catch (err) {
      const message = (err as Error).message;
      if (/sign in again|401/i.test(message) && onUnauthorized) onUnauthorized();
      else setError(message);
    }
  }, [load, onUnauthorized]);

  useEffect(() => {
    fetchFrom(0);
  }, [fetchFrom]);

  if (error && !posts) return <div className="text-xs font-mono text-accent-red">{error}</div>;
  if (!posts) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-32 bg-navy-800 rounded-xl animate-pulse" />)}
      </div>
    );
  }
  if (posts.length === 0) {
    return (
      <p className="text-sm font-mono text-gray-500 text-center py-8">
        No post has reached 20% of the groups yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {posts.map((post) => <PostCard key={post.id} post={post} officer={officer} />)}
      {error && <div className="text-xs font-mono text-accent-red">{error}</div>}
      {posts.length < total && (
        <button
          onClick={async () => {
            setLoadingMore(true);
            await fetchFrom(posts.length);
            setLoadingMore(false);
          }}
          disabled={loadingMore}
          className="w-full py-2 border border-gray-700 text-gray-300 rounded-lg font-mono text-sm disabled:opacity-40 hover:border-accent-teal hover:text-accent-teal transition-colors"
        >
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
