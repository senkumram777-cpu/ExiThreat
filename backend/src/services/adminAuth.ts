/**
 * The admin of ExiThreat is ProMic's one admin: they sign in on the admin page with their Google
 * account (Firebase Authentication of the ProMic project), and the page sends the Firebase ID
 * token. This server checks the token with ProMic's service account against ProMic's admin/
 * entry, {uid, email}, which is set in the Firebase console. Only that account, signed in with
 * Google with a verified email, gets in. ProMic's database rules and functions/adminAccount.js
 * make the same check. admin/ is read at most once a minute, so changing it in the console takes
 * effect within a minute.
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

let record: { uid: string; email: string } | null = null;
let readAt = 0;

/** ProMic's admin/ entry, read at most once a minute. */
async function adminRecord(): Promise<{ uid: string; email: string }> {
  if (record && Date.now() - readAt < REMEMBER_MS) return record;
  const value = (await promicDb().ref('admin').get()).val() ?? {};
  record = {
    uid: typeof value.uid === 'string' ? value.uid : '',
    email: typeof value.email === 'string' ? value.email.toLowerCase() : '',
  };
  readAt = Date.now();
  return record;
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
    if (decoded.email_verified !== true || decoded.firebase?.sign_in_provider !== 'google.com') return null;
    const admin = await adminRecord();
    const email = (decoded.email ?? '').toLowerCase();
    if (!admin.uid || !admin.email || decoded.uid !== admin.uid || email !== admin.email) return null;
    return { uid: decoded.uid, email: decoded.email ?? decoded.uid };
  } catch {
    return null;
  }
}

/** Lets only ProMic's admin through, with req.admin set. */
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
