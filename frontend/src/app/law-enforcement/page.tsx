'use client';

/**
 * Law-enforcement access to a ProMic recording.
 *
 * Officers are not ExiThreat users. Their accounts are created by a ProMic administrator, and
 * this page talks only to ProMic's law-enforcement endpoints (ProMic repo, functions/le.js):
 * sign in, name the ProMic user by mobile number, enter the code that user sees in their ProMic
 * app, enter the code emailed to the officer, then listen to that user's most recent audio
 * backup. Nothing here uses the ExiThreat token or backend, so an officer gets no access to
 * groups, posts or chat.
 */

import { FormEvent, useEffect, useRef, useState } from 'react';

const LE_BASE =
  process.env.NEXT_PUBLIC_PROMIC_LE_URL ?? 'https://asia-south1-promic-c5567.cloudfunctions.net';

// The session token from leLogin, kept for this browser tab only: closing the tab signs out.
const SESSION_KEY = 'exithreat_le_session';
const SESSION_ENDED = 'Sign in again.';

interface Session {
  token: string;
  email: string;
  expiresAt: number;
}

interface Segment {
  startTimestamp: number;
  durationMs: number;
  createdAt: number;
}

type Step = 'login' | 'host' | 'hostCode' | 'emailCode' | 'audio';

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const session = raw ? (JSON.parse(raw) as Session) : null;
    return session && session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function storeSession(session: Session | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked: the session just lasts until this page is reloaded.
  }
}

const formatDuration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
};

const inputClass =
  'bg-navy-800 border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal';
const primaryClass =
  'py-3 bg-accent-red text-white rounded-lg font-mono font-bold text-sm disabled:opacity-50 hover:bg-accent-red/80 transition-colors';
const secondaryClass =
  'py-3 border border-gray-700 text-gray-300 rounded-lg font-mono font-bold text-sm hover:border-gray-500 transition-colors';
const introClass = 'font-mono text-xs text-gray-400 leading-relaxed';

