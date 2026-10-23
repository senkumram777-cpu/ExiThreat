'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/api';
import { saveSession } from '@/lib/session';
import ContactVerifier from '@/components/ContactVerifier';
import { useRules } from '@/lib/rules';
import PasswordInput from '@/components/PasswordInput';

const inputClass =
  'bg-navy-800 border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal';

export default function RegisterPage() {
  const rules = useRules();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [emailProof, setEmailProof] = useState<string | null>(null);
  const [phoneProof, setPhoneProof] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!emailProof || !phoneProof) {
      setError('Confirm your email address and mobile number with their codes first');
      return;
    }
    if (password !== repeatPassword) {
      setError('The two passwords are not the same');
      return;
    }
    if (!agreed) {
      setError('Agree to the Terms of Use to create an account');
      return;
    }
    setLoading(true);
    try {
      saveSession(await auth.register(username, password, emailProof, phoneProof));
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
      {!rules.registrationOpen && (
        <div className="text-yellow-500 text-xs font-mono text-center mb-4">
          New accounts cannot be created at the moment. Try again later.
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-xs font-mono text-gray-400">
          Pseudonym (3 to 30 letters, digits, dots, dashes or underscores, with at least one letter)
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength={3}
            maxLength={30}
            pattern="[A-Za-z0-9_.\-]*[A-Za-z][A-Za-z0-9_.\-]*"
            required
            className={inputClass}
          />
        </label>
        <ContactVerifier channel="email" onVerified={setEmailProof} />
        <ContactVerifier channel="phone" onVerified={setPhoneProof} />
        <p className="text-xs font-mono text-gray-500 leading-relaxed">
          Each email address and mobile number can have only one account. ExiThreat keeps only
          a one-way fingerprint of them, never the address or number itself; they are passed
          to our email and SMS services only to deliver the code.
        </p>
        <label className="flex flex-col gap-1 text-xs font-mono text-gray-400">
          Password (at least 8 characters)
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
          Password again
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
        <label className="flex items-start gap-2 text-xs font-mono text-gray-300 leading-relaxed">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
          <span>
            I am 18 or older and agree to the{' '}
            <Link href="/terms" target="_blank" className="text-accent-teal">Terms of Use</Link>: no abusive or
            objectionable content, and no tolerance for abusive members. I have read the{' '}
            <Link href="/privacy" target="_blank" className="text-accent-teal">Privacy Policy</Link>.
          </span>
        </label>
        {error && <div className="text-accent-red text-xs font-mono">{error}</div>}
        <button
          type="submit"
          disabled={loading || !emailProof || !phoneProof || !agreed}
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
