'use client';

import { useState } from 'react';
import { posts as postsApi, type OfficerRequest } from '@/lib/api';

const WHEN: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

/**
 * On one of the author's own disclosures: police officers who asked to see what a complaint
 * about the police keeps from them (its exact words, the author's pseudonym and mobile number).
 * The author allows or refuses each one, and can change their mind.
 */
export default function OfficerRequests({ postId, requests }: { postId: string; requests: OfficerRequest[] }) {
  const [list, setList] = useState(requests);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (list.length === 0) return null;

  const answer = async (id: string, allow: boolean) => {
    setBusy(id);
    setError(null);
    try {
      const updated = await postsApi.answerOfficer(postId, id, allow);
      setList((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const button = 'px-3 py-1.5 rounded-lg font-bold disabled:opacity-40 transition-colors';
  return (
    <div className="mt-2 p-3 rounded-xl border border-yellow-700/50 bg-navy-900 flex flex-col gap-3 text-xs font-mono">
      <p className="text-gray-400 leading-relaxed">
        This disclosure is about the police, so officers see only its redacted version. Allowing an
        officer shows them your exact words, your pseudonym and your mobile number.
      </p>
      {list.map((r) => (
        <div key={r.id} className="flex flex-col gap-2 border-t border-gray-800 pt-2">
          <p className="text-gray-300">
            {r.status === 'pending' && 'An officer asked to see your details'}
            {r.status === 'granted' && 'You allowed an officer to see your details'}
            {r.status === 'refused' && 'You refused an officer'}
            {' '}<span className="text-gray-500">({r.branch || 'branch not given'}, asked {new Date(r.createdAt).toLocaleString([], WHEN)})</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {r.status !== 'granted' && (
              <button type="button" disabled={busy !== null} onClick={() => answer(r.id, true)}
                className={`${button} border border-accent-teal text-accent-teal hover:bg-accent-teal/10`}>
                {busy === r.id ? '…' : 'Allow'}
              </button>
            )}
            {r.status !== 'refused' && (
              <button type="button" disabled={busy !== null} onClick={() => answer(r.id, false)}
                className={`${button} border border-gray-600 text-gray-300 hover:border-accent-red hover:text-accent-red`}>
                {busy === r.id ? '…' : r.status === 'granted' ? 'Take back' : 'Refuse'}
              </button>
            )}
          </div>
        </div>
      ))}
      {error && <p className="text-accent-red">{error}</p>}
    </div>
  );
}
