'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { posts as postsApi } from '@/lib/api';
import { pct, useRules } from '@/lib/rules';
import { CATEGORIES, CATEGORY_KEYS } from '@/lib/categories';

const MIN_LENGTH = 20;
const MAX_LENGTH = 5000;

export default function NewPostPage() {
  const rules = useRules();
  const router = useRouter();
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  // The redacted version of exactly the text in the box; cleared as soon as the text changes.
  const [preview, setPreview] = useState<string | null>(null);
  // Whether that preview had the AI check as well as the patterns.
  const [aiChecked, setAiChecked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = content.trim().length < MIN_LENGTH;

  // The AI redactor sleeps when idle; start it while the author writes.
  useEffect(() => {
    void postsApi.warm();
  }, []);

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tooShort || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postsApi.preview(content.trim());
      setPreview(result.redactedContent);
      setAiChecked(result.aiChecked);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (tooShort || busy) return;
    setBusy(true);
    setError(null);
    try {
      const post = await postsApi.create(content.trim(), category || null, aiChecked);
      router.push(`/post/${post.id}`);
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      // The AI check could not be repeated: back to the preview step.
      if (/preview your disclosure again/i.test(message)) setPreview(null);
      setBusy(false);
    }
  };

  const remaining = Math.max(0, MIN_LENGTH - content.trim().length);

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-xl font-mono font-bold text-accent-red mb-2">New Disclosure</h1>
      <p className="text-xs font-mono text-gray-500 mb-6 leading-relaxed">
        Your submission will be sent to a random group that you are not in. Each of its members
        can read your exact words once, as an image; after that they see the redacted version.
        Others see only your pseudonym, never your username. Once it has reached {pct(rules.listShare)} of the
        groups it is listed on the common page: every member sees the redacted version there,
        and law-enforcement officers see your exact words as well.
      </p>

      <form onSubmit={handlePreview} className="flex flex-col gap-4">
        <div>
          <label htmlFor="category" className="block text-xs font-mono text-gray-400 mb-1">
            Type of threat <span className="text-gray-600">(optional)</span>
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full bg-navy-800 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm text-gray-200 focus:outline-none focus:border-accent-red"
          >
            <option value="">Choose one…</option>
            {CATEGORY_KEYS.map((key) => <option key={key} value={key}>{CATEGORIES[key]}</option>)}
          </select>
        </div>
        <div className="relative">
          <label htmlFor="disclosure" className="sr-only">Your disclosure</label>
          <textarea
            id="disclosure"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setPreview(null);
            }}
            placeholder="Describe what happened: the abuse or threat, where and by whom…"
            rows={10}
            maxLength={MAX_LENGTH}
            className="w-full bg-navy-800 border border-gray-700 rounded-xl px-4 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-accent-red leading-relaxed"
          />
          <div className="absolute bottom-3 right-3 text-xs font-mono text-gray-600">
            {content.length}/{MAX_LENGTH}
          </div>
        </div>

        {remaining > 0 && (
          <div className="text-xs font-mono text-gray-600">
            {remaining} more character{remaining !== 1 ? 's' : ''} required
          </div>
        )}

        {error && <div className="text-accent-red text-xs font-mono">{error}</div>}

        {preview === null ? (
          <button
            type="submit"
            disabled={busy || tooShort}
            className="py-3 border border-accent-teal text-accent-teal rounded-lg font-mono font-bold text-sm disabled:opacity-40 hover:bg-accent-teal/10 transition-colors"
          >
            {busy ? 'Checking… (the AI check can take up to 30 seconds)' : 'Preview redaction'}
          </button>
        ) : (
          <>
            <div className="p-4 bg-navy-800 rounded-xl border border-gray-800">
              <div className="text-xs font-mono text-gray-600 uppercase tracking-widest mb-3">
                Redacted version
              </div>
              {!aiChecked && (
                <div className="text-xs font-mono text-yellow-600 mb-3">
                  The AI check could not run just now, so only the pattern rules were used. Read it
                  carefully, or preview again in a minute.
                </div>
              )}
              <p className="font-mono text-sm text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
                {preview}
              </p>
            </div>
            <div className="flex items-start gap-3 p-3 bg-navy-800 rounded-lg border border-gray-800 text-xs font-mono text-gray-500 leading-relaxed">
              <span className="text-yellow-500">⚠</span>
              <span>
                Check that no name, number or place that identifies you or anyone else is still
                readable above. Redaction uses pattern rules and an AI model, and both can miss
                things, especially in languages other than English. Edit your text to remove
                anything they missed. A disclosure cannot be changed or deleted afterwards.
              </span>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy || tooShort}
              className="py-3 bg-accent-red text-white rounded-lg font-mono font-bold text-sm disabled:opacity-40 hover:bg-accent-red/80 transition-colors"
            >
              {busy ? 'Submitting…' : 'Submit Disclosure'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
