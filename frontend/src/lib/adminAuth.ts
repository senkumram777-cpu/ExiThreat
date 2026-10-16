/**
 * Admin sign-in for the admin page: a ProMic admin's Google account, through Firebase
 * Authentication of ProMic's project (firebaseConfig.ts). The server checks the Firebase ID
 * token against ProMic's one admin (admin/) on every request (backend services/adminAuth.ts).
 *
 * The sign-in lasts as long as the browser tab (session persistence), and is separate from
 * any member's sign-in in the same browser.
 *
 * A local copy built with NEXT_PUBLIC_ADMIN_TEST=1 offers a test sign-in instead, which only
 * a local server started with ADMIN_TEST=1 accepts.
 */

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserSessionPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  browserPopupRedirectResolver,
  type Auth,
} from 'firebase/auth';
import { firebaseConfig } from './firebaseConfig';

export const ADMIN_TEST = process.env.NEXT_PUBLIC_ADMIN_TEST === '1';
const TEST_KEY = 'exithreat_admin_test';
const APP_NAME = 'exithreat-admin';

let auth: Auth | null = null;

function adminAuth(): Auth {
  if (auth) return auth;
  const app: FirebaseApp = getApps().find((a) => a.name === APP_NAME) ?? initializeApp(firebaseConfig, APP_NAME);
  auth = initializeAuth(app, { persistence: browserSessionPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  return auth;
}

export interface AdminUser {
  email: string;
}

/** Calls `listener` with the signed-in admin, or null, now and after each change. */
export function onAdminChange(listener: (user: AdminUser | null) => void): () => void {
  if (ADMIN_TEST) {
    const read = () => listener(sessionStorage.getItem(TEST_KEY) ? { email: 'local@example.com' } : null);
    read();
    window.addEventListener('exithreat-admin', read);
    return () => window.removeEventListener('exithreat-admin', read);
  }
  return onAuthStateChanged(adminAuth(), (user) => listener(user ? { email: user.email ?? '' } : null));
}

export async function signInAdmin(): Promise<void> {
  if (ADMIN_TEST) {
    sessionStorage.setItem(TEST_KEY, '1');
    window.dispatchEvent(new Event('exithreat-admin'));
    return;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(adminAuth(), provider);
}

export async function signOutAdmin(): Promise<void> {
  if (ADMIN_TEST) {
    sessionStorage.removeItem(TEST_KEY);
    window.dispatchEvent(new Event('exithreat-admin'));
    return;
  }
  await signOut(adminAuth());
}

/** The current ID token (renewed by Firebase when it is close to expiring), or null. */
export async function adminToken(): Promise<string | null> {
  if (ADMIN_TEST) return sessionStorage.getItem(TEST_KEY) ? 'test-admin:local' : null;
  const user = adminAuth().currentUser;
  return user ? user.getIdToken() : null;
}
