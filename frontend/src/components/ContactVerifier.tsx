'use client';

import { useEffect, useRef, useState } from 'react';
import type { ConfirmationResult } from 'firebase/auth';
import { auth, type ContactChannel } from '@/lib/api';
import { confirmPhoneCode, indianMobile, sendPhoneCode } from '@/lib/firebasePhone';

// Local test builds only: no SMS, any 6 digits, and the server is sent a test token that a
// hosted server refuses.
const PHONE_TEST = process.env.NEXT_PUBLIC_PHONE_TEST === '1';
const RESEND_SECONDS = 60;

const inputClass =
  'flex-1 min-w-0 bg-navy-800 border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal disabled:opacity-60';
const buttonClass =
  'shrink-0 px-4 py-3 border border-accent-teal text-accent-teal rounded-lg font-mono text-xs font-bold hover:bg-accent-teal/10 transition-colors disabled:opacity-40';

const LABELS: Record<ContactChannel, { label: string; placeholder: string; type: string; autoComplete: string }> = {
  email: { label: 'Email address', placeholder: 'you@example.com', type: 'email', autoComplete: 'email' },
  phone: { label: 'Mobile number (India)', placeholder: '98765 43210', type: 'tel', autoComplete: 'tel-national' },
};

interface Props {
  channel: ContactChannel;
  /** The id of the confirmed verification, or null when it is no longer confirmed. */
  onVerified: (verificationId: string | null) => void;
}

/**
 * One email address or mobile number: send a code, enter it, and it is confirmed. The
 * confirmation's id is what sign-up, a password reset or adding contact details sends on.
 * Email codes come from our server; SMS codes from Firebase (lib/firebasePhone.ts).
 */
export default function ContactVerifier({ channel, onVerified }: Props) {
  const text = LABELS[channel];
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  // Phone only: the pending Firebase confirmation, and where its reCAPTCHA attaches.
  const confirmation = useRef<ConfirmationResult | null>(null);
  const recaptcha = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      if (channel === 'phone') {
        const e164 = indianMobile(value);
        if (!e164) throw new Error('Enter a valid Indian mobile number (10 digits, starting with 6, 7, 8 or 9)');
        if (!PHONE_TEST) confirmation.current = await sendPhoneCode(e164, recaptcha.current!);
        // The id is only known once the code is confirmed; this marks "code sent".
        setVerificationId(`pending:${e164}`);
        setResendIn(RESEND_SECONDS);
      } else {
        const started = await auth.verifyStart(channel, value);
        setVerificationId(started.verificationId);
        setResendIn(started.resendInSeconds);
      }
      setCode('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    if (!verificationId) return;
    setBusy(true);
    setError(null);
    try {
      if (channel === 'phone') {
        const e164 = verificationId.replace('pending:', '');
        const idToken = PHONE_TEST ? `test-phone:${e164}` : await confirmPhoneCode(confirmation.current!, code);
        const proof = await auth.verifyPhone(idToken);
        setConfirmed(true);
        onVerified(proof.verificationId);
      } else {
        await auth.verifyCheck(verificationId, code);
        setConfirmed(true);
        onVerified(verificationId);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Typing a different address or number starts over.
  const change = (next: string) => {
    setValue(next);
    if (verificationId) {
      setVerificationId(null);
      setConfirmed(false);
      setResendIn(0);
      onVerified(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs font-mono text-gray-400">
        {text.label}
        <div className="flex gap-2">
          <input
            type={text.type}
            inputMode={channel === 'phone' ? 'tel' : 'email'}
            autoComplete={text.autoComplete}
            autoCapitalize="none"
            placeholder={text.placeholder}
            value={value}
            onChange={(e) => change(e.target.value)}
            disabled={confirmed}
            className={inputClass}
          />
          {!confirmed && (
            <button type="button" onClick={send} disabled={busy || !value.trim() || resendIn > 0} className={buttonClass}>
              {resendIn > 0 ? `${resendIn}s` : verificationId ? 'Resend' : 'Send code'}
            </button>
          )}
        </div>
      </label>

      {verificationId && !confirmed && (
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={`Code sent to your ${channel === 'email' ? 'email' : 'mobile'}`}
            placeholder="6-digit code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className={inputClass}
          />
          <button type="button" onClick={check} disabled={busy || code.length !== 6} className={buttonClass}>
            Confirm
          </button>
        </div>
      )}

      {confirmed && (
        <div className="text-xs font-mono text-green-400">
          ✓ Confirmed{' '}
          <button type="button" onClick={() => change(value)} className="text-gray-500 underline ml-2">
            change
          </button>
        </div>
      )}
      {verificationId && !confirmed && !error && (
        <div className="text-xs font-mono text-gray-500">
          A code has been sent{channel === 'email' ? ' (check spam too)' : ''}. It is valid for 10 minutes.
        </div>
      )}
      {error && <div className="text-xs font-mono text-accent-red">{error}</div>}
      {channel === 'phone' && <div ref={recaptcha} />}
    </div>
  );
}
