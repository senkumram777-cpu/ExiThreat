'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, type Me } from '@/lib/api';
import { clearSession, getSession, saveSession } from '@/lib/session';
import ContactVerifier from '@/components/ContactVerifier';

/**
 * For accounts made before an email address and mobile number were required: the site
 * stays closed to them until both are added (the server answers CONTACT_REQUIRED).
 */
export default function AddContactPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [emailProof, setEmailProof] = useState<string | null>(null);
  const [phoneProof, setPhoneProof] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!getSession()) {
      router.replace('/auth/login');
      return;
    }
    auth
      .me()
      .then((m) => {
        if (m.hasEmail && m.hasPhone) router.replace('/groups');
        else setMe(m);
      })
      .catch((err) => setError((err as Error).message));
  }, [router]);

  const ready = !!me && (me.hasEmail || !!emailProof) && (me.hasPhone || !!phoneProof);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      saveSession(await auth.addContact(emailProof, phoneProof));
      router.push('/groups');
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

  return (
    <div className="max-w-sm mx-auto mt-12 flex flex-col gap-4">
      <h1 className="text-2xl font-mono font-bold text-accent-red text-center">One More Step</h1>
      <p className="text-xs font-mono text-gray-400 leading-relaxed">
        Every account now needs its own email address and mobile number, so that each person has
        only one account. Confirm yours to continue{me ? `, ${me.username}` : ''}.
      </p>
      <p className="text-xs font-mono text-gray-500 leading-relaxed">
        ExiThreat keeps only a one-way fingerprint of them, never the address or number itself.
        They also let you reset your password. They cannot be changed later.
      </p>
      {me && !me.hasEmail && <ContactVerifier channel="email" onVerified={setEmailProof} />}
      {me && !me.hasPhone && <ContactVerifier channel="phone" onVerified={setPhoneProof} />}
      {error && <div className="text-accent-red text-xs font-mono">{error}</div>}
      <button
        onClick={save}
        disabled={!ready || saving}
        className="py-3 bg-accent-red text-white rounded-lg font-mono font-bold text-sm disabled:opacity-50 hover:bg-accent-red/80 transition-colors"
      >
        {saving ? 'Saving…' : 'Continue'}
      </button>
      <button onClick={signOut} className="text-xs font-mono text-gray-500 underline">
        Sign out
      </button>
    </div>
  );
}
