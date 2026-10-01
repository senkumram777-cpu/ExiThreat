'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await auth.register(username, password);
      localStorage.setItem('exithreat_token', res.token);
      localStorage.setItem('exithreat_userId', res.userId);
      localStorage.setItem('exithreat_username', res.username);
      router.push('/groups');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto mt-12">
      <h1 className="text-2xl font-mono font-bold text-accent-red mb-2 text-center">
        Register Anonymously
      </h1>
      <p className="text-xs font-mono text-gray-500 text-center mb-6">
        Use a pseudonym — do not use your real name.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="text"
          placeholder="Pseudonym (≥ 3 chars)"
          value={username}
          minLength={3}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="bg-navy-800 border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal"
        />
        <input
          type="password"
          placeholder="Password (≥ 8 chars)"
          value={password}
          minLength={8}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="bg-navy-800 border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal"
        />
        {error && <div className="text-accent-red text-xs font-mono">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="py-3 bg-accent-red text-white rounded-lg font-mono font-bold text-sm disabled:opacity-50 hover:bg-accent-red/80 transition-colors"
        >
          {loading ? 'Creating account…' : 'Create Account'}
        </button>
      </form>
      <p className="text-center text-xs font-mono text-gray-500 mt-4">
        Already registered?{' '}
        <Link href="/auth/login" className="text-accent-teal">
          Sign in
        </Link>
      </p>
    </div>
  );
}
