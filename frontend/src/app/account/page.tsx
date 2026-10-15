'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, type MyWeight } from '@/lib/api';
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
  const [weight, setWeight] = useState<MyWeight | null>(null);
  const [pseudonym, setPseudonym] = useState<string | null>(null);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace('/auth/login');
      return;
    }
    setUsername(session.username);
    auth.myWeight().then(setWeight).catch(() => {});
    auth.me().then((me) => setPseudonym(me.pseudonym)).catch(() => {});
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

      {pseudonym && (
        <div className="p-4 bg-navy-800 rounded-xl border border-gray-800 font-mono">
          <div className="text-xs text-gray-400 uppercase tracking-widest mb-2">Your Pseudonym</div>
          <div className="text-lg font-bold text-accent-teal">{pseudonym}</div>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">
            Your posts show this name, in groups and on the common page, never your username.
            Only you see the two together.
          </p>
        </div>
      )}

      {weight && <WeightCard weight={weight} />}

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

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The member's own weightage and what it is made of. Only they see it. */
function WeightCard({ weight: w }: { weight: MyWeight }) {
  const rows: Array<{ label: string; score: number | null; detail: string }> = [
    {
      label: 'Activity',
      score: w.activityScore,
      detail: `${w.activeDays} day${w.activeDays !== 1 ? 's' : ''} of use, ${w.minutes} min on the site`,
    },
    { label: 'Posting', score: w.postScore, detail: `${w.posts} post${w.posts !== 1 ? 's' : ''}` },
    {
      label: 'Voting',
      score: w.voteScore,
      detail: w.due > 0 ? `${w.reviewed} of ${w.due} posts gone through` : 'no post to go through yet',
    },
  ];
  return (
    <section className="p-4 bg-navy-800 rounded-xl border border-gray-800 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-mono text-gray-400 uppercase tracking-widest">Your weightage</h2>
        <span className="text-lg font-mono font-bold text-accent-teal">{pct(w.weight)}</span>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-1">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-gray-300">{row.label}</span>
            <span className="text-gray-400">{row.score === null ? '—' : pct(row.score)}</span>
          </div>
          <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
            <div className="h-full bg-accent-teal rounded-full" style={{ width: pct(row.score ?? 0) }} />
          </div>
          <div className="text-xs font-mono text-gray-600">{row.detail}</div>
        </div>
      ))}
      <p className="text-xs font-mono text-gray-500 leading-relaxed">
        Over the last {w.windowDays} day{w.windowDays !== 1 ? 's' : ''}. Full marks: using ExiThreat
        every other day for about 10 minutes, a post a week, and going through every post that
        reaches your group (reading the original to the end, then its redacted version). Only you
        see this.
      </p>
    </section>
  );
}
