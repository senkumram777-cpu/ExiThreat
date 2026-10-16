'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { backedBy } from '@/lib/weight';
import { posts as postsApi, type MyPost } from '@/lib/api';
import { getSession } from '@/lib/session';

/** The signed-in user's own disclosures: the only way back to them, as they sit in other groups. */
export default function DisclosuresPage() {
  const router = useRouter();
  const [list, setList] = useState<MyPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()) {
      router.replace('/auth/login');
      return;
    }
    postsApi
      .mine()
      .then(setList)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-mono font-bold text-accent-teal">My Disclosures</h1>
        <Link href="/post/new" className="text-sm font-mono text-accent-red hover:underline">
          + New Disclosure
        </Link>
      </div>

      <p className="text-xs font-mono text-gray-500 leading-relaxed">
        Only you see this list. Each disclosure is with a group you are not in; open it to see
        its comments and weightage, or to move it on yourself.
      </p>

      {error && <div className="text-accent-red text-xs font-mono">{error}</div>}

      {loading && (
        <div className="grid grid-cols-1 gap-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-navy-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!loading && !error && list.length === 0 && (
        <div className="text-center py-12 text-gray-600 font-mono text-sm border border-gray-800 rounded-xl">
          You have not made a disclosure yet.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {list.map((post) => (
          <Link
            key={post.id}
            href={`/post/${post.id}/map`}
            className="block p-4 bg-navy-800 border border-gray-800 rounded-xl hover:border-accent-teal/40 transition-colors no-underline"
          >
            <p className="font-mono text-sm text-gray-300 line-clamp-2 mb-2">{post.redactedContent}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-gray-500">
              {post.hiddenAt && <span className="text-accent-red">Hidden by an admin</span>}
              <span>⚖ {backedBy(post.totalWeight)}</span>
              <span>
                {post._count.history} group{post._count.history !== 1 ? 's' : ''} passed
              </span>
              <span>
                in {post.inGroups} group{post.inGroups !== 1 ? 's' : ''} now, last reached{' '}
                {new Date(post.arrivedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
              <span>▲ {post._count.pushVotes} votes now</span>
              <span>💬 {post._count.comments}</span>
              <span>{new Date(post.createdAt).toLocaleDateString()}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
