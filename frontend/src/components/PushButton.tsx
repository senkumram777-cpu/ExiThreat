'use client';

import { useCallback, useEffect, useState } from 'react';
import { push as pushApi, type PushStatus } from '@/lib/api';

interface PushButtonProps {
  postId: string;
  isOC: boolean; // OC cannot vote
}

export default function PushButton({ postId, isOC }: PushButtonProps) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await pushApi.status(postId);
      setStatus(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    loadStatus();
    // Poll every 15s so the bar updates as other members vote
    const interval = setInterval(loadStatus, 15_000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  const handleVote = async () => {
    if (acting || !status) return;
    setActing(true);
    setError(null);
    try {
      if (status.hasVoted) {
        await pushApi.retractVote(postId);
      } else {
        const updated = await pushApi.vote(postId);
        setStatus(updated);
        setActing(false);
        return;
      }
      await loadStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return <div className="h-16 bg-navy-800 rounded-lg animate-pulse" />;
  }

  if (isOC) {
    return (
      <div className="flex items-center gap-2 p-3 bg-navy-800 rounded-lg border border-gray-700">
        <span className="text-gray-500 text-sm font-mono">
          You are the Original Complainant — you cannot vote on your own post.
        </span>
      </div>
    );
  }

  const pct = status?.pushPercentage ?? 0;

  return (
    <div className="flex flex-col gap-2">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-3 bg-navy-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(pct, 100)}%`,
              backgroundColor: pct >= 50 ? '#22c55e' : '#00b4d8',
            }}
          />
        </div>
        <span className="text-xs font-mono text-gray-400 w-16 text-right">
          {status?.voteCount ?? 0}/{status?.totalMembers ?? 0} ({pct.toFixed(0)}%)
        </span>
      </div>

      {/* Vote button */}
      <button
        onClick={handleVote}
        disabled={acting}
        className={[
          'w-full py-3 rounded-lg font-mono font-bold text-sm tracking-wider transition-all',
          'border-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-navy-900',
          status?.hasVoted
            ? 'border-gray-600 text-gray-400 hover:border-accent-red hover:text-accent-red focus:ring-accent-red'
            : 'border-accent-teal text-accent-teal hover:bg-accent-teal hover:text-navy-900 focus:ring-accent-teal',
          acting ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
      >
        {acting ? '…' : status?.hasVoted ? '✕ Retract Push' : '▲ Push'}
      </button>

      {status?.thresholdReached && (
        <div className="text-center text-xs font-mono text-green-400 animate-pulse">
          Threshold reached — content will move shortly
        </div>
      )}

      {error && (
        <div className="text-center text-xs font-mono text-accent-red">{error}</div>
      )}
    </div>
  );
}
