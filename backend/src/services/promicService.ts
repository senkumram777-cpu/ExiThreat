/**
 * Read access to a linked ProMic host's backup audio/video.
 *
 * ProMic keeps its data in Firebase (project promic-c5567), not in this app's Postgres: segment
 * metadata under segments/{hostId} and video_segments/{hostId} in the Realtime Database, the
 * blobs in Cloud Storage, each AES-256-GCM encrypted with the host's key at backup_keys/{hostId}.
 * This service reaches all three through the Admin SDK with a service account, so the browser
 * never holds Firebase credentials or the backup key — it only ever gets decrypted media for the
 * host its own ExiThreat account is linked to (see routes/promic.ts).
 */

import crypto from 'crypto';
import fs from 'fs';
import * as admin from 'firebase-admin';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// ProMic records 16 kHz mono 16-bit PCM (AudioCircularBuffer.SAMPLE_RATE).
const PCM_SAMPLE_RATE = 16000;

// Whole-blob decryption (GCM authenticates the entire object), so cap what gets buffered.
// Matches ProMic's own Storage rule limits.
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export class ProMicError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface ProMicAudioBackup {
  id: string;
  startTimestamp: number;
  endTimestamp: number;
  durationMs: number;
  isThreatClip: boolean;
  lat: number | null;
  lon: number | null;
}

export interface ProMicVideoBackup {
  id: string;
  cameraFacing: 'FRONT' | 'BACK';
  startTimestamp: number;
  endTimestamp: number;
  durationMs: number;
  lat: number | null;
  lon: number | null;
}

let app: admin.app.App | null = null;

function loadServiceAccount(): admin.ServiceAccount | null {
  const inline = process.env.PROMIC_SERVICE_ACCOUNT_JSON;
  if (inline) return JSON.parse(inline) as admin.ServiceAccount;
  const path = process.env.PROMIC_SERVICE_ACCOUNT_PATH;
  if (path) return JSON.parse(fs.readFileSync(path, 'utf8')) as admin.ServiceAccount;
  return null;
}

function getApp(): admin.app.App {
  if (app) return app;
  const serviceAccount = loadServiceAccount();
  const databaseURL = process.env.PROMIC_DATABASE_URL;
  const storageBucket = process.env.PROMIC_STORAGE_BUCKET;
  if (!serviceAccount || !databaseURL || !storageBucket) {
    throw new ProMicError(503, 'ProMic integration is not configured on this server');
  }
  app = admin.initializeApp(
    { credential: admin.credential.cert(serviceAccount), databaseURL, storageBucket },
    'promic',
  );
  return app;
}

function coord(value: unknown): number | null {
  // ProMic writes 0.0 for "no fix".
  return typeof value === 'number' && value !== 0 ? value : null;
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/**
 * Redeems a one-time code generated in ProMic's Settings (exithreat_link_codes/{code}) and
 * returns the host uid it names. The code is deleted on success so it can't be replayed.
 */
export async function redeemLinkCode(rawCode: string): Promise<string> {
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 8 || code.length > 32) {
    throw new ProMicError(400, 'Invalid or expired code');
  }
  const ref = getApp().database().ref(`exithreat_link_codes/${code}`);
  const snap = await ref.get();
  const value = snap.val() as { hostId?: unknown; expiresAt?: unknown } | null;
  if (!value || typeof value.hostId !== 'string' || typeof value.expiresAt !== 'number') {
    throw new ProMicError(400, 'Invalid or expired code');
  }
  await ref.remove();
  if (value.expiresAt < Date.now()) {
    throw new ProMicError(400, 'Invalid or expired code');
  }
  return value.hostId;
}

export async function getHostName(hostId: string): Promise<string | null> {
  const snap = await getApp().database().ref(`host_profile/${hostId}/name`).get();
  const name = snap.val();
  return typeof name === 'string' && name ? name : null;
}

