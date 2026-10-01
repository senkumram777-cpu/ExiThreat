/**
 * ViewTracker — RxDB-backed local store for First-Look seen flags.
 *
 * This is the CANONICAL source of truth for whether the current device
 * has consumed the unredacted view of a post.  The server's ViewRecord
 * table is a backup audit trail, but the client must NEVER re-fetch the
 * unredacted strip if this local flag is set — even if the server record
 * is somehow absent.
 *
 * Schema: { postId: string (primary key), seenAt: string (ISO timestamp) }
 */

import {
  createRxDatabase,
  addRxPlugin,
  type RxDatabase,
  type RxCollection,
  type RxDocument,
} from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';

addRxPlugin(RxDBQueryBuilderPlugin);

const SEEN_SCHEMA = {
  version: 0,
  primaryKey: 'postId',
  type: 'object',
  properties: {
    postId: { type: 'string', maxLength: 100 },
    seenAt: { type: 'string' },
  },
  required: ['postId', 'seenAt'],
} as const;

type SeenDoc = RxDocument<{ postId: string; seenAt: string }>;
type SeenCollection = RxCollection<{ postId: string; seenAt: string }>;

let db: RxDatabase | null = null;
let seenCollection: SeenCollection | null = null;

async function getDb(): Promise<SeenCollection> {
  if (seenCollection) return seenCollection;

  db = await createRxDatabase({
    name: 'exithreat_viewtracker',
    storage: getRxStorageDexie(),
    ignoreDuplicate: true,
  });

  await db.addCollections({
    seen_posts: { schema: SEEN_SCHEMA },
  });

  seenCollection = db.collections.seen_posts as SeenCollection;
  return seenCollection;
}

/**
 * Returns true if the current device has already consumed the
 * unredacted first-look for this post.
 */
export async function hasSeenPost(postId: string): Promise<boolean> {
  const col = await getDb();
  const doc: SeenDoc | null = await col.findOne(postId).exec();
  return doc !== null;
}

/**
 * Irrevocably marks the post as seen on this device.
 * Safe to call multiple times (upsert semantics).
 */
export async function markPostAsSeen(postId: string): Promise<void> {
  const col = await getDb();
  await col.upsert({ postId, seenAt: new Date().toISOString() });
}

/**
 * Returns the ISO timestamp when the post was first seen,
 * or null if not yet seen.
 */
export async function getSeenAt(postId: string): Promise<string | null> {
  const col = await getDb();
  const doc: SeenDoc | null = await col.findOne(postId).exec();
  return doc ? doc.seenAt : null;
}
