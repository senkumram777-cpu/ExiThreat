'use client';

import { useState } from 'react';
import { admin } from '@/lib/adminApi';
import { Badge, Button, Card, ErrorLine, Loading, Pager, SearchBox, Tabs, confirmAction, percent, useLoad, when } from './ui';
import type { AdminNav } from './nav';

/** Members' accounts: find one, then suspend, restore, sign out or delete it. */
export default function Accounts({ nav, selected }: { nav: AdminNav; selected: string | null }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'suspended'>('all');
  const [offset, setOffset] = useState(0);
  const list = useLoad(() => admin.users(query, filter, offset), [query, filter, offset]);

  if (selected) return <AccountDetail id={selected} nav={nav} onChanged={list.reload} />;

  return (
    <Card title="Accounts">
      <div className="flex flex-col gap-3">
        <SearchBox value={query} onSearch={(q) => { setQuery(q); setOffset(0); }} placeholder="Username, pseudonym, email or mobile" />
        <Tabs value={filter} options={[['all', 'All'], ['suspended', 'Suspended']]} onChange={(f) => { setFilter(f); setOffset(0); }} />
        <ErrorLine error={list.error} />
        {!list.data ? <Loading /> : (
          <>
            <div className="text-xs font-mono text-gray-500">{list.data.total} account{list.data.total === 1 ? '' : 's'}</div>
            <ul className="flex flex-col divide-y divide-gray-800">
              {list.data.users.map((u) => (
                <li key={u.id}>
                  <button onClick={() => nav.openUser(u.id)} className="w-full text-left py-2 flex flex-wrap items-center gap-2 font-mono text-sm hover:bg-navy-900/60">
                    <span className="text-gray-100 break-all">{u.username}</span>
                    <span className="text-gray-500 text-xs">{u.pseudonym}</span>
                    {u.suspendedAt && <Badge tone="red">suspended</Badge>}
                    {(!u.hasEmail || !u.hasPhone) && <Badge tone="yellow">no contact details</Badge>}
                    <span className="ml-auto text-xs text-gray-500">
                      {u.groups.map((g) => g.name).join(', ') || 'no group'} · {u._count.posts} posts · {percent(u.weight)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pager offset={offset} total={list.data.total} onChange={setOffset} />
          </>
        )}
      </div>
    </Card>
  );
}

function AccountDetail({ id, nav, onChanged }: { id: string; nav: AdminNav; onChanged: () => void }) {
  const { data: u, error, reload } = useLoad(() => admin.user(id), [id]);
  const refresh = () => {
    reload();
    onChanged();
  };
  if (error) return <Card><ErrorLine error={error} /><Button onClick={() => nav.openUser(null)}>← Accounts</Button></Card>;
  if (!u) return <Loading />;

  return (
    <div className="flex flex-col gap-4">
      <div><Button onClick={() => nav.openUser(null)}>← Accounts</Button></div>
      <Card
        title="Account"
        actions={(
          <>
            {u.suspendedAt ? (
              <Button tone="primary" onClick={() => confirmAction(`Restore ${u.username}?`, () => admin.restore(u.id), refresh)}>Restore</Button>
            ) : (
              <Button tone="danger" onClick={() => confirmAction(`Suspend ${u.username}? They are signed out and cannot sign in until restored.`, (reason) => admin.suspend(u.id, reason), refresh, { reason: true })}>Suspend</Button>
            )}
            <Button onClick={() => confirmAction(`Sign ${u.username} out on every device?`, () => admin.signOutUser(u.id), refresh)}>Sign out everywhere</Button>
            <Button tone="danger" onClick={() => confirmAction(`Delete ${u.username} for good, with all ${u._count.posts} of their posts, their comments, chat messages and votes? This cannot be undone.`, () => admin.deleteUser(u.id), () => { onChanged(); nav.openUser(null); })}>Delete</Button>
          </>
        )}
      >
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 font-mono text-sm">
          <dt className="text-gray-500">Username</dt><dd className="text-gray-100 break-all">{u.username}</dd>
          <dt className="text-gray-500">Pseudonym</dt><dd className="text-gray-300">{u.pseudonym}</dd>
          <dt className="text-gray-500">Joined</dt><dd className="text-gray-300">{when(u.createdAt)}</dd>
          <dt className="text-gray-500">Contact</dt>
          <dd className="text-gray-300">{u.hasEmail ? 'email ✓' : 'no email'} · {u.hasPhone ? 'mobile ✓' : 'no mobile'} <span className="text-gray-600">(only fingerprints are kept)</span></dd>
          <dt className="text-gray-500">ProMic</dt><dd className="text-gray-300">{u.proMicLinked ? 'linked' : 'not linked'}</dd>
          <dt className="text-gray-500">Weightage</dt>
          <dd className="text-gray-300">{percent(u.weight)} <span className="text-gray-600">(activity {percent(u.activityScore)}, posting {percent(u.postScore)}, voting {percent(u.voteScore)})</span></dd>
          <dt className="text-gray-500">Activity</dt>
          <dd className="text-gray-300">{u._count.posts} posts · {u._count.comments} comments · {u._count.chatMessages} chat · {u._count.pushVotes} votes · {u._count.viewRecords} first looks</dd>
          {u.suspendedAt && (<><dt className="text-gray-500">Suspended</dt><dd className="text-accent-red">{when(u.suspendedAt)}{u.suspendedReason ? ` — ${u.suspendedReason}` : ''}</dd></>)}
        </dl>
      </Card>
      <Card title="Groups">
        {u.memberships.length === 0 && <p className="text-xs font-mono text-gray-500">In no group.</p>}
        <ul className="flex flex-col gap-1">
          {u.memberships.map((m) => (
            <li key={m.group.id} className="font-mono text-sm">
              <button onClick={() => nav.openGroup(m.group.id)} className="text-accent-teal hover:underline">{m.group.name}</button>
              <span className="text-xs text-gray-500"> · joined {when(m.joinedAt)} · last seen {when(m.lastSeenAt)} · {m.visitCount} visits</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={`Posts (${u._count.posts})`}>
        {u.posts.length === 0 && <p className="text-xs font-mono text-gray-500">No posts.</p>}
        <ul className="flex flex-col divide-y divide-gray-800">
          {u.posts.map((p) => (
            <li key={p.id}>
              <button onClick={() => nav.openPost(p.id)} className="w-full text-left py-2 font-mono text-sm hover:bg-navy-900/60">
                <div className="text-gray-200 break-words">{p.snippet}</div>
                <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-500">
                  <span>{when(p.createdAt)}</span>
                  <span>{p.reachedGroups}/{p.eligibleGroups} groups</span>
                  {p.hiddenAt && <Badge tone="red">hidden</Badge>}
                  {p.listedAt && !p.hiddenAt && !p.unlistedAt && <Badge tone="teal">common page</Badge>}
                  {p.unlistedAt && <Badge tone="yellow">unlisted</Badge>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Days of use (last 30)">
        {u.activeDays.length === 0 ? <p className="text-xs font-mono text-gray-500">None.</p> : (
          <div className="flex flex-wrap gap-1">
            {u.activeDays.map((d) => <Badge key={d.day}>{d.day} · {Math.round(d.seconds / 60)} min</Badge>)}
          </div>
        )}
      </Card>
    </div>
  );
}
