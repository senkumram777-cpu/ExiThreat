'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/api';
import { clearSession } from '@/lib/session';
import PasswordInput from '@/components/PasswordInput';

/** Deletes the signed-in member's account, after their password and a second "yes". */
export default function DeleteAccount() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!sure) {
      setSure(true);
      return;
    }
    setBusy(true);
    try {
      await auth.deleteAccount(password);
      clearSession();
      router.push('/');
    } catch (err) {
      setError((err as Error).message);
      setSure(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h2 className="text-sm font-mono text-accent-red uppercase tracking-widest">Delete account</h2>
      <p className="text-xs font-mono text-gray-500 leading-relaxed">
        Deletes your account for good, with your disclosures, comments, chat messages, votes and usage records.
        It cannot be undone. Your email address and mobile number can then be used for a new account.
      </p>
      <label className="flex flex-col gap-1 text-xs font-mono text-gray-400">
        Your password
        <PasswordInput
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setSure(false);
          }}
          required
          className="bg-navy-800 border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-red"
        />
      </label>
      {error && <div className="text-accent-red text-xs font-mono">{error}</div>}
      <button
        type="submit"
        disabled={busy}
        className={`py-3 rounded-lg font-mono font-bold text-sm disabled:opacity-50 transition-colors ${
          sure ? 'bg-accent-red text-white' : 'border border-accent-red text-accent-red hover:bg-accent-red/10'
        }`}
      >
        {busy ? 'Deleting…' : sure ? 'Yes, delete everything for good' : 'Delete my account'}
      </button>
    </form>
  );
}