export default function LawEnforcementPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [step, setStep] = useState<Step>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hostPhone, setHostPhone] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const [hostName, setHostName] = useState('');
  const [segment, setSegment] = useState<Segment | null>(null);
  const [accessExpiresAt, setAccessExpiresAt] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // sessionStorage only exists in the browser, so the saved session is picked up after mount.
  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setSession(saved);
      setStep('host');
    }
    // The decrypted recording lives only in this tab's memory; drop it when the page goes.
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  async function call(path: string, body: unknown, token?: string): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${LE_BASE}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  async function callJson(path: string, body: unknown, token?: string) {
    const res = await call(path, body, token);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    return data;
  }

  function reset(to: Step) {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setAudioUrl(null);
    setSegment(null);
    setAccessExpiresAt(null);
    setRequestId(null);
    setCode('');
    setError(null);
    setNote(null);
    setStep(to);
  }

  function signOut() {
    storeSession(null);
    setSession(null);
    reset('login');
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      const message = (err as Error).message || 'Something went wrong. Try again.';
      // The session ended: 8 hours passed, the password was reset, or the account was disabled.
      if (message === SESSION_ENDED) {
        signOut();
        setError('Your session has ended. Sign in again.');
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  const onLogin = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const data = await callJson('leLogin', { email, password });
      const next = { token: data.token, email: data.email, expiresAt: data.expiresAt };
      storeSession(next);
      setSession(next);
      setPassword('');
      setStep('host');
    });
  };

  const onRequest = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const data = await callJson('leRequestAccess', { hostPhone }, session?.token);
      setRequestId(data.requestId);
      setCode('');
      setNote(null);
      setStep('hostCode');
    });
  };

  const onHostCode = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const data = await callJson('leVerifyHostCode', { requestId, code }, session?.token);
      setCode('');
      setNote(
        data.delivery === 'outbox'
          ? 'Email sending is not set up on this system yet. Ask the administrator for the code.'
          : `A second code has been sent to ${session?.email || 'your registered email'}.`,
      );
      setStep('emailCode');
    });
  };

  const onEmailCode = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const data = await callJson('leVerifyEmailCode', { requestId, code }, session?.token);
      setCode('');
      setNote(null);
      setHostName(data.hostName || 'ProMic user');
      setSegment(data.segment ?? null);
      setAccessExpiresAt(data.accessExpiresAt ?? null);
      setStep('audio');
    });
  };

  const loadAudio = () =>
    run(async () => {
      const res = await call('leGetAudio', { requestId }, session?.token);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not load the audio.');
      }
      const url = URL.createObjectURL(await res.blob());
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = url;
      setAudioUrl(url);
    });

  return (
    <div className="max-w-sm mx-auto mt-12">
      <h1 className="text-2xl font-mono font-bold text-accent-red mb-2 text-center">
        Law Enforcement
      </h1>
      <p className="text-center text-xs font-mono text-gray-500 mb-6">ProMic recording access</p>

      {step === 'login' && (
        <form onSubmit={onLogin} className="flex flex-col gap-4">
          <p className={introClass}>Sign in with the credentials that were emailed to you.</p>
          <input
            type="text"
            inputMode="email"
            autoComplete="username"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={inputClass}
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={inputClass}
          />
          <button type="submit" disabled={busy} className={primaryClass}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      )}

      {step === 'host' && (
        <form onSubmit={onRequest} className="flex flex-col gap-4">
          <p className={introClass}>
            Enter the mobile number of the ProMic user whose recording you need. A code will appear
            inside the ProMic app on their phone, and they must give it to you.
          </p>
          <input
            type="tel"
            placeholder="+91 98765 43210"
            value={hostPhone}
            onChange={(e) => setHostPhone(e.target.value)}
            required
            className={inputClass}
          />
          <button type="submit" disabled={busy} className={primaryClass}>
            {busy ? 'Sending…' : 'Request Access'}
          </button>
        </form>
      )}

      {(step === 'hostCode' || step === 'emailCode') && (
        <form onSubmit={step === 'hostCode' ? onHostCode : onEmailCode} className="flex flex-col gap-4">
          <p className={introClass}>
            {step === 'hostCode'
              ? 'Step 1 of 2. Ask the ProMic user to open the app: it is showing them a 6-digit code. Enter it here. The code lasts 10 minutes, and they can refuse.'
              : 'Step 2 of 2. Enter the 6-digit code that was emailed to you. It lasts 10 minutes.'}
          </p>
          {note && <p className={introClass}>{note}</p>}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
            className={`${inputClass} tracking-[0.3em]`}
          />
          <button type="submit" disabled={busy || code.length !== 6} className={primaryClass}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
          <button type="button" onClick={() => reset('host')} className={secondaryClass}>
            Start Again
          </button>
        </form>
      )}

      {step === 'audio' && (
        <div className="flex flex-col gap-4">
          {segment ? (
            <>
              <div className="p-4 bg-navy-800 rounded-xl border border-gray-800">
                <div className="font-mono text-xs text-gray-400">Most recent audio backup of</div>
                <div className="font-mono font-bold text-sm text-accent-teal mt-1">{hostName}</div>
                <div className="font-mono text-xs text-gray-400 mt-2">
                  Recorded {new Date(segment.startTimestamp || segment.createdAt).toLocaleString()} ·{' '}
                  {formatDuration(segment.durationMs)}
                </div>
              </div>
              {audioUrl ? (
                <audio
                  controls
                  controlsList="nodownload noplaybackrate"
                  onContextMenu={(e) => e.preventDefault()}
                  src={audioUrl}
                  className="w-full"
                />
              ) : (
                <button onClick={loadAudio} disabled={busy} className={primaryClass}>
                  {busy ? 'Loading…' : 'Load Recording'}
                </button>
              )}
              <p className={introClass}>
                Listening only: this is the only recording available to you, and nothing can be
                changed or deleted.{' '}
                {accessExpiresAt && `Access ends at ${new Date(accessExpiresAt).toLocaleTimeString()}. `}
                This access has been logged.
              </p>
            </>
          ) : (
            <p className={introClass}>{hostName} has no audio backup at the moment.</p>
          )}
          <button onClick={() => reset('host')} className={secondaryClass}>
            New Request
          </button>
        </div>
      )}

      {error && <div className="text-accent-red text-xs font-mono mt-4">{error}</div>}

      {session && (
        <p className="text-center text-xs font-mono text-gray-500 mt-8">
          Signed in as {session.email}.{' '}
          <button onClick={signOut} className="text-accent-teal">
            Sign out
          </button>
        </p>
      )}
    </div>
  );
}
