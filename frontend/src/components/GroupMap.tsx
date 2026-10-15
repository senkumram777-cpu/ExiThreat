'use client';

import { useEffect, useMemo, useState } from 'react';
import { posts as postsApi, type GroupMap as GroupMapData, type GroupMapNode } from '@/lib/api';

/**
 * The author's map of every group in the system, as dots. At the top, the round the post is on
 * and how many eligible groups it has still to cover in it. Below, the post's path: the author,
 * then each step, with arrows for who sent it where. Then every group it has not reached yet.
 *
 * Dot colours: reading it now (teal, pulsing), covered in this round (green), reached in an
 * earlier round but not yet in this one (amber ring), yet to cover (grey), and groups that
 * cannot get it (dim outline: the author's own groups, or under 5 members).
 */

const WIDTH = 340;
const PATH_PER_ROW = 4;
const PATH_ROW = 66;
const PATH_R = 9;
const DOT_PER_ROW = 12;
const DOT_GAP = WIDTH / DOT_PER_ROW;
const DOT_R = 7;
const TOP = 26;

const COLORS = {
  current: '#00b4d8',
  covered: '#22c55e',
  earlier: '#f59e0b',
  toCover: '#6b7280',
  ineligible: '#374151',
  author: '#eab308',
  start: '#9ca3af',
};

type Kind = 'current' | 'covered' | 'earlier' | 'toCover' | 'ineligible';

function kindOf(n: GroupMapNode): Kind {
  if (n.current) return 'current';
  if (!n.eligible) return 'ineligible';
  if (n.covered) return 'covered';
  if (n.passed) return 'earlier';
  return 'toCover';
}

const LABELS: Record<Kind, string> = {
  current: 'Reading it now',
  covered: 'Covered in this round',
  earlier: 'Reached in an earlier round, yet to cover in this one',
  toCover: 'Yet to cover',
  ineligible: 'Cannot get it',
};

function statusOf(n: GroupMapNode): string {
  if (n.own) return 'Your own group: your posts never go there';
  if (!n.eligible && !n.current) return 'Cannot get it: fewer than 5 members';
  return LABELS[kindOf(n)];
}

