'use client';

import { useState } from 'react';
import { admin, type ReportedItem } from '@/lib/adminApi';
import { REPORT_REASONS } from '@/lib/api';
import { Badge, Button, Card, ErrorLine, Loading, Tabs, confirmAction, useLoad, when } from './ui';
import type { AdminNav } from './nav';

const REASON = new Map(REPORT_REASONS);
const NOUN: Record<ReportedItem['targetType'], string> = { post: 'Post', comment: 'Comment', chat: 'Chat message' };

/**
 * What members have reported (the ⋯ button on posts, comments and chat; backend
 * routes/moderation.ts), one entry per item. Remove hides a post or deletes a comment or chat
 * message; Dismiss keeps it. Either closes every report about it. The author's account is one
 * click away, to suspend or delete it.
 */
export default function Reports({ nav }: { nav: AdminNav }) {
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const { data, error, reload } = useLoad(() => admin.reports(status), [status]);

  return (
    <Card title="Reports from members">
      <div className="flex flex-col gap-3">
        <Tabs value={status} options={[['open', 'Open'], ['resolved', 'Closed']]} onChange={setStatus} />
        <ErrorLine error={error} />
        {!data ? <Loading /> : data.items.length === 0 ? (
          <p className="text-xs font-mono text-gray-500">{status === 'open' ? 'No open reports.' : 'No closed reports yet.'}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.items.map((item) => <Item key={`${item.targetType}:${item.targetId}`} item={item} nav={nav} onChanged={reload} />)}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Item({ item, nav, onChanged }: { item: ReportedItem; nav: AdminNav; onChanged: () => void }) {
  const open = item.resolution === null;
  const removeAsk = item.targetType === 'post'
    ? 'Hide this post? Only its author and admins will see it; it stops travelling and leaves the common page.'
    : `Delete this ${item.targetType === 'comment' ? 'comment' : 'chat message'} for good?`;

  return (
    <li className="p-3 bg-navy-900 rounded-lg border border-gray-800 flex flex-col gap-2 font-mono">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="text-gray-200 font-bold">{NOUN[item.targetType]}</span>
        <span>by</span>
        <button onClick={() => nav.openUser(item.author.id)} className="text-accent-teal hover:underline">{item.author.username}</button>
        <span>{item.author.pseudonym}</span>
        {item.author.suspendedAt && <Badge tone="red">suspended</Badge>}
        <Badge tone={item.reports.length > 1 ? 'red' : 'plain'}>{item.reports.length} report{item.reports.length === 1 ? '' : 's'}</Badge>
        {!item.exists && <Badge tone="yellow">already deleted</Badge>}
        {item.hidden && <Badge tone="red">hidden</Badge>}
        {item.resolution && <Badge tone={item.resolution === 'removed' ? 'red' : 'teal'}>{item.resolution}</Badge>}
      </div>

      <p className="text-sm text-gray-200 whitespace-pre-wrap break-words border-l-2 border-gray-700 pl-2">{item.content}</p>

      <ul className="flex flex-col gap-1">
        {item.reports.map((r) => (
          <li key={r.id} className="text-xs text-gray-400 break-words">
            <span className="text-accent-red">{REASON.get(r.reason) ?? r.reason}</span>
            {' · '}
            <button onClick={() => nav.openUser(r.reporter.id)} className="text-gray-300 hover:underline">{r.reporter.username}</button>
            {' · '}{when(r.createdAt)}
            {r.detail && <div className="text-gray-300 mt-0.5">“{r.detail}”</div>}
          </li>
        ))}
      </ul>

      {!open && (
        <div className="text-[11px] text-gray-500">Closed {when(item.resolvedAt)} by {item.resolvedBy}</div>
      )}

      <div className="flex flex-wrap gap-2">
        {item.postId && (
          <Button onClick={() => nav.openPost(item.postId)}>{item.targetType === 'post' ? 'Open post' : 'Open its post'}</Button>
        )}
        {item.groupId && <Button onClick={() => nav.openGroup(item.groupId)}>Open its group</Button>}
        {open && item.exists && !item.hidden && (
          <Button
            tone="danger"
            onClick={() => confirmAction(removeAsk, (reason) => admin.resolveReports(item.targetType, item.targetId, 'remove', reason), onChanged, { reason: true })}
          >
            Remove
          </Button>
        )}
        {open && (
          <Button
            onClick={() => confirmAction(
              item.exists && !item.hidden ? 'Keep it and close these reports?' : 'Close these reports?',
              () => admin.resolveReports(item.targetType, item.targetId, 'dismiss', ''),
              onChanged,
            )}
          >
            {item.exists && !item.hidden ? 'Dismiss' : 'Close'}
          </Button>
        )}
      </div>
    </li>
  );
}
