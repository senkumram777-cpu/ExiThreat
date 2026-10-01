'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { posts as postsApi } from '@/lib/api';

export default function NewPostPage() {
  const router = useRouter();
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (content.trim().length < 20 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const post = await postsApi.create(content.trim());
      router.push(`/post/${post.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  const remaining = Math.max(0, 20 - content.trim().length);

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-xl font-mono font-bold text-accent-red mb-2">New Disclosure</h1>
      <p className="text-xs font-mono text-gray-500 mb-6 leading-relaxed">
        Your submission will be sent to a random processing group. Do not include identifying
        information about yourself — the system will auto-redact PII, but accuracy is not
        guaranteed. A secure image strip will be generated for first-look viewers.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="relative">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Describe the workplace abuse, threat, or grievance…"
            rows={10}
            maxLength={5000}
            className="w-full bg-navy-800 border border-gray-700 rounded-xl px-4 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-accent-red leading-relaxed"
          />
          <div className="absolute bottom-3 right-3 text-xs font-mono text-gray-600">
            {content.length}/5000
          </div>
        </div>

        {remaining > 0 && (
          <div className="text-xs font-mono text-gray-600">
            {remaining} more character{remaining !== 1 ? 's' : ''} required
          </div>
        )}

        {error && <div className="text-accent-red text-xs font-mono">{error}</div>}

        <div className="flex items-center gap-3 p-3 bg-navy-800 rounded-lg border border-gray-800 text-xs font-mono text-gray-500">
          <span className="text-yellow-500">⚠</span>
          PII will be auto-redacted. Your identity is not linked to this post.
          Review before submitting.
        </div>

        <button
          type="submit"
          disabled={submitting || content.trim().length < 20}
          className="py-3 bg-accent-red text-white rounded-lg font-mono font-bold text-sm disabled:opacity-40 hover:bg-accent-red/80 transition-colors"
        >
          {submitting ? 'Submitting…' : 'Submit Disclosure'}
        </button>
      </form>
    </div>
  );
}
