'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CommonPage, CommonPost } from '@/lib/api';
import { pct, useRules } from '@/lib/rules';
import { groupsPerDay } from '@/lib/weight';
import ReportBlock from './ReportBlock';
import CategoryTag from './CategoryTag';
import { CATEGORIES, CATEGORY_KEYS } from '@/lib/categories';

/**
 * The common page's list: posts that have reached the listing share of the groups (20% unless an
 * admin changed it), fastest spreading first,
 * each tagged with its author's pseudonym. Members get the redacted version; officers
 * (`officer`) the original as well. `load` fetches one page from an offset, of one type of threat
 * when one is chosen above the list.
 */

function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days ${hours % 24} h`;
}

function PostCard({ post, officer, listShare, onBlocked }: {
  post: CommonPost; officer: boolean; listShare: number; onBlocked: (author: string) => void;
}) {
  const share = post.eligibleGroups > 0 ? Math.round((post.reachedGroups / post.eligibleGroups) * 100) : 0;
  return (
    <article className="p-4 bg-navy-800 rounded-xl border border-gray-800 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs font-mono">
        <span className="text-accent-teal font-bold">#{post.rank}</span>
        <span className="text-gray-300">{post.author}</span>
        <CategoryTag category={post.category} />
        <span className="text-gray-600 ml-auto">{new Date(post.createdAt).toLocaleDateString()}</span>
        {/* Members only: officers read the page through ProMic, not as members. */}
        {!officer && <ReportBlock targetType="post" targetId={post.id} author={post.author} onBlocked={onBlocked} />}
      </div>

      {officer && post.originalContent !== undefined && (
        <div className="rounded-lg border border-accent-red/30 bg-navy-900 p-3">
          <div className="text-[11px] font-mono text-accent-red uppercase tracking-widest mb-2">Original</div>
          <p className="font-mono text-sm text-gray-200 leading-relaxed whitespace-pre-wrap break-words">
            {post.originalContent}
          </p>
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
          <div className="text-[11px] text-gray-500">to reach {pct(listShare)}</div>
        </div>
        <div>
          <div className="text-sm font-bold text-gray-200">{groupsPerDay(post.spreadScore, post.eligibleGroups)}</div>
          <div className="text-[11px] text-gray-500">spreading</div>
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
  load: (offset: number, category: string) => Promise<CommonPage>;
  officer?: boolean;
  onUnauthorized?: () => void;
}) {
  const rules = useRules();
  const [posts, setPosts] = useState<CommonPost[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('');

  const fetchFrom = useCallback(async (offset: number) => {
    try {
      const page = await load(offset, category);
      setTotal(page.total);
      setPosts((prev) => (offset === 0 || !prev ? page.posts : [...prev, ...page.posts]));
      setError(null);
    } catch (err) {
      const message = (err as Error).message;
      if (/sign in again|401/i.test(message) && onUnauthorized) onUnauthorized();
      else setError(message);
    }
  }, [load, onUnauthorized, category]);

  useEffect(() => {
    setPosts(null);
    fetchFrom(0);
  }, [fetchFrom]);

  const filter = (
    <div className="flex items-center gap-2">
      <label htmlFor="common-category" className="text-xs font-mono text-gray-500 shrink-0">Type of threat</label>
      <select
        id="common-category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="min-w-0 flex-1 bg-navy-800 border border-gray-700 rounded-lg px-2 py-1.5 font-mono text-xs text-gray-200 focus:outline-none focus:border-accent-teal"
      >
        <option value="">All</option>
        {CATEGORY_KEYS.map((key) => <option key={key} value={key}>{CATEGORIES[key]}</option>)}
      </select>
    </div>
  );

  if (error && !posts) return <div className="flex flex-col gap-4">{filter}<div className="text-xs font-mono text-accent-red">{error}</div></div>;
  if (!posts) {
    return (
      <div className="flex flex-col gap-3">
        {filter}
        {[0, 1, 2].map((i) => <div key={i} className="h-32 bg-navy-800 rounded-xl animate-pulse" />)}
      </div>
    );
  }
  if (posts.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {filter}
        <p className="text-sm font-mono text-gray-500 text-center py-8">
          {category
            ? `No post of this type has reached ${pct(rules.listShare)} of the groups yet.`
            : `No post has reached ${pct(rules.listShare)} of the groups yet.`}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {filter}
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          officer={officer}
          listShare={rules.listShare}
          // A blocked member's posts leave the page; the server leaves them out from now on.
          onBlocked={() => { void fetchFrom(0); }}
        />
      ))}
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
