'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { groups as groupsApi } from '@/lib/api';
import GroupChat from '@/components/GroupChat';

interface GroupDetail {
  id: string;
  name: string;
  trustScore: number;
  members: Array<{ id: string; user: { id: string; username: string }; visitCount: number }>;
  currentPosts: Array<{
    id: string;
    redactedContent: string;
    totalWeight: number;
    createdAt: string;
    _count: { pushVotes: number; comments: number };
  }>;
}

export default function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);

  const userId = typeof window !== 'undefined' ? localStorage.getItem('exithreat_userId') ?? '' : '';
  const username = typeof window !== 'undefined' ? localStorage.getItem('exithreat_username') ?? '' : '';

  useEffect(() => {
    if (!id) return;
    groupsApi
      .get(id)
      .then((data) => {
        setGroup(data as GroupDetail);
        const isMember = (data as GroupDetail).members.some((m) => m.user.id === userId);
        setJoined(isMember);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [id, userId]);

  // Heartbeat every 60s
  useEffect(() => {
    if (!id || !joined) return;
    const start = Date.now();
    const interval = setInterval(() => {
      const seconds = Math.round((Date.now() - start) / 1000);
      groupsApi.heartbeat(id, seconds).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [id, joined]);

  const handleJoin = async () => {
    if (joining || !id) return;
    setJoining(true);
    try {
      await groupsApi.join(id);
      setJoined(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-8 w-48 bg-navy-800 rounded animate-pulse" />
        <div className="h-40 bg-navy-800 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="text-accent-red font-mono text-sm text-center py-12">
        {error ?? 'Group not found'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-mono font-bold text-accent-teal">{group.name}</h1>
          <div className="text-xs font-mono text-gray-500 mt-1">
            {group.members.length} members · Trust score {(group.trustScore * 100).toFixed(1)}%
          </div>
        </div>
        {!joined && (
          <button
            onClick={handleJoin}
            disabled={joining}
            className="px-4 py-2 border border-accent-teal text-accent-teal rounded-lg font-mono text-sm disabled:opacity-50 hover:bg-accent-teal/10 transition-colors"
          >
            {joining ? 'Joining…' : 'Join Group'}
          </button>
        )}
        {joined && (
          <span className="px-3 py-1 text-xs font-mono text-green-400 border border-green-800 rounded-full">
            Member
          </span>
        )}
      </div>

      {/* Active posts */}
      <section>
        <h2 className="text-sm font-mono text-gray-400 uppercase tracking-widest mb-3">
          Active Disclosures ({group.currentPosts.length})
        </h2>
        {group.currentPosts.length === 0 ? (
          <div className="text-gray-600 font-mono text-sm text-center py-6 border border-gray-800 rounded-xl">
            No active posts in this group.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {group.currentPosts.map((post) => (
              <Link
                key={post.id}
                href={`/post/${post.id}`}
                className="block p-4 bg-navy-800 border border-gray-800 rounded-xl hover:border-accent-teal/40 transition-colors no-underline"
              >
                <p className="font-mono text-sm text-gray-300 line-clamp-2 mb-2">
                  {post.redactedContent}
                </p>
                <div className="flex gap-4 text-xs font-mono text-gray-500">
                  <span>⚖ Weight {post.totalWeight.toFixed(1)}</span>
                  <span>▲ {post._count.pushVotes} votes</span>
                  <span>💬 {post._count.comments}</span>
                  <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Group chat */}
      {joined && (
        <section className="border-t border-gray-800 pt-6">
          <GroupChat groupId={group.id} currentUserId={userId} currentUsername={username} />
        </section>
      )}

      {!joined && (
        <div className="text-center text-gray-600 font-mono text-xs py-4 border border-gray-800 rounded-xl">
          Join this group to access chat and participate in pushes.
        </div>
      )}
    </div>
  );
}
