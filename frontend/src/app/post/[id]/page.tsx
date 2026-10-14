'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { posts as postsApi, push as pushApi, weightage as weightageApi, type Post, type WeightageResult } from '@/lib/api';
import SecureMarquee from '@/components/SecureMarquee';
import PushButton from '@/components/PushButton';
import CommentSection from '@/components/CommentSection';

type ViewState = 'loading' | 'first-look' | 'redacted';

export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [weightageData, setWeightageData] = useState<WeightageResult | null>(null);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [firstLookNote, setFirstLookNote] = useState<string | null>(null);
  const [manualPushCooldown, setManualPushCooldown] = useState<string | null>(null);
  const [manualPushing, setManualPushing] = useState(false);
  // The post has gone to another group while a member had it open.
  const [movedOn, setMovedOn] = useState(false);

  const userId = typeof window !== 'undefined' ? localStorage.getItem('exithreat_userId') ?? '' : '';
  const isOC = post?.isAuthor ?? false;

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        // The server decides whether the first look is still open, so the answer is the same
        // on every device the reader signs in on.
        const postData = await postsApi.get(id);
        setPost(postData);
        setViewState(postData.firstLook === 'available' ? 'first-look' : 'redacted');
      } catch (err) {
        setError((err as Error).message);
        setViewState('redacted');
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    weightageApi.get(id).then(setWeightageData).catch(() => {});
  }, [id]);

  const handleViewComplete = useCallback(() => {
    setViewState('redacted');
  }, []);

  const handleMoved = useCallback(() => setMovedOn(true), []);

  // The strip could not be loaded: show the redacted version instead of an error.
  const handleFirstLookUnavailable = useCallback((reason: string) => {
    setFirstLookNote(`The first look could not be opened (${reason}). Reload the page to try again.`);
    setViewState('redacted');
  }, []);

  const handleManualPush = async () => {
    if (!id || manualPushing) return;
    setManualPushing(true);
    setManualPushCooldown(null);
    try {
      await pushApi.manualPush(id);
      // Reload post to get new group
      const updated = await postsApi.get(id);
      setPost(updated);
      weightageApi.get(id).then(setWeightageData).catch(() => {});
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('cooldown')) {
        setManualPushCooldown(msg);
      } else {
        setError(msg);
      }
    } finally {
      setManualPushing(false);
    }
  };

  if (error) {
    return (
      <div className="text-accent-red font-mono text-sm text-center py-12">{error}</div>
    );
  }

  if (viewState === 'loading' || !post) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-8 w-64 bg-navy-800 rounded animate-pulse" />
        <div className="h-64 bg-navy-800 rounded-xl animate-pulse" />
      </div>
    );
  }

  // A member's group has pushed the post on: it is no longer theirs to read.
  if (movedOn && !isOC) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="text-lg font-mono font-bold text-green-400">This post has moved on</div>
        <p className="text-sm font-mono text-gray-400 max-w-sm leading-relaxed">
          Your group gave it enough votes, and it is now with another group. It can no longer
          be opened from here.
        </p>
        <Link
          href={`/group/${post.currentGroupId}`}
          className="px-6 py-3 border border-accent-teal text-accent-teal rounded-lg font-mono font-bold text-sm hover:bg-accent-teal hover:text-navy-900 transition-colors no-underline"
        >
          Back to Group
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href={isOC ? '/disclosures' : `/group/${post.currentGroupId}`}
          className="text-xs font-mono text-gray-500 hover:text-accent-teal"
        >
          {isOC ? '← My Disclosures' : '← Back to Group'}
        </Link>
        <span className="text-gray-700">·</span>
        <span className="text-xs font-mono text-gray-600">
          {new Date(post.createdAt).toLocaleDateString()}
        </span>
        {isOC && (
          <span className="ml-auto text-xs font-mono text-accent-teal border border-accent-teal/30 px-2 py-0.5 rounded-full">
            Your Post
          </span>
        )}
      </div>

      {/* First-Look strip OR Redacted content */}
      {viewState === 'first-look' ? (
        <div className="flex flex-col items-center gap-2">
          <SecureMarquee
            postId={id}
            onViewComplete={handleViewComplete}
            onUnavailable={handleFirstLookUnavailable}
          />
        </div>
      ) : (
        <div className="p-4 bg-navy-800 rounded-xl border border-gray-800">
          <div className="text-xs font-mono text-gray-600 uppercase tracking-widest mb-3">
            Redacted Version
          </div>
          {firstLookNote && (
            <div className="text-xs font-mono text-yellow-600 mb-3">{firstLookNote}</div>
          )}
          <p className="font-mono text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
            {post.redactedContent}
          </p>
        </div>
      )}

      {/* Journey: for the author only */}
      {post.journey && (
        <div className="p-4 bg-navy-800 rounded-xl border border-gray-800">
          <div className="text-xs font-mono text-gray-400 uppercase tracking-widest mb-3">
            Journey So Far
          </div>
          <div className="grid grid-cols-2 gap-3 font-mono">
            <div>
              <div className="text-lg font-bold text-accent-teal">{post.journey.groupsPassed}</div>
              <div className="text-xs text-gray-500">
                group{post.journey.groupsPassed !== 1 ? 's' : ''} passed through
              </div>
            </div>
            <div>
              <div className="text-sm font-bold text-gray-200">
                {new Date(post.journey.arrivedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
              <div className="text-xs text-gray-500">arrived in its current group</div>
            </div>
          </div>
        </div>
      )}

      {/* Weightage card */}
      <div className="p-4 bg-navy-800 rounded-xl border border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-mono text-gray-400 uppercase tracking-widest">
            Credibility Weightage
          </span>
          <span className="text-lg font-mono font-bold text-accent-teal">
            {weightageData ? weightageData.aggregatedWeight.toFixed(1) : post.totalWeight.toFixed(1)}
          </span>
        </div>
        {weightageData && (
          <div className="flex flex-col gap-1.5">
            {weightageData.history.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono">
                <div className="flex-1 h-1.5 bg-navy-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${h.wasManualPush ? 0 : Math.min(h.pushPercentage, 100)}%`,
                      backgroundColor: h.wasManualPush ? '#6b7280' : '#00b4d8',
                    }}
                  />
                </div>
                <span className="text-gray-500 w-20 text-right">
                  {h.wasManualPush ? 'Manual (0)' : `${h.pushPercentage.toFixed(1)}%`}
                </span>
                <span className="text-gray-600 truncate max-w-24">{h.groupName}</span>
              </div>
            ))}
            <div className="text-xs font-mono text-gray-600 mt-1">
              {weightageData.groupsTraversed} group{weightageData.groupsTraversed !== 1 ? 's' : ''} traversed
            </div>
          </div>
        )}
      </div>

      {/* Push section */}
      <div className="p-4 bg-navy-800 rounded-xl border border-gray-800">
        <div className="text-xs font-mono text-gray-400 uppercase tracking-widest mb-3">
          Push to Next Group
        </div>
        <PushButton postId={id} isOC={isOC} firstLookOpen={viewState === 'first-look'} onMoved={handleMoved} />
      </div>

      {/* OC manual push */}
      {isOC && (
        <div className="p-4 bg-navy-800 rounded-xl border border-yellow-900/40">
          <div className="text-xs font-mono text-yellow-600 uppercase tracking-widest mb-2">
            Manual Push (OC Only)
          </div>
          <p className="text-xs font-mono text-gray-500 mb-3">
            Move your post to a new random group immediately. Usable once every 24 hours.
            Carries 0 weightage and invalidates current group&apos;s votes.
          </p>
          {manualPushCooldown && (
            <div className="text-accent-red text-xs font-mono mb-2">{manualPushCooldown}</div>
          )}
          <button
            onClick={handleManualPush}
            disabled={manualPushing}
            className="w-full py-2 border border-yellow-700 text-yellow-500 rounded-lg font-mono text-sm disabled:opacity-40 hover:bg-yellow-900/20 transition-colors"
          >
            {manualPushing ? 'Moving…' : 'Manual Push'}
          </button>
        </div>
      )}

      {/* Comments */}
      <div className="p-4 bg-navy-800 rounded-xl border border-gray-800">
        <CommentSection postId={id} currentUserId={userId} />
      </div>
    </div>
  );
}