export async function listBackups(
  hostId: string,
): Promise<{ audio: ProMicAudioBackup[]; video: ProMicVideoBackup[] }> {
  const db = getApp().database();
  const [audioSnap, videoSnap] = await Promise.all([
    db.ref(`segments/${hostId}`).get(),
    db.ref(`video_segments/${hostId}`).get(),
  ]);

  const audio: ProMicAudioBackup[] = [];
  audioSnap.forEach((child) => {
    const v = child.val() as Record<string, unknown>;
    audio.push({
      id: child.key!,
      startTimestamp: num(v.startTimestamp),
      endTimestamp: num(v.endTimestamp),
      durationMs: num(v.durationMs),
      isThreatClip: v.isThreatClip === true,
      lat: coord(v.lat),
      lon: coord(v.lon),
    });
  });

  const video: ProMicVideoBackup[] = [];
  videoSnap.forEach((child) => {
    const v = child.val() as Record<string, unknown>;
    video.push({
      id: child.key!,
      cameraFacing: v.cameraFacing === 'FRONT' ? 'FRONT' : 'BACK',
      startTimestamp: num(v.startTimestamp),
      endTimestamp: num(v.endTimestamp),
      durationMs: num(v.durationMs),
      lat: coord(v.lat),
      lon: coord(v.lon),
    });
  });

  audio.sort((a, b) => b.startTimestamp - a.startTimestamp);
  video.sort((a, b) => b.startTimestamp - a.startTimestamp);
  return { audio, video };
}

/** Mirrors ProMic's AudioEncryption.decrypt: blob is IV(12) || ciphertext || GCM tag(16). */
function decrypt(blob: Buffer, key: Buffer): Buffer {
  if (blob.length <= IV_LENGTH + TAG_LENGTH) {
    throw new ProMicError(502, 'Backup is empty or corrupt');
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, IV_LENGTH));
    decipher.setAuthTag(blob.subarray(blob.length - TAG_LENGTH));
    return Buffer.concat([
      decipher.update(blob.subarray(IV_LENGTH, blob.length - TAG_LENGTH)),
      decipher.final(),
    ]);
  } catch {
    throw new ProMicError(502, 'Backup could not be decrypted');
  }
}

async function fetchDecrypted(
  hostId: string,
  metadataPath: string,
  pathField: string,
  storagePrefix: string,
  maxBytes: number,
): Promise<Buffer> {
  const firebase = getApp();
  const db = firebase.database();
  const [metaSnap, keySnap] = await Promise.all([
    db.ref(metadataPath).get(),
    db.ref(`backup_keys/${hostId}`).get(),
  ]);
  const storagePath = metaSnap.child(pathField).val();
  // The path comes from host-written metadata — only ever follow it into that host's own prefix.
  if (typeof storagePath !== 'string' || !storagePath.startsWith(`${storagePrefix}/${hostId}/`)) {
    throw new ProMicError(404, 'Backup not found');
  }
  const encodedKey = keySnap.val();
  if (typeof encodedKey !== 'string') {
    throw new ProMicError(502, 'Backup key is missing');
  }
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) {
    throw new ProMicError(502, 'Backup key is invalid');
  }

  const file = firebase.storage().bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) throw new ProMicError(404, 'Backup not found');
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size) > maxBytes) {
    throw new ProMicError(413, 'Backup is too large to open here');
  }
  const [blob] = await file.download();
  return decrypt(blob, key);
}

function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24);
  header.writeUInt32LE(PCM_SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Returns the audio backup as a playable WAV (ProMic stores headerless PCM). */
export async function getAudioBackup(hostId: string, segmentId: string): Promise<Buffer> {
  const pcm = await fetchDecrypted(
    hostId, `segments/${hostId}/${segmentId}`, 'filePath', 'backup', MAX_AUDIO_BYTES,
  );
  return pcmToWav(pcm);
}

/** Returns the emergency video clip as MP4. */
export async function getVideoBackup(hostId: string, segmentId: string): Promise<Buffer> {
  return fetchDecrypted(
    hostId, `video_segments/${hostId}/${segmentId}`, 'storagePath', 'emergency_video', MAX_VIDEO_BYTES,
  );
}
