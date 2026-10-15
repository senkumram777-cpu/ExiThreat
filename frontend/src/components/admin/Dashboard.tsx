'use client';

import { admin } from '@/lib/adminApi';
import { Card, ErrorLine, Loading, Stat, useLoad, when } from './ui';
import { actionLabel } from './Log';

/** Counts, the last 14 days and the latest admin actions. */
export default function Dashboard() {
  const { data, error } = useLoad(() => admin.overview(), []);
  if (error) return <ErrorLine error={error} />;
  if (!data) return <Loading />;
  const { users, groups, posts, activity, days } = data;
  const peak = Math.max(1, ...days.map((d) => Math.max(d.active, d.joined, d.posted)));

  return (
    <div className="flex flex-col gap-4">
      <Card title="Accounts">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Stat label="accounts" value={users.total} note={`${users.newThisWeek} new this week`} />
          <Stat label="active today" value={users.activeToday} note={`${users.activeThisWeek} this week`} />
          <Stat label="suspended" value={users.suspended} note={`${users.withoutContact} without contact details`} />
        </div>
      </Card>
      <Card title="Groups and posts">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Stat label="groups" value={groups.total} note={`${groups.takingPosts} big enough for posts`} />
          <Stat label="posts" value={posts.total} note={`${posts.newThisWeek} new this week`} />
          <Stat label="on the common page" value={posts.onCommonPage} note={`${posts.unlisted} unlisted · ${posts.hidden} hidden`} />
          <Stat label="votes" value={activity.votes} />
          <Stat label="first looks this week" value={activity.firstLooksThisWeek} />
          <Stat label="comments · chat" value={`${activity.comments} · ${activity.chatMessages}`} />
        </div>
      </Card>
      <Card title="Last 14 days">
        <div className="flex gap-3 text-[11px] font-mono text-gray-400 mb-2">
          <span><span className="inline-block w-2 h-2 bg-accent-teal mr-1" />active</span>
          <span><span className="inline-block w-2 h-2 bg-green-500 mr-1" />joined</span>
          <span><span className="inline-block w-2 h-2 bg-accent-red mr-1" />posts</span>
        </div>
        <div className="flex items-end gap-1 h-32" role="img" aria-label="Accounts active, joined and posts per day">
          {days.map((d) => (
            <div key={d.day} className="flex-1 flex items-end gap-px h-full min-w-0" title={`${d.day}: ${d.active} active, ${d.joined} joined, ${d.posted} posts`}>
              <div className="flex-1 bg-accent-teal/80" style={{ height: `${(d.active / peak) * 100}%` }} />
              <div className="flex-1 bg-green-500/80" style={{ height: `${(d.joined / peak) * 100}%` }} />
              <div className="flex-1 bg-accent-red/80" style={{ height: `${(d.posted / peak) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] font-mono text-gray-600 mt-1">
          <span>{days[0]?.day}</span>
          <span>{days[days.length - 1]?.day}</span>
        </div>
      </Card>
      <Card title="Latest admin actions">
        {data.recentActions.length === 0 ? (
          <p className="text-xs font-mono text-gray-500">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.recentActions.map((a) => (
              <li key={a.id} className="text-xs font-mono text-gray-300 break-words">
                <span className="text-gray-500">{when(a.at)}</span> {a.adminEmail}: {actionLabel(a.action)}
                {a.detail ? <span className="text-gray-500"> — {a.detail}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
