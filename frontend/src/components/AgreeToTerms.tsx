'use client';

/**
 * On the terms page: for a signed-in account that has not agreed to the terms of use yet (made
 * before there were terms), an "I agree" button. Until then the server refuses its posts,
 * comments and chat messages (TERMS_REQUIRED), and lib/api.ts sends it here.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/api';
import { getSession } from '@/lib/session';

export default function AgreeToTerms() {
  const router = useRouter();
  const [needed, setNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()) return;
    auth.me().then((me) => setNeeded(!me.termsAccepted)).catch(() => {});
  }, []);

  if (!needed) return null;

  const agree = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.acceptTerms();
      router.push('/groups');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="p-4 rounded-xl border border-accent-teal/40 bg-navy-800 flex flex-col gap-3">
      <p className="text-sm text-gray-200">
        ExiThreat now has terms of use. Please read them below; you need to agree to them before you can post,
        comment or chat.
      </p>
      {error && <div className="text-accent-red text-xs">{error}</div>}
      <button
        type="button"
        onClick={agree}
        disabled={busy}
        className="py-3 bg-accent-teal text-navy-900 rounded-lg font-bold text-sm disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'I agree to the Terms of Use'}
      </button>
    </section>
  );
}
