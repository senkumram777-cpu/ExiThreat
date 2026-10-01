'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { groups as groupsApi, type Group } from '@/lib/api';

export default function GroupsPage() {
  const [groupList, setGroupList] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    groupsApi
      .list()
      .then(setGroupList)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim() || creating) return;
    setCreating(true);
    try {
      const g = await groupsApi.create(newGroupName.trim());
      setGroupList((prev) => [g, ...prev]);
      setNewGroupName('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-mono font-bold text-accent-teal">Processing Groups</h1>
        <Link href="/post/new" className="text-sm font-mono text-accent-red hover:underline">
          + New Disclosure
        </Link>
      </div>

      {/* Create group form */}
      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          type="text"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="New group name…"
          className="flex-1 bg-navy-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal"
        />
        <button
          type="submit"
          disabled={creating || !newGroupName.trim()}
          className="px-4 py-2 bg-navy-700 border border-gray-600 text-gray-300 rounded-lg font-mono text-sm disabled:opacity-40 hover:border-accent-teal transition-colors"
        >
          {creating ? '…' : 'Create'}
        </button>
      </form>

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
          No groups yet. Create one above.
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
                Trust {(g.trustScore * 100).toFixed(0)}%
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
