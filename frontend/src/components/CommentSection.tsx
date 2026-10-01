'use client';

import { useEffect, useRef, useState } from 'react';
import { posts as postsApi, type Comment } from '@/lib/api';

interface CommentSectionProps {
  postId: string;
  currentUserId: string;
}

export default function CommentSection({ postId, currentUserId }: CommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    postsApi
      .getComments(postId)
      .then(setComments)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [postId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const comment = await postsApi.addComment(postId, draft.trim());
      setComments((prev) => [...prev, comment]);
      setDraft('');
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-mono text-gray-400 uppercase tracking-widest">
        Tagged Comments ({comments.length})
      </h3>

      {/* Comment list */}
      <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
        {loading && (
          <div className="text-gray-600 text-sm font-mono">Loading…</div>
        )}
        {!loading && comments.length === 0 && (
          <div className="text-gray-600 text-sm font-mono">No comments yet.</div>
        )}
        {comments.map((c) => (
          <div
            key={c.id}
            className={[
              'rounded-lg p-3 text-sm font-mono border',
              c.user.id === currentUserId
                ? 'bg-navy-700 border-accent-teal/30 text-gray-200'
                : 'bg-navy-800 border-gray-700 text-gray-300',
            ].join(' ')}
          >
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-accent-teal text-xs">{c.user.username}</span>
              <span className="text-gray-600 text-xs">
                {new Date(c.createdAt).toLocaleDateString()}
              </span>
            </div>
            <p className="break-words">{c.content}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* New comment form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a tagged comment…"
          maxLength={500}
          className="flex-1 bg-navy-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal"
        />
        <button
          type="submit"
          disabled={submitting || !draft.trim()}
          className="px-4 py-2 bg-accent-teal text-navy-900 rounded-lg font-mono font-bold text-sm disabled:opacity-40 hover:bg-accent-teal/80 transition-colors"
        >
          {submitting ? '…' : 'Post'}
        </button>
      </form>

      {error && (
        <div className="text-accent-red text-xs font-mono">{error}</div>
      )}
    </div>
  );
}
