'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/api';
import { saveSession } from '@/lib/session';

const inputClass =
  'bg-navy-800 border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);

  // Sent here by the API client when a session has run out (see lib/api.ts).
  useEffect(() => {
    setExpired(new URLSearchParams(window.location.search).has('expired'));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const session = await auth.login(identifier, password);
      saveSession(session);
      router.push(session.needsContact ? '/account/contact' : '/groups');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto mt-12">
      <h1 className="text-2xl font-mono font-bold text-accent-red mb-6 text-center">Sign In</h1>
      {expired && (
        <div className="text-yellow-500 text-xs font-mono text-center mb-4">
          You have been signed out. Please sign in again.
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-xs font-mono text-gray-400">
          Username, email or mobile number
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-mono text-gray-400">
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={inputClass}
          />
        </label>
        {error && <div className="text-accent-red text-xs font-mono">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="py-3 bg-accent-red text-white rounded-lg font-mono font-bold text-sm disabled:opacity-50 hover:bg-accent-red/80 transition-colors"
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
      <p className="text-center text-xs font-mono text-gray-500 mt-4">
        <Link href="/auth/reset" className="text-accent-teal">
          Forgot password?
        </Link>
      </p>
      <p className="text-center text-xs font-mono text-gray-500 mt-2">
        No account?{' '}
        <Link href="/auth/register" className="text-accent-teal">
          Register anonymously
        </Link>
      </p>
      <p className="text-center text-xs font-mono text-gray-500 mt-2">
        Police officer?{' '}
        <Link href="/law-enforcement" className="text-accent-teal">
          Law enforcement sign in
        </Link>
      </p>
    </div>
  );
}
