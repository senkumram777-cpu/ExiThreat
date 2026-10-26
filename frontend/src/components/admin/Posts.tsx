'use client';

import { useState } from 'react';
import { admin, type AdminPost } from '@/lib/adminApi';
import { Badge, Button, Card, ErrorLine, Loading, Pager, SearchBox, Tabs, confirmAction, percent, useLoad, when } from './ui';
import type { AdminNav } from './nav';
import { groupsPerDay } from '@/lib/weight';
import CategoryTag from '@/components/CategoryTag';

type Filter = 'all' | 'common' | 'hidden' | 'unlisted';

function PostBadges({ post }: { post: AdminPost }) {
  return (
    <>
      {post.hiddenAt && <Badge tone="red">hidden</Badge>}
      {post.onCommonPage && <Badge tone="teal">common page</Badge>}
      {post.unlistedAt && <Badge tone="yellow">unlisted</Badge>}
    </>
  );
}

/**
 * All posts with their original text and author. `commonPage` shows the common page instead:
 * the listed posts in the order members and officers see them.
 */
export default function Posts({ nav, selected, commonPage = false }: { nav: AdminNav; selected: string | null; commonPage?: boolean }) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Filter>('all');
  const [offset, setOffset] = useState(0);
  const filter: Filter = commonPage ? 'common' : chosen;
  const list = useLoad(() => admin.posts(query, filter, offset), [query, filter, offset]);

  if (selected) return <PostDetail id={selected} nav={nav} onChanged={list.reload} />;

  return (
    <Card title={commonPage ? 'Common page' : 'Posts'}>
      <div className="flex flex-col gap-3">
        {commonPage && (
          <p className="text-xs font-mono text-gray-500">
            What members see on the common page (redacted) and officers see on theirs (with the original), in the same
            order. Unlist a post to take it off the page while it goes on travelling between groups; the share of groups a
            post must reach is under Settings.
          </p>
        )}
        <SearchBox value={query} onSearch={(q) => { setQuery(q); setOffset(0); }} placeholder="Words in the post, or the author's username or pseudonym" />
        {!commonPage && (
          <Tabs value={chosen} options={[['all', 'All'], ['common', 'On the common page'], ['hidden', 'Hidden'], ['unlisted', 'Unlisted']]} onChange={(f) => { setChosen(f); setOffset(0); }} />
        )}
        <ErrorLine error={list.error} />
        {!list.data ? <Loading /> : (
          <>
            <div className="text-xs font-mono text-gray-500">{list.data.total} post{list.data.total === 1 ? '' : 's'}</div>
            <ul className="flex flex-col divide-y divide-gray-800">
              {list.data.posts.map((p, i) => (
                <li key={p.id}>
                  <button onClick={() => nav.openPost(p.id)} className="w-full text-left py-2 font-mono hover:bg-navy-900/60">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      {filter === 'common' && <span className="text-accent-teal font-bold">#{offset + i + 1}</span>}
                      <span className="text-gray-300">{p.author.username}</span>
                      <span>{p.author.pseudonym}</span>
                      <span>{when(p.createdAt)}</span>
                      <PostBadges post={p} />
                    </div>
                    <div className="text-sm text-gray-200 mt-1 line-clamp-2 break-words">{p.originalContent}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {p.reachedGroups}/{p.eligibleGroups} groups · round {p.cycle} · {groupsPerDay(p.spreadScore, p.eligibleGroups)} · in {p.groups.length} now · {p._count.comments} comments
                    </div>
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

function PostDetail({ id, nav, onChanged }: { id: string; nav: AdminNav; onChanged: () => void }) {
  const { data: p, error, reload } = useLoad(() => admin.post(id), [id]);
  const refresh = () => {
    reload();
    onChanged();
  };
  if (error) return <Card><ErrorLine error={error} /><Button onClick={() => nav.openPost(null)}>← Posts</Button></Card>;
  if (!p) return <Loading />;
  const share = p.eligibleGroups > 0 ? p.reachedGroups / p.eligibleGroups : 0;

  return (
    <div className="flex flex-col gap-4">
      <div><Button onClick={() => nav.openPost(null)}>← Back</Button></div>
      <Card
        title="Post"
        actions={(
          <>
            {p.hiddenAt ? (
              <Button tone="primary" onClick={() => confirmAction('Unhide this post? Its groups can read and vote on it again.', () => admin.unhide(p.id), refresh)}>Unhide</Button>
            ) : (
              <Button tone="danger" onClick={() => confirmAction('Hide this post? Only its author and admins will see it; it stops travelling and leaves the common page.', (reason) => admin.hide(p.id, reason), refresh, { reason: true })}>Hide</Button>
            )}
            {p.unlistedAt ? (
              <Button onClick={() => confirmAction('Put this post back on the common page (once it has reached the share)?', () => admin.relist(p.id), refresh)}>Relist</Button>
            ) : (
              <Button onClick={() => confirmAction('Take this post off the common page? It goes on travelling between groups.', () => admin.unlist(p.id), refresh)}>Unlist</Button>
            )}
            <Button tone="danger" onClick={() => confirmAction('Delete this post for good, with its comments, votes and history? This cannot be undone.', () => admin.deletePost(p.id), () => { onChanged(); nav.openPost(null); })}>Delete</Button>
          </>
        )}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-gray-500 mb-3">
          <button onClick={() => nav.openUser(p.author.id)} className="text-accent-teal hover:underline">{p.author.username}</button>
          <span>{p.author.pseudonym}</span>
          <span>{when(p.createdAt)}</span>
          <PostBadges post={p} />
          <CategoryTag category={p.category} />
        </div>
        {p.hiddenAt && (
          <div className="text-xs font-mono text-accent-red mb-3">Hidden {when(p.hiddenAt)}{p.hiddenReason ? ` — ${p.hiddenReason}` : ''}</div>
        )}
        <div className="rounded-lg border border-accent-red/30 bg-navy-900 p-3 mb-3">
          <div className="text-[11px] font-mono text-accent-red uppercase tracking-widest mb-2">Original</div>
          <p className="font-mono text-sm text-gray-200 whitespace-pre-wrap break-words">{p.originalContent}</p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-navy-900 p-3">
          <div className="text-[11px] font-mono text-gray-500 uppercase tracking-widest mb-2">Redacted (what members see)</div>
          <p className="font-mono text-sm text-gray-300 whitespace-pre-wrap break-words">{p.redactedContent}</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 font-mono text-xs text-gray-400">
          <div><div className="text-sm text-accent-teal font-bold">{percent(share)}</div>of groups ({p.reachedGroups}/{p.eligibleGroups})</div>
          <div><div className="text-sm text-gray-200 font-bold">{p.cycle}</div>round</div>
          <div><div className="text-sm text-gray-200 font-bold">{p._count.viewRecords}</div>first looks</div>
          <div><div className="text-sm text-gray-200 font-bold">{p.totalWeight.toFixed(1)}</div>credibility</div>
        </div>
      </Card>
      <Card title="Where it is">
        <div className="text-xs font-mono text-gray-400 mb-1">In now:</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {p.groups.length === 0 && <span className="text-xs font-mono text-gray-500">none</span>}
          {p.groups.map((g) => <button key={g.id} onClick={() => nav.openGroup(g.id)} className="text-xs font-mono text-accent-teal hover:underline">{g.name}</button>)}
        </div>
        <div className="text-xs font-mono text-gray-400 mb-1">Passed through:</div>
        <ul className="flex flex-col gap-1">
          {p.history.length === 0 && <li className="text-xs font-mono text-gray-500">none yet</li>}
          {p.history.map((h, i) => (
            <li key={i} className="text-xs font-mono text-gray-300">
              <button onClick={() => nav.openGroup(h.group.id)} className="text-accent-teal hover:underline">{h.group.name}</button>
              {' '}{when(h.arrivedAt)} → {when(h.movedAt)} · {Math.round(h.pushPercentage)}% voted{h.wasManualPush ? ' · author push' : ''}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={`Comments (${p.comments.length})`}>
        {p.comments.length === 0 && <p className="text-xs font-mono text-gray-500">No comments.</p>}
        <ul className="flex flex-col divide-y divide-gray-800">
          {p.comments.map((c) => (
            <li key={c.id} className="py-2 flex gap-2 items-start">
              <div className="flex-1 min-w-0 font-mono">
                <div className="text-xs text-gray-500">
                  <button onClick={() => nav.openUser(c.user.id)} className="text-accent-teal hover:underline">{c.user.username}</button> {c.user.pseudonym} · {when(c.createdAt)}
                </div>
                <div className="text-sm text-gray-200 whitespace-pre-wrap break-words">{c.content}</div>
              </div>
              <Button tone="danger" onClick={() => confirmAction('Delete this comment?', () => admin.deleteComment(c.id), reload)}>Delete</Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
