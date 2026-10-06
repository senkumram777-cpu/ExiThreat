'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/api';

export default function LoginPage() {
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
      const res = await auth.login(username, password);
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
      <h1 className="text-2xl font-mono font-bold text-accent-red mb-6 text-center">Sign In</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="bg-navy-800 border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
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
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
      <p className="text-center text-xs font-mono text-gray-500 mt-4">
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
