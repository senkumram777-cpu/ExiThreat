'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSession, onSessionChange } from '@/lib/session';

/** The links in the top bar: different for a signed-in user and a visitor. */
export default function NavLinks() {
  // Unknown until the page is in the browser; nothing is shown until then.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const read = () => setSignedIn(getSession() !== null);
    read();
    return onSessionChange(read);
  }, []);

  if (signedIn === null) return null;

  if (!signedIn) {
    return (
      <div className="flex gap-4 text-sm font-mono text-gray-400">
        <Link href="/auth/login" className="hover:text-accent-teal transition-colors">Sign in</Link>
        <Link href="/auth/register" className="text-accent-red hover:text-accent-red/80 transition-colors">
          Register
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 sm:gap-x-4 text-xs sm:text-sm font-mono text-gray-400 whitespace-nowrap">
      <Link href="/groups" className="hover:text-accent-teal transition-colors">Groups</Link>
      <Link href="/common" className="hover:text-accent-teal transition-colors">Common</Link>
      <Link href="/disclosures" className="hover:text-accent-teal transition-colors">Mine</Link>
      <Link href="/promic" className="hover:text-accent-teal transition-colors">Backups</Link>
      <Link href="/account" className="hover:text-accent-teal transition-colors">Account</Link>
      <Link href="/post/new" className="text-accent-red hover:text-accent-red/80 transition-colors">
        + Disclose
      </Link>
    </div>
  );
}
