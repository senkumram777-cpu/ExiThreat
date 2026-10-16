'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth, type ContactChannel } from '@/lib/api';
import { saveSession } from '@/lib/session';
import ContactVerifier from '@/components/ContactVerifier';
import PasswordInput from '@/components/PasswordInput';

const inputClass =
  'bg-navy-800 border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal';

/** A new password, proved with a code to the account's email address or mobile number. */
export default function ResetPage() {
  const router = useRouter();
  const [channel, setChannel] = useState<ContactChannel>('email');
  const [proof, setProof] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const choose = (next: ContactChannel) => {
    setChannel(next);
    setProof(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!proof) {
      setError('Confirm the code first');
      return;
    }
    if (password !== repeatPassword) {
      setError('The two passwords are not the same');
      return;
    }
    setLoading(true);
    try {
      const session = await auth.reset(channel, proof, password);
      saveSession(session);
      router.push(session.needsContact ? '/account/contact' : '/groups');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const tab = (value: ContactChannel, label: string) => (
    <button
      type="button"
      onClick={() => choose(value)}
      className={[
        'flex-1 py-2 rounded-lg font-mono text-xs border transition-colors',
        channel === value ? 'border-accent-teal text-accent-teal' : 'border-gray-700 text-gray-500',
      ].join(' ')}
    >
      {label}
    </button>
  );

  return (
    <div className="max-w-sm mx-auto mt-12">
      <h1 className="text-2xl font-mono font-bold text-accent-red mb-2 text-center">Reset Password</h1>
      <p className="text-xs font-mono text-gray-500 text-center mb-6">
        We send a code to the email address or mobile number of your account.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex gap-2">
          {tab('email', 'Email')}
          {tab('phone', 'Mobile')}
        </div>
        <ContactVerifier key={channel} channel={channel} onVerified={setProof} />
        <label className="flex flex-col gap-1 text-xs font-mono text-gray-400">
          New password (at least 8 characters)
          <PasswordInput
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            maxLength={72}
            required
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-mono text-gray-400">
          New password again
          <PasswordInput
            autoComplete="new-password"
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
            minLength={8}
            maxLength={72}
            required
            className={inputClass}
          />
        </label>
        <p className="text-xs font-mono text-gray-500 leading-relaxed">
          Every device signed in to the account is signed out.
        </p>
        {error && <div className="text-accent-red text-xs font-mono">{error}</div>}
        <button
          type="submit"
          disabled={loading || !proof}
          className="py-3 bg-accent-red text-white rounded-lg font-mono font-bold text-sm disabled:opacity-50 hover:bg-accent-red/80 transition-colors"
        >
          {loading ? 'Saving…' : 'Set New Password'}
        </button>
      </form>
      <p className="text-center text-xs font-mono text-gray-500 mt-4">
        <Link href="/auth/login" className="text-accent-teal">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
