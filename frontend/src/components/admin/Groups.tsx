'use client';

import { useState } from 'react';
import { admin, type AdminGroup } from '@/lib/adminApi';
import { Badge, Button, Card, ErrorLine, Loading, Pager, confirmAction, inputClass, percent, useLoad, when } from './ui';
import type { AdminNav } from './nav';

/** Groups: their weight and members; rename, move a member, read and clear chat. */
export default function Groups({ nav, selected }: { nav: AdminNav; selected: string | null }) {
  const list = useLoad(() => admin.groups(), []);
  const [busy, setBusy] = useState(false);

  if (selected) return <GroupDetail id={selected} nav={nav} groups={list.data?.groups ?? []} onChanged={list.reload} />;

  const recalculate = async () => {
    setBusy(true);
    try {
      await admin.recalculate();
      list.reload();
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Groups" actions={<Button onClick={recalculate} disabled={busy}>{busy ? 'Recalculating…' : 'Recalculate now'}</Button>}>
      <ErrorLine error={list.error} />
      {!list.data ? <Loading /> : (
        <>
          <p className="text-xs font-mono text-gray-500 mb-2">
            Groups take posts from {list.data.minMembers} members; no one new joins one with {list.data.maxMembers}.
            Weights, pushes due and spreads are recalculated hourly, or now with the button.
          </p>
          <ul className="flex flex-col divide-y divide-gray-800">
            {list.data.groups.map((g) => (
              <li key={g.id}>
                <button onClick={() => nav.openGroup(g.id)} className="w-full text-left py-2 flex flex-wrap items-center gap-2 font-mono text-sm hover:bg-navy-900/60">
                  <span className="text-gray-100">{g.name}</span>
                  {g._count.members < list.data!.minMembers && <Badge tone="yellow">too small for posts</Badge>}
                  <span className="ml-auto text-xs text-gray-500">
                    weight {percent(g.trustScore)} · {g._count.members} members · {g._count.placements} posts · {g._count.chatMessages} chat
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function GroupDetail({ id, nav, groups, onChanged }: { id: string; nav: AdminNav; groups: AdminGroup[]; onChanged: () => void }) {
  const { data: g, error, reload } = useLoad(() => admin.group(id), [id]);
  const [name, setName] = useState<string | null>(null);
  const [chatOffset, setChatOffset] = useState(0);
  const chat = useLoad(() => admin.chat(id, chatOffset), [id, chatOffset]);
  const refresh = () => {
    reload();
    onChanged();
  };
  if (error) return <Card><ErrorLine error={error} /><Button onClick={() => nav.openGroup(null)}>← Groups</Button></Card>;
  if (!g) return <Loading />;
  const others = groups.filter((o) => o.id !== g.id);

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name === null || name.trim() === g.name) return;
    try {
      await admin.renameGroup(g.id, name.trim());
      setName(null);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div><Button onClick={() => nav.openGroup(null)}>← Groups</Button></div>
      <Card title="Group">
        <form onSubmit={rename} className="flex flex-wrap gap-2 mb-3">
          <input className={`${inputClass} flex-1`} value={name ?? g.name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Group name" />
          <Button type="submit" tone="primary" disabled={name === null || name.trim() === g.name}>Rename</Button>
        </form>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs text-gray-400">
          <div><div className="text-sm text-accent-teal font-bold">{percent(g.trustScore)}</div>weight</div>
          <div><div className="text-sm text-gray-200 font-bold">{percent(g.loginScore)}</div>days of use</div>
          <div><div className="text-sm text-gray-200 font-bold">{percent(g.reviewScore)}</div>posts gone through</div>
          <div><div className="text-sm text-gray-200 font-bold">{when(g.createdAt)}</div>opened</div>
        </div>
      </Card>
      <Card title={`Members (${g.members.length})`}>
        <ul className="flex flex-col divide-y divide-gray-800">
          {g.members.map((m) => (
            <li key={m.user.id} className="py-2 flex flex-wrap items-center gap-2 font-mono text-sm">
              <button onClick={() => nav.openUser(m.user.id)} className="text-accent-teal hover:underline break-all">{m.user.username}</button>
              <span className="text-xs text-gray-500">{m.user.pseudonym}</span>
              {m.user.suspendedAt && <Badge tone="red">suspended</Badge>}
              <span className="text-xs text-gray-500">joined {when(m.joinedAt)} · last seen {when(m.lastSeenAt)} · {percent(m.user.weight)}</span>
              {others.length > 0 && (
                <select
                  className={`${inputClass} ml-auto text-xs py-1`}
                  value=""
                  aria-label={`Move ${m.user.username} to another group`}
                  onChange={(e) => {
                    const to = others.find((o) => o.id === e.target.value);
                    if (to) {
                      void confirmAction(`Move ${m.user.username} from ${g.name} to ${to.name}? Their votes in ${g.name} are dropped.`,
                        () => admin.moveMember(g.id, m.user.id, to.id), refresh);
                    }
                  }}
                >
                  <option value="">Move to…</option>
                  {others.map((o) => <option key={o.id} value={o.id}>{o.name} ({o._count.members})</option>)}
                </select>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={`Posts here now (${g.posts.length})`}>
        {g.posts.length === 0 && <p className="text-xs font-mono text-gray-500">None.</p>}
        <ul className="flex flex-col divide-y divide-gray-800">
          {g.posts.map((p) => (
            <li key={p.id}>
              <button onClick={() => nav.openPost(p.id)} className="w-full text-left py-2 font-mono hover:bg-navy-900/60">
                <div className="text-xs text-gray-500">{p.oc.username} · {p.oc.pseudonym} · arrived {when(p.arrivedAt)} {p.hiddenAt && <Badge tone="red">hidden</Badge>}</div>
                <div className="text-sm text-gray-200 break-words">{p.snippet}</div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Group chat">
        <ErrorLine error={chat.error} />
        {!chat.data ? <Loading /> : (
          <>
            {chat.data.messages.length === 0 && <p className="text-xs font-mono text-gray-500">No messages.</p>}
            <ul className="flex flex-col divide-y divide-gray-800">
              {chat.data.messages.map((m) => (
                <li key={m.id} className="py-2 flex gap-2 items-start">
                  <div className="flex-1 min-w-0 font-mono">
                    <div className="text-xs text-gray-500">
                      <button onClick={() => nav.openUser(m.user.id)} className="text-accent-teal hover:underline">{m.user.username}</button> {m.user.pseudonym} · {when(m.createdAt)}
                    </div>
                    <div className="text-sm text-gray-200 whitespace-pre-wrap break-words">{m.content}</div>
                  </div>
                  <Button tone="danger" onClick={() => confirmAction('Delete this message?', () => admin.deleteChat(m.id), chat.reload)}>Delete</Button>
                </li>
              ))}
            </ul>
            <Pager offset={chatOffset} total={chat.data.total} onChange={setChatOffset} />
          </>
        )}
      </Card>
    </div>
  );
}
