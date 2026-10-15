'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { groups as groupsApi, type Group } from '@/lib/api';

export default function GroupsPage() {
  const [groupList, setGroupList] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    groupsApi
      .list()
      .then(setGroupList)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-mono font-bold text-accent-teal">
          {groupList.length > 1 ? 'Your Groups' : 'Your Group'}
        </h1>
        <Link href="/post/new" className="text-sm font-mono text-accent-red hover:underline">
          + New Disclosure
        </Link>
      </div>

      <p className="text-xs font-mono text-gray-500 leading-relaxed">
        Groups are assigned at random, so nobody can choose which disclosures they read. Your
        own disclosures are never sent to your group.
      </p>

      {error && <div className="text-accent-red text-xs font-mono">{error}</div>}

      {loading && (
        <div className="grid grid-cols-1 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-navy-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!loading && groupList.length === 0 && (
        <div className="text-center py-12 text-gray-600 font-mono text-sm">
          You have not been placed in a group yet. Reload the page in a moment.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {groupList.map((g) => (
          <Link
            key={g.id}
            href={`/group/${g.id}`}
            className="flex items-center justify-between p-4 bg-navy-800 border border-gray-800 rounded-xl hover:border-accent-teal/40 transition-colors no-underline"
          >
            <div>
              <div className="font-mono font-bold text-sm text-gray-200">{g.name}</div>
              <div className="text-xs font-mono text-gray-500 mt-0.5">
                {g._count.members} members · {g._count.currentPosts} active posts
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="text-xs font-mono text-accent-teal">
                Weight {(g.trustScore * 100).toFixed(0)}%
              </div>
              <div
                className="w-16 h-1.5 bg-navy-700 rounded-full overflow-hidden"
              >
                <div
                  className="h-full bg-accent-teal rounded-full"
                  style={{ width: `${Math.min(g.trustScore * 100, 100)}%` }}
                />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
