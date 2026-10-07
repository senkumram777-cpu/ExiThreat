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
 *
 * When the ProMic user's phone cannot be reached, the first code can come another way instead,
 * if that user allows it: from one of their Connected Users ("circle"), and after that from a
 * ProMic administrator against a case reference ("admin").
 *
 * Once signed in, the officer also sees AreaDashboard: a map to mark their station on, the AI
 * threat and SOS alerts for that area, and live streams shared with law enforcement.
 */

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import AreaDashboard from './AreaDashboard';

const LE_BASE =
  process.env.NEXT_PUBLIC_PROMIC_LE_URL ?? 'https://asia-south1-promic-c5567.cloudfunctions.net';

// The session token from leLogin and the request in progress, kept for this browser tab only:
// closing the tab signs out.
const SESSION_KEY = 'exithreat_le_session';
const REQUEST_KEY = 'exithreat_le_request';
const SESSION_ENDED = 'Sign in again.';
const ADMIN_POLL_MS = 20_000;

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

type Step = 'login' | 'host' | 'hostCode' | 'fallback' | 'adminWait' | 'emailCode' | 'audio';
type Via = 'host' | 'circle' | 'admin';
type Route = 'circle' | 'admin';

/** What survives a page reload while a request is under way. */
interface SavedRequest {
  requestId: string;
  step: Step;
  via: Via;
  fallbackOpensAt: number | null;
}

interface FallbackStatus {
  via: Via;
  verified: boolean;
  opensAt: number;
  open: boolean;
  allowed: boolean;
  routes: Route[];
  adminStatus: 'pending' | 'approved' | 'rejected' | null;
}

function load<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function store(key: string, value: unknown | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    // Storage blocked: the state just lasts until this page is reloaded.
  }
}

const formatDuration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
};

const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const inputClass =
  'bg-navy-800 border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal';
const primaryClass =
  'py-3 bg-accent-red text-white rounded-lg font-mono font-bold text-sm disabled:opacity-50 hover:bg-accent-red/80 transition-colors';
