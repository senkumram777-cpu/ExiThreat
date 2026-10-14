'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/api';
import { clearSession, getSession, saveSession } from '@/lib/session';

const inputClass =
  'bg-navy-800 border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal';

export default function AccountPage() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace('/auth/login');
      return;
    }
    setUsername(session.username);
  }, [router]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (newPassword !== repeatPassword) {
      setError('The two new passwords are not the same');
      return;
    }
    setSaving(true);
    try {
      // The reply carries a new token; every other device is signed out.
      saveSession(await auth.changePassword(currentPassword, newPassword));
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
      setNotice('Password changed. Other devices have been signed out.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const signOut = () => {
    clearSession();
    router.push('/');
  };

  const signOutEverywhere = async () => {
    setError(null);
    try {
      await auth.signOutAll();
      signOut();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (username === null) return null;

  return (
    <div className="max-w-sm mx-auto flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-mono font-bold text-accent-teal">Account</h1>
        <p className="text-xs font-mono text-gray-500 mt-1">Signed in as {username}</p>
      </div>

      <section className="flex flex-col gap-3">
        <button
          onClick={signOut}
          className="py-3 border border-gray-600 text-gray-200 rounded-lg font-mono font-bold text-sm hover:border-accent-teal transition-colors"
        >
          Sign out
        </button>
        <button
          onClick={signOutEverywhere}
          className="py-3 border border-gray-700 text-gray-400 rounded-lg font-mono text-sm hover:border-accent-red hover:text-accent-red transition-colors"
        >
          Sign out on all devices
        </button>
      </section>

      <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
        <h2 className="text-sm font-mono text-gray-400 uppercase tracking-widest">Change password</h2>
        <p className="text-xs font-mono text-gray-500 leading-relaxed">
          Forgot it? Sign out and use &quot;Forgot password?&quot; on the sign-in page: a code is
          sent to your email address or mobile number.
        </p>
        <label className="flex flex-col gap-1 text-xs font-mono text-gray-400">
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-mono text-gray-400">
          New password (at least 8 characters)
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            maxLength={72}
            required
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-mono text-gray-400">
          New password again
          <input
            type="password"
            autoComplete="new-password"
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
            minLength={8}
            maxLength={72}
            required
            className={inputClass}
          />
        </label>
        {error && <div className="text-accent-red text-xs font-mono">{error}</div>}
        {notice && <div className="text-green-400 text-xs font-mono">{notice}</div>}
        <button
          type="submit"
          disabled={saving}
          className="py-3 bg-accent-teal text-navy-900 rounded-lg font-mono font-bold text-sm disabled:opacity-50 hover:bg-accent-teal/80 transition-colors"
        >
          {saving ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
