/**
 * Mobile number confirmation through Firebase Phone Authentication on ProMic's Firebase
 * project. Google sends the SMS and checks the code; the browser then hands the resulting
 * ID token to our server (auth.verifyPhone), which keeps only the number's fingerprint and
 * removes the Firebase user. Nothing is kept in this browser: the Firebase session lives in
 * memory and is signed out at once.
 *
 * These are the project's public web settings (the same as ProMic's admin panel), not
 * secrets. The site's domain must be listed under Authentication → Settings → Authorized
 * domains in the Firebase console.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  inMemoryPersistence,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type Auth,
  type ConfirmationResult,
} from 'firebase/auth';

const config = {
  apiKey: 'AIzaSyD3OmePJ_LlaT7B1I4HPqT9N3QglxnjD9k',
  authDomain: 'promic-c5567.firebaseapp.com',
  projectId: 'promic-c5567',
  appId: '1:945516079425:web:c7e31f3fc5c889b4b5d9c0',
};

const APP_NAME = 'exithreat-phone';
let auth: Auth | null = null;

function phoneAuth(): Auth {
  if (auth) return auth;
  const app: FirebaseApp = getApps().find((a) => a.name === APP_NAME) ?? initializeApp(config, APP_NAME);
  auth = initializeAuth(app, { persistence: inMemoryPersistence });
  auth.languageCode = 'en';
  return auth;
}

/** "+91" and the 10 digits, or null if it is not an Indian mobile number. */
export function indianMobile(raw: string): string | null {
  let digits = raw.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

let verifier: RecaptchaVerifier | null = null;

/**
 * Asks Google to text a code to `e164`. `recaptchaElement` is where the (usually invisible)
 * reCAPTCHA attaches; it must stay in the page until the code has been sent.
 */
export async function sendPhoneCode(e164: string, recaptchaElement: HTMLElement): Promise<ConfirmationResult> {
  const firebase = phoneAuth();
  verifier?.clear();
  verifier = new RecaptchaVerifier(firebase, recaptchaElement, { size: 'invisible' });
  try {
    return await signInWithPhoneNumber(firebase, e164, verifier);
  } catch (err) {
    verifier.clear();
    verifier = null;
    throw new Error(describe(err));
  }
}

/** Checks the code with Google and returns the ID token for our server. */
export async function confirmPhoneCode(confirmation: ConfirmationResult, code: string): Promise<string> {
  try {
    const credential = await confirmation.confirm(code);
    const idToken = await credential.user.getIdToken();
    await signOut(phoneAuth());
    return idToken;
  } catch (err) {
    throw new Error(describe(err));
  }
}

/** Firebase's error codes in words. */
function describe(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-verification-code':
      return 'Wrong code. Check the SMS and try again.';
    case 'auth/code-expired':
      return 'This code has expired. Ask for a new one.';
    case 'auth/invalid-phone-number':
      return 'This mobile number is not valid.';
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return 'Too many codes asked for. Please try again later.';
    case 'auth/captcha-check-failed':
      return 'The security check failed. Reload the page and try again.';
    case 'auth/unauthorized-domain':
    case 'auth/operation-not-allowed':
      return 'Mobile confirmation is not set up for this site yet. Please try again later.';
    case 'auth/network-request-failed':
      return 'No connection. Check your internet and try again.';
    default:
      return 'The SMS code could not be handled. Please try again.';
  }
}