const secondaryClass =
  'py-3 border border-gray-700 text-gray-300 rounded-lg font-mono font-bold text-sm disabled:opacity-50 hover:border-gray-500 transition-colors';
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

  // The fallback for a phone that cannot be reached.
  const [via, setVia] = useState<Via>('host');
  const [fallbackOpensAt, setFallbackOpensAt] = useState<number | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [reason, setReason] = useState('');
  const [caseRef, setCaseRef] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const [hostName, setHostName] = useState('');
  const [segment, setSegment] = useState<Segment | null>(null);
  const [accessExpiresAt, setAccessExpiresAt] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // sessionStorage only exists in the browser, so saved state is picked up after mount.
  useEffect(() => {
    const savedSession = load<Session>(SESSION_KEY);
    if (savedSession && savedSession.expiresAt > Date.now()) {
      setSession(savedSession);
      const saved = load<SavedRequest>(REQUEST_KEY);
      if (saved) {
        setRequestId(saved.requestId);
        setVia(saved.via);
        setFallbackOpensAt(saved.fallbackOpensAt);
        setStep(saved.step);
      } else {
        setStep('host');
      }
    }
    // The decrypted recording lives only in this tab's memory; drop it when the page goes.
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  // Remember where the request stands, except once the recording is open: that step needs both
  // codes again after a reload.
  useEffect(() => {
    const resumable = requestId && ['hostCode', 'fallback', 'adminWait', 'emailCode'].includes(step);
    store(REQUEST_KEY, resumable ? { requestId, step, via, fallbackOpensAt } : null);
  }, [requestId, step, via, fallbackOpensAt]);

  // Keeps "you can ask another way from 14:35" honest while the officer waits.
  useEffect(() => {
    if (step !== 'hostCode') return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [step]);

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
    setVia('host');
    setFallbackOpensAt(null);
    setRoutes([]);
    setReason('');
    setCaseRef('');
    setError(null);
    setNote(null);
    setStep(to);
  }

  function signOut() {
    store(SESSION_KEY, null);
    setSession(null);
    reset('login');
  }

  function fail(err: unknown) {
    const message = (err as Error).message || 'Something went wrong. Try again.';
    // The session ended: 8 hours passed, the password was reset, or the account was disabled.
    if (message === SESSION_ENDED) {
      signOut();
      setError('Your session has ended. Sign in again.');
    } else {
      setError(message);
    }
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  // While an administrator decides, ask the server now and then how the request stands.
  useEffect(() => {
    if (step !== 'adminWait' || !requestId || !session) return;
    let cancelled = false;
    const check = async () => {
      try {
        const status: FallbackStatus = await callJson('leFallbackStatus', { requestId }, session.token);
        if (cancelled) return;
        if (status.adminStatus === 'approved') {
          setNote(`An administrator approved your request. A code has been sent to ${session.email}; it lasts 60 minutes.`);
          setStep('emailCode');
        } else if (status.adminStatus === 'rejected') {
          reset('host');
          setError('The administrator did not approve this request.');
        }
      } catch (err) {
        if (!cancelled) fail(err);
      }
    };
    check();
    const timer = setInterval(check, ADMIN_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, requestId, session]);

  const onLogin = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const data = await callJson('leLogin', { email, password });
      const next = { token: data.token, email: data.email, expiresAt: data.expiresAt };
      store(SESSION_KEY, next);
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
      setFallbackOpensAt(data.fallbackOpensAt ?? null);
      setVia('host');
      setCode('');
      setNote(null);
      setNow(Date.now());
      setStep('hostCode');
    });
  };

  const onFirstCode = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const data = await callJson('leVerifyHostCode', { requestId, code }, session?.token);
      setCode('');
      setNote(
        data.delivery === 'outbox'
          ? 'Email sending is not set up on this system yet. Ask the administrator for the code.'
          : `A second code has been sent to ${session?.email || 'your registered email'}. It lasts 10 minutes.`,
      );
      setStep('emailCode');
    });
  };

  // "The phone can't be reached" (and, on the Connected User route, "nobody can give a code"):
  // ask the server which other ways are open for this request right now.
  const openFallback = () =>
    run(async () => {
      const status: FallbackStatus = await callJson('leFallbackStatus', { requestId }, session?.token);
      if (!status.allowed) {
        throw new Error('This ProMic user has chosen not to allow access when their phone cannot be reached.');
      }
      if (!status.open) {
        setFallbackOpensAt(status.opensAt);
        throw new Error(`The ProMic user still has time to answer. You can ask another way from ${formatTime(status.opensAt)}.`);
      }
      if (status.routes.length === 0) {
        throw new Error(
          status.via === 'circle'
            ? 'The people asked can still give you a code. If none of them does, the code expires after 10 minutes and you can try again here.'
            : 'There is no other way to approve this request.',
        );
      }
      setRoutes(status.routes);
      setStep('fallback');
    });

  const startFallback = (route: Route) =>
    run(async () => {
      const data = await callJson('leStartFallback', { requestId, route, reason, caseRef }, session?.token);
      setCode('');
      setVia(route);
      if (route === 'circle') {
        const people = data.approvers === 1 ? '1 person' : `${data.approvers} people`;
        setNote(`A code is now showing in the ProMic app of ${people} this user trusts with their backups.`);
        setStep('hostCode');
      } else {
        setNote(null);
        setStep('adminWait');
      }
    });

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

  const fallbackOpen = fallbackOpensAt !== null && now >= fallbackOpensAt;

  const onDashboardSessionEnded = useCallback(() => {
    store(SESSION_KEY, null);
    setSession(null);
    setStep('login');
    setError('Your session has ended. Sign in again.');
  }, []);

  return (
    <div className={`${step === 'host' ? 'max-w-2xl' : 'max-w-sm'} mx-auto mt-12`}>
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

      {step === 'host' && session && (
        <div className="mb-6">
          <AreaDashboard baseUrl={LE_BASE} token={session.token} onSessionEnded={onDashboardSessionEnded} />
        </div>
      )}

      {step === 'host' && (
        <form onSubmit={onRequest} className="flex flex-col gap-4 p-4 bg-navy-800 rounded-xl border border-gray-800">
          <div className="font-mono font-bold text-sm text-accent-teal">Request Access To A Recording</div>
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

      {step === 'hostCode' && (
        <form onSubmit={onFirstCode} className="flex flex-col gap-4">
          <p className={introClass}>
            {via === 'circle'
              ? 'Step 1 of 2. Ask one of those people for the 6-digit code showing in their ProMic app, and enter it here. The code lasts 10 minutes, and they can refuse.'
              : 'Step 1 of 2. Ask the ProMic user to open the app: it is showing them a 6-digit code. Enter it here. The code lasts 10 minutes, and they can refuse.'}
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
            className={`${inputClass} tracking-[0.3em]`}
          />
          <button type="submit" disabled={busy || code.length !== 6} className={primaryClass}>
            {busy ? 'Checking…' : 'Verify'}
          </button>

          <div className="p-4 bg-navy-800 rounded-xl border border-gray-800 flex flex-col gap-3">
            {via === 'circle' ? (
              <>
                <p className={introClass}>
                  Nobody can give you a code? Once this one has expired, or everyone has refused, you
                  can ask a ProMic administrator.
                </p>
                <button type="button" onClick={openFallback} disabled={busy} className={secondaryClass}>
                  Nobody Can Give A Code
                </button>
              </>
            ) : (
              <>
                <p className={introClass}>
                  Phone lost, broken or switched off?{' '}
                  {fallbackOpen
                    ? 'You can now ask another way.'
                    : fallbackOpensAt
                      ? `The ProMic user has until ${formatTime(fallbackOpensAt)} to answer. After that you can ask another way.`
                      : 'If the ProMic user does not answer, you can ask another way after 15 minutes.'}
                </p>
                <button
                  type="button"
                  onClick={openFallback}
                  disabled={busy || !fallbackOpen}
                  className={secondaryClass}
                >
                  The Phone Can&apos;t Be Reached
                </button>
              </>
            )}
          </div>

          <button type="button" onClick={() => reset('host')} className={secondaryClass}>
            Start Again
          </button>
        </form>
      )}

      {step === 'fallback' && (
        <div className="flex flex-col gap-4">
          <p className={introClass}>
            Say why the ProMic user&apos;s phone cannot be reached. This is recorded against your
            account, shown to whoever is asked to approve, and the ProMic user is told afterwards.
          </p>
          <textarea
            placeholder="For example: reported missing since 4 October, phone switched off."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            className={inputClass}
          />
          {routes.includes('circle') && (
            <>
              <p className={introClass}>
                A person the ProMic user trusts with their backups will see a code in their own
                ProMic app, and can give it to you or refuse.
              </p>
              <button
                onClick={() => startFallback('circle')}
                disabled={busy || reason.trim().length < 10}
                className={primaryClass}
              >
                {busy ? 'Sending…' : 'Ask A Person They Trust'}
              </button>
            </>
          )}
          {routes.includes('admin') && (
            <>
              <p className={introClass}>
                A ProMic administrator will check your case reference and approve or reject. This
                can take a while; you will get an email when it is approved.
              </p>
              <input
                type="text"
                placeholder="Case, FIR or court order reference"
                value={caseRef}
                onChange={(e) => setCaseRef(e.target.value)}
                maxLength={80}
                className={inputClass}
              />
              <button
                onClick={() => startFallback('admin')}
                disabled={busy || reason.trim().length < 10 || caseRef.trim().length < 3}
                className={primaryClass}
              >
                {busy ? 'Sending…' : 'Ask A ProMic Administrator'}
              </button>
            </>
          )}
          <button onClick={() => setStep('hostCode')} disabled={busy} className={secondaryClass}>
            Back
          </button>
        </div>
      )}

      {step === 'adminWait' && (
        <div className="flex flex-col gap-4">
          <div className="p-4 bg-navy-800 rounded-xl border border-gray-800">
            <div className="font-mono font-bold text-sm text-accent-teal">Waiting for an administrator</div>
            <p className={`${introClass} mt-2`}>
              Your request and case reference are with a ProMic administrator. When it is approved,
              a code is emailed to {session?.email || 'you'} and this page moves on by itself. You
              can keep this tab open, or sign in again later from the same browser tab.
            </p>
          </div>
          <button onClick={() => reset('host')} className={secondaryClass}>
            Cancel And Start Again
          </button>
        </div>
      )}

      {step === 'emailCode' && (
        <form onSubmit={onEmailCode} className="flex flex-col gap-4">
          <p className={introClass}>Step 2 of 2. Enter the 6-digit code that was emailed to you.</p>
          {note && <p className={introClass}>{note}</p>}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
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
