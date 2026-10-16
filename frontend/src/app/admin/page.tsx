'use client';

/**
 * The admin page: a dashboard and the controls for accounts, posts and comments, the common
 * page, groups and chat, officers, settings, and the log of admin actions. For ProMic's admins
 * only (sign-in: lib/adminAuth.ts; every request is checked by the server, routes/admin.ts).
 * It is not linked from the member pages.
 */

import { useEffect, useState } from 'react';
import { ADMIN_TEST, onAdminChange, signInAdmin, signOutAdmin, type AdminUser } from '@/lib/adminAuth';
import { admin } from '@/lib/adminApi';
import Dashboard from '@/components/admin/Dashboard';
import Accounts from '@/components/admin/Accounts';
import Posts from '@/components/admin/Posts';
import Groups from '@/components/admin/Groups';
import Officers from '@/components/admin/Officers';
import Settings from '@/components/admin/Settings';
import Log from '@/components/admin/Log';
import { Button, ErrorLine } from '@/components/admin/ui';
import type { AdminNav } from '@/components/admin/nav';

type Tab = 'dashboard' | 'accounts' | 'posts' | 'common' | 'groups' | 'officers' | 'settings' | 'log';

const TABS: [Tab, string][] = [
  ['dashboard', 'Dashboard'],
  ['accounts', 'Accounts'],
  ['posts', 'Posts'],
  ['common', 'Common page'],
  ['groups', 'Groups & chat'],
  ['officers', 'Officers'],
  ['settings', 'Settings'],
  ['log', 'Log'],
];

function tabFromHash(): Tab {
  const hash = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  return (TABS.find(([t]) => t === hash)?.[0]) ?? 'dashboard';
}

export default function AdminPage() {
  // undefined: not known yet; null: signed out.
  const [user, setUser] = useState<AdminUser | null | undefined>(undefined);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [userId, setUserId] = useState<string | null>(null);
  const [postId, setPostId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);

  useEffect(() => onAdminChange(setUser), []);
  useEffect(() => {
    setTab(tabFromHash());
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Signed in to Google is not enough: the server allows one account only (services/adminAuth.ts).
  // Any other account is signed out straight away, back to the sign-in box with the reason.
  useEffect(() => {
    if (!user) {
      setAllowed(null);
      return;
    }
    admin.me()
      .then(() => setAllowed(true))
      .catch((err: Error & { status?: number }) => {
        if (err.status === 401) {
          setError(`${user.email || 'That account'} is not allowed to use this admin page. Sign in with the admin's Google account.`);
          void signOutAdmin();
          return;
        }
        setAllowed(false);
        setError(err.message);
      });
  }, [user]);

  const go = (next: Tab) => {
    window.location.hash = next;
    setTab(next);
    window.scrollTo(0, 0);
  };
  const nav: AdminNav = {
    openUser: (id) => { setUserId(id); go('accounts'); },
    openPost: (id) => { setPostId(id); if (tab !== 'common') go('posts'); else window.scrollTo(0, 0); },
    openGroup: (id) => { setGroupId(id); go('groups'); },
  };

  const signIn = async () => {
    setError(null);
    try {
      await signInAdmin();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') setError((err as Error).message);
    }
  };

  return (
    // Wider than the member pages, centred on the screen.
    <div className="relative left-1/2 -translate-x-1/2 w-[min(calc(100vw-2rem),72rem)] flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-mono font-bold text-gray-100">Admin</h1>
        {user && (
          <div className="ml-auto flex items-center gap-2 font-mono text-xs text-gray-400">
            <span className="break-all">{user.email}</span>
            <Button onClick={() => { void signOutAdmin(); }}>Sign out</Button>
          </div>
        )}
      </div>

      {user === undefined && <div className="h-24 bg-navy-800 rounded-xl animate-pulse" />}

      {user === null && (
        <section className="p-6 bg-navy-800 rounded-xl border border-gray-800 flex flex-col gap-3 max-w-md">
          <p className="font-mono text-sm text-gray-300">
            For ProMic&apos;s administrator only. Sign in with the admin&apos;s Google account.
          </p>
          <div><Button tone="primary" onClick={signIn}>{ADMIN_TEST ? 'Sign in (local test admin)' : 'Sign in with Google'}</Button></div>
          <ErrorLine error={error} />
        </section>
      )}

      {user && allowed === false && (
        <section className="p-6 bg-navy-800 rounded-xl border border-gray-800 flex flex-col gap-3 max-w-md">
          <ErrorLine error={error} />
          <div><Button onClick={() => { void signOutAdmin(); }}>Use another account</Button></div>
        </section>
      )}

      {user && allowed && (
        <>
          <nav className="flex flex-wrap gap-1 border-b border-gray-800 pb-2" aria-label="Admin sections">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  // Clicking the open tab again goes back to its list.
                  if (key === tab) { setUserId(null); setPostId(null); setGroupId(null); }
                  go(key);
                }}
                className={`px-3 py-1.5 rounded-lg font-mono text-sm transition-colors ${
                  tab === key ? 'bg-accent-teal/15 text-accent-teal' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === 'dashboard' && <Dashboard />}
          {tab === 'accounts' && <Accounts nav={nav} selected={userId} />}
          {tab === 'posts' && <Posts nav={nav} selected={postId} />}
          {tab === 'common' && <Posts nav={nav} selected={postId} commonPage />}
          {tab === 'groups' && <Groups nav={nav} selected={groupId} />}
          {tab === 'officers' && <Officers />}
          {tab === 'settings' && <Settings />}
          {tab === 'log' && <Log />}
        </>
      )}
    </div>
  );
}
