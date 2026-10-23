'use client';

import { useState } from 'react';
import { admin } from '@/lib/adminApi';
import { Card, ErrorLine, Loading, Pager, useLoad, when } from './ui';

const LABELS: Record<string, string> = {
  'user.suspend': 'suspended an account',
  'user.restore': 'restored an account',
  'user.signout': 'signed an account out everywhere',
  'user.delete': 'deleted an account',
  'post.hide': 'hid a post',
  'post.unhide': 'unhid a post',
  'post.unlist': 'took a post off the common page',
  'post.relist': 'put a post back on the common page',
  'post.delete': 'deleted a post',
  'comment.delete': 'deleted a comment',
  'chat.delete': 'deleted a chat message',
  'report.remove': 'removed reported content',
  'report.dismiss': 'dismissed reports',
  'group.rename': 'renamed a group',
  'group.move': 'moved a member',
  'recalculate': 'recalculated weights and spreads',
  'setting.change': 'changed a setting',
  'officer.create': 'created an officer account',
  'officer.reset': 'sent an officer a new password',
  'officer.disable': 'turned an officer account off',
  'officer.enable': 'turned an officer account on',
};

export function actionLabel(action: string): string {
  return LABELS[action] ?? action;
}

/** Everything admins have changed, newest first. */
export default function Log() {
  const [offset, setOffset] = useState(0);
  const { data, error } = useLoad(() => admin.log(offset), [offset]);
  if (error) return <ErrorLine error={error} />;
  if (!data) return <Loading />;
  return (
    <Card title={`Admin log (${data.total})`}>
      {data.actions.length === 0 && <p className="text-xs font-mono text-gray-500">Nothing yet.</p>}
      <ul className="flex flex-col divide-y divide-gray-800">
        {data.actions.map((a) => (
          <li key={a.id} className="py-2 text-xs font-mono break-words">
            <div className="text-gray-500">{when(a.at)} · {a.adminEmail}</div>
            <div className="text-gray-200">{actionLabel(a.action)} <span className="text-gray-500">({a.targetType} {a.targetId})</span></div>
            {a.detail && <div className="text-gray-400">{a.detail}</div>}
          </li>
        ))}
      </ul>
      <Pager offset={offset} total={data.total} onChange={setOffset} />
    </Card>
  );
}
