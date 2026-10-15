/**
 * Admins of ExiThreat are ProMic's admins: they sign in on the admin page with their ProMic
 * admin-panel Google account (Firebase Authentication of the ProMic project), and the page
 * sends the Firebase ID token. This server checks the token with ProMic's service account and
 * that the account is on ProMic's `admins/{uid}` allowlist, the same list ProMic's admin panel
 * and functions use. Being on the list is remembered for a minute per account, so removing
 * someone takes effect within a minute.
 */

import { NextFunction, Request, Response } from 'express';
import { promicAuth, promicDb } from './promicService';

export interface Admin {
  uid: string;
  email: string;
}

export interface AdminRequest extends Request {
  admin?: Admin;
  /** The Firebase ID token, passed on to ProMic's admin functions for officer accounts. */
  adminToken?: string;
}

const REMEMBER_MS = 60 * 1000;
const hosted = process.env.NODE_ENV === 'production' || !!process.env.FLY_APP_NAME;
// Lets the API test and a local copy act as an admin without ProMic. Never honoured on the host.
const TEST_TOKENS = !hosted && process.env.ADMIN_TEST === '1';
const TEST_PREFIX = 'test-admin:';

const listed = new Map<string, number>();

async function onAllowlist(uid: string): Promise<boolean> {
  const until = listed.get(uid);
  if (until && until > Date.now()) return true;
  const snap = await promicDb().ref(`admins/${uid}`).get();
  if (snap.val() !== true) {
    listed.delete(uid);
    return false;
  }
  listed.set(uid, Date.now() + REMEMBER_MS);
  return true;
}

/** The admin a Firebase ID token belongs to, or null if it is not a valid admin's token. */
export async function adminFor(token: string): Promise<Admin | null> {
  if (!token) return null;
  if (TEST_TOKENS && token.startsWith(TEST_PREFIX)) {
    const name = token.slice(TEST_PREFIX.length) || 'admin';
    return { uid: `test-${name}`, email: `${name}@example.com` };
  }
  try {
    const decoded = await promicAuth().verifyIdToken(token);
    if (!(await onAllowlist(decoded.uid))) return null;
    return { uid: decoded.uid, email: decoded.email ?? decoded.uid };
  } catch {
    return null;
  }
}

/** Lets only ProMic admins through, with req.admin set. */
export function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  adminFor(token)
    .then((admin) => {
      if (!admin) {
        res.status(401).json({ error: 'Sign in with a ProMic admin account.' });
        return;
      }
      req.admin = admin;
      req.adminToken = token;
      next();
    })
    .catch(next);
}
