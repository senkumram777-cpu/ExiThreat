/**
 * Mobile numbers are confirmed with Firebase Phone Authentication on ProMic's Firebase
 * project: the browser asks Google to send the SMS, the user enters the code there, and the
 * browser sends us the resulting Firebase ID token. We check the token with the ProMic
 * service account, keep only the number's fingerprint, and remove the Firebase user the
 * sign-in created, so ExiThreat users do not stay in ProMic's user list.
 *
 * A number that already belongs to a ProMic account (Hosts link theirs) signs in to that
 * account instead of creating one. That account is never removed: only users that this
 * sign-in itself created, with nothing but a phone number, are.
 */

import type { auth } from 'firebase-admin';
import { promicAuth } from './promicService';
import { normalizePhone } from './contactFormat';
import { ContactError, recordPhoneProof } from './contactService';

const hosted = process.env.NODE_ENV === 'production' || !!process.env.FLY_APP_NAME;
// Lets the API test confirm numbers without Firebase. Never honoured on the host.
const TEST_TOKENS = !hosted && process.env.PHONE_TOKEN_TEST === '1';
const TEST_PREFIX = 'test-phone:';

/** How recent the Firebase sign-in must be. */
const MAX_AGE_SECONDS = 10 * 60;
/** A Firebase user created this close before the sign-in was created by it. */
const CREATED_BY_THIS_SIGN_IN_SECONDS = 120;

async function forgetFirebaseUser(firebase: auth.Auth, uid: string, authTime: number): Promise<void> {
  try {
    const user = await firebase.getUser(uid);
    const created = Date.parse(user.metadata.creationTime) / 1000;
    const onlyPhone = user.providerData.every((p) => p.providerId === 'phone');
    if (onlyPhone && !user.email && !user.customClaims && created >= authTime - CREATED_BY_THIS_SIGN_IN_SECONDS) {
      await firebase.deleteUser(uid);
    }
  } catch (err) {
    console.error('Could not remove the Firebase user made for a mobile confirmation:', err);
  }
}

/** Checks a Firebase ID token from a phone sign-in and returns the id of the proof. */
export async function phoneProofFromToken(idToken: unknown): Promise<string> {
  if (typeof idToken !== 'string' || !idToken) throw new ContactError(400, 'idToken required');

  let phone: string;
  if (TEST_TOKENS && idToken.startsWith(TEST_PREFIX)) {
    phone = idToken.slice(TEST_PREFIX.length);
  } else {
    let firebase: auth.Auth;
    try {
      firebase = promicAuth();
    } catch {
      throw new ContactError(503, 'Mobile confirmation is not set up on this server yet. Please try again later.');
    }
    let decoded: auth.DecodedIdToken;
    try {
      decoded = await firebase.verifyIdToken(idToken);
    } catch {
      throw new ContactError(400, 'The mobile confirmation could not be checked. Please confirm the number again.');
    }
    if (decoded.firebase?.sign_in_provider !== 'phone' || !decoded.phone_number) {
      throw new ContactError(400, 'That was not a mobile number confirmation.');
    }
    if (Date.now() / 1000 - decoded.auth_time > MAX_AGE_SECONDS) {
      throw new ContactError(410, 'Your mobile number was confirmed too long ago. Confirm it again.');
    }
    phone = decoded.phone_number;
    await forgetFirebaseUser(firebase, decoded.uid, decoded.auth_time);
  }

  const normalized = normalizePhone(phone);
  if (!normalized) throw new ContactError(400, 'Only Indian mobile numbers can be used.');
  return recordPhoneProof(normalized);
}
