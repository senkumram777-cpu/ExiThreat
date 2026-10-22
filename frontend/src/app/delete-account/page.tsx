'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import DeleteAccount from '@/components/DeleteAccount';

// The address given to Google Play for account deletion: how to do it, and the form itself
// for someone already signed in.
export default function DeleteAccountPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => setSignedIn(!!getSession()), []);

  return (
    <div className="max-w-sm mx-auto flex flex-col gap-6 font-mono text-sm text-gray-300 leading-relaxed">
      <h1 className="text-xl font-bold text-accent-teal">Delete your ExiThreat account</h1>
      <p>You can delete your account yourself, at any time, in the app or on this website:</p>
      <ol className="list-decimal pl-5 flex flex-col gap-1">
        <li>Sign in.</li>
        <li>Open <b>Account</b>.</li>
        <li>Under <b>Delete account</b>, enter your password and confirm.</li>
      </ol>
      <p>
        This deletes, straight away and for good: your account, your disclosures, comments, group chat
        messages, votes and usage records. Nothing is kept afterwards. See the{' '}
        <Link href="/privacy" className="text-accent-teal">privacy policy</Link>.
      </p>
      {signedIn === true && <DeleteAccount />}
      {signedIn === false && (
        <Link
          href="/auth/login"
          className="py-3 text-center border border-accent-teal text-accent-teal rounded-lg font-bold no-underline"
        >
          Sign in to delete your account
        </Link>
      )}
    </div>
  );
}