/** Short arrival time under a group the post is in now, e.g. "15 Oct, 14:05". */
function shortTime(iso: string): string {
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

interface Point {
  x: number;
  y: number;
  r: number;
}

function layout(map: GroupMapData) {
  const step = new Map<string, number>([['you', 0]]);
  for (const e of map.edges) {
    if (!step.has(e.to)) step.set(e.to, (step.get(e.from) ?? 0) + 1);
  }
  const bySteps = new Map<number, GroupMapNode[]>();
  const rest: GroupMapNode[] = [];
  for (const n of map.nodes) {
    const s = step.get(n.key);
    if (s === undefined) rest.push(n);
    else bySteps.set(s, [...(bySteps.get(s) ?? []), n]);
  }

  const at = new Map<string, Point>([['you', { x: WIDTH / 2, y: TOP, r: 13 }]]);
  let y = TOP;
  for (const s of [...bySteps.keys()].sort((a, b) => a - b)) {
    const nodes = bySteps.get(s)!;
    for (let i = 0; i < nodes.length; i += PATH_PER_ROW) {
      const row = nodes.slice(i, i + PATH_PER_ROW);
      y += PATH_ROW;
      const gap = WIDTH / row.length;
      row.forEach((n, j) => at.set(n.key, { x: gap * (j + 0.5), y, r: PATH_R }));
    }
  }

  const dividerY = y + 40;
  const gridTop = dividerY + 30;
  rest.forEach((n, i) => {
    at.set(n.key, {
      x: DOT_GAP * ((i % DOT_PER_ROW) + 0.5),
      y: gridTop + Math.floor(i / DOT_PER_ROW) * DOT_GAP,
      r: DOT_R,
    });
  });
  const height = rest.length > 0 ? gridTop + Math.ceil(rest.length / DOT_PER_ROW) * DOT_GAP : y + 40;
  return { at, height, dividerY: rest.length > 0 ? dividerY : null, restCount: rest.length };
}

function edgePath(a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const sx = a.x + (dx / len) * (a.r + 1);
  const sy = a.y + (dy / len) * (a.r + 1);
  const ex = b.x - (dx / len) * (b.r + 5);
  const ey = b.y - (dy / len) * (b.r + 5);
  const bend = dy <= 0 || len > PATH_ROW * 1.6 ? 26 : 0;
  const cx = (sx + ex) / 2 - (dy / len) * bend;
  const cy = (sy + ey) / 2 + (dx / len) * bend;
  return `M${sx.toFixed(1)},${sy.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
}

function Dot({ n, p, dim, onTap }: { n: GroupMapNode; p: Point; dim: boolean; onTap: () => void }) {
  const kind = kindOf(n);
  const fill = {
    current: COLORS.current,
    covered: COLORS.covered,
    earlier: 'rgba(245,158,11,0.15)',
    toCover: COLORS.toCover,
    ineligible: 'transparent',
  }[kind];
  const stroke = kind === 'earlier' ? COLORS.earlier : kind === 'ineligible' ? COLORS.ineligible : fill;
  return (
    <g onClick={onTap} style={{ cursor: 'pointer' }} opacity={dim ? 0.4 : 1}>
      <title>{`${n.name}: weight ${Math.round(n.weight * 100)}%, ${statusOf(n).toLowerCase()}`}</title>
      {/* A larger invisible target, so a small dot is easy to tap. */}
      <circle cx={p.x} cy={p.y} r={Math.max(p.r + 6, 12)} fill="transparent" />
      {kind === 'current' && (
        <circle cx={p.x} cy={p.y} r={p.r + 5} fill="none" stroke={COLORS.current} strokeWidth={1.2}>
          <animate attributeName="r" values={`${p.r + 3};${p.r + 7};${p.r + 3}`} dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.8;0.15;0.8" dur="2.4s" repeatCount="indefinite" />
        </circle>
      )}
      <circle
        cx={p.x}
        cy={p.y}
        r={p.r}
        fill={fill}
        stroke={stroke}
        strokeWidth={kind === 'earlier' ? 2 : 1.2}
        strokeDasharray={n.own ? '2 2' : undefined}
      />
    </g>
  );
}

export default function GroupMap({ postId, refreshKey = 0 }: { postId: string; refreshKey?: number }) {
  const [map, setMap] = useState<GroupMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    postsApi.map(postId).then(setMap).catch((err) => setError((err as Error).message));
  }, [postId, refreshKey]);

  const drawn = useMemo(() => (map ? layout(map) : null), [map]);

  if (error) return <div className="text-xs font-mono text-accent-red">{error}</div>;
  if (!map || !drawn) return <div className="h-64 bg-navy-800 rounded-xl animate-pulse" />;

  const { at, height, dividerY, restCount } = drawn;
  const toGo = map.eligibleGroups - map.coveredGroups;
  const percent = map.eligibleGroups > 0 ? Math.round((map.coveredGroups / map.eligibleGroups) * 100) : 0;
  const chosen = selected ? map.nodes.find((n) => n.key === selected) : undefined;
  const arrivals = chosen ? map.edges.filter((e) => e.to === chosen.key) : [];
  const nameOf = (key: string) => (key === 'you' ? 'you' : map.nodes.find((n) => n.key === key)?.name ?? '');
  const tap = (key: string) => setSelected(selected === key ? null : key);
  const pathNodes = map.nodes.filter((n) => at.get(n.key)?.r === PATH_R);
  const restNodes = map.nodes.filter((n) => at.get(n.key)?.r === DOT_R);

  return (
    <div className="flex flex-col gap-4">
      {/* Round and progress */}
      <div className="flex flex-col gap-2 font-mono">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-bold text-accent-teal">Round {map.round}</span>
          <span className="text-xs text-gray-400">
            {map.coveredGroups} of {map.eligibleGroups} groups covered
          </span>
        </div>
        <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${percent}%`, background: COLORS.covered }} />
        </div>
        <div className="text-xs text-gray-300">
          {toGo > 0
            ? `${toGo} more group${toGo !== 1 ? 's' : ''} to cover in this round`
            : 'Every eligible group is covered: the next push starts a new round'}
          <span className="text-gray-500"> · {map.nodes.length} groups in all</span>
        </div>
        {map.round > 1 && (
          <div className="text-[11px] text-gray-500 leading-relaxed">
            Your post has been to every eligible group {map.round - 1} time{map.round > 2 ? 's' : ''}.
            In this round it goes again to each of them, once.
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full h-auto select-none"
        role="img"
        aria-label="Map of every group: the ones your post has covered, the ones reading it now, and the ones yet to cover"
      >
        <defs>
          {(['current', 'covered', 'earlier', 'author', 'start'] as const).map((k) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={COLORS[k]} />
            </marker>
          ))}
        </defs>

        {map.edges.map((e, i) => {
          const a = at.get(e.from);
          const b = at.get(e.to);
          const target = map.nodes.find((n) => n.key === e.to);
          if (!a || !b || !target) return null;
          const kind = e.by === 'group' ? (kindOf(target) === 'current' ? 'current' : kindOf(target) === 'covered' ? 'covered' : 'earlier') : e.by;
          return (
            <path
              key={i}
              d={edgePath(a, b)}
              fill="none"
              stroke={COLORS[kind]}
              strokeWidth={1.4}
              strokeDasharray={e.by === 'group' ? undefined : '4 3'}
              opacity={selected && selected !== e.to && selected !== e.from ? 0.2 : 0.85}
              markerEnd={`url(#arrow-${kind})`}
            />
          );
        })}

        <g>
          <circle cx={WIDTH / 2} cy={TOP} r={13} fill="#0d0d1a" stroke={COLORS.author} strokeWidth={2} />
          <text x={WIDTH / 2} y={TOP + 3} textAnchor="middle" fontSize="8.5" fontWeight="bold" fill={COLORS.author} fontFamily="Courier New, monospace">
            YOU
          </text>
        </g>

        {pathNodes.map((n) => {
          const p = at.get(n.key)!;
          return (
            <g key={n.key}>
              <Dot n={n} p={p} dim={!!selected && selected !== n.key} onTap={() => tap(n.key)} />
              <text x={p.x} y={p.y + p.r + 12} textAnchor="middle" fontSize="8.5" fill="#d1d5db" fontFamily="Courier New, monospace">
                {n.name}
              </text>
              {n.current && n.arrivedAt && (
                <text x={p.x} y={p.y + p.r + 23} textAnchor="middle" fontSize="8" fill={COLORS.current} fontFamily="Courier New, monospace">
                  {shortTime(n.arrivedAt)}
                </text>
              )}
            </g>
          );
        })}

        {dividerY !== null && (
          <g>
            <line x1={8} x2={WIDTH - 8} y1={dividerY} y2={dividerY} stroke="#1f2937" strokeDasharray="3 4" />
            <text x={WIDTH / 2} y={dividerY + 15} textAnchor="middle" fontSize="8.5" fill="#6b7280" fontFamily="Courier New, monospace">
              {`NOT REACHED YET · ${restCount}`}
            </text>
          </g>
        )}
        {restNodes.map((n) => (
          <Dot key={n.key} n={n} p={at.get(n.key)!} dim={!!selected && selected !== n.key} onTap={() => tap(n.key)} />
        ))}
      </svg>

      {chosen && (
        <div className="text-xs font-mono text-gray-300 bg-navy-700 rounded-lg p-3 flex flex-col gap-1">
          <div>
            <span className="font-bold text-gray-100">{chosen.name}</span>
            <span className="text-gray-500"> · weight </span>
            <span className="text-accent-teal">{Math.round(chosen.weight * 100)}%</span>
          </div>
          <div className="text-gray-400">
            {statusOf(chosen)}
            {chosen.arrivedAt && (
              <> since {new Date(chosen.arrivedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</>
            )}
          </div>
          {arrivals.map((e, i) => (
            <div key={i} className="text-gray-500">
              Reached {new Date(e.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              {e.by === 'start' && ', where you posted it'}
              {e.by === 'author' && ', by your manual push'}
              {e.by === 'group' && `, pushed on by ${nameOf(e.from)}`}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] font-mono text-gray-400">
        {(['current', 'covered', 'toCover', 'earlier', 'ineligible'] as const).map((k) => (
          <span key={k} className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{
                background: k === 'earlier' ? 'rgba(245,158,11,0.15)' : k === 'ineligible' ? 'transparent' : COLORS[k],
                border: `${k === 'earlier' ? 2 : 1}px solid ${k === 'earlier' ? COLORS.earlier : k === 'ineligible' ? '#4b5563' : COLORS[k]}`,
              }}
            />
            {k === 'earlier' ? 'Earlier round only' : k === 'ineligible' ? 'Cannot get it' : LABELS[k]}
          </span>
        ))}
        <span className="flex items-center gap-2">
          <span className="w-4 shrink-0 border-t-2 border-dashed" style={{ borderColor: COLORS.author }} /> Your manual push
        </span>
      </div>
      <p className="text-[11px] font-mono text-gray-500 leading-relaxed">
        Each dot is a group; tap one for its name, weight and when your post reached it. Solid
        arrows are a group&apos;s push, the grey dashed one is where you posted it. A group reading
        it now shows when it arrived there.
      </p>
    </div>
  );
}
