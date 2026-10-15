/**
 * The author's map of the groups: every group in the system, by name and weight, with the path
 * the post has taken between them and how far it is through the current round. Pure, so the
 * unit tests can load it; groupMapService.ts reads the database for it.
 *
 * Groups appear by name only: no members, no member counts. Group ids are replaced by keys
 * that mean nothing outside the one answer ("g1", "g2", …), and the author is the node "you".
 *
 * A round is one cycle of forwarding (forwarding.ts): the post goes to every eligible group
 * once before any of them gets it again. A group is covered in this round if the post has
 * arrived there since the round began, or is there now.
 */

export interface MapGroup {
  id: string;
  name: string;
  weight: number;
  /** The post can be sent there: enough members, and the author is not in it. */
  eligible: boolean;
  /** The author is a member (so it never gets the post). */
  own: boolean;
}

/** One arrival of the post in a group, from its history or where it is now. */
export interface MapArrival {
  groupId: string;
  /** "start": it was written there; "group": `fromGroupId` pushed it on; "author": its author did. */
  arrivedBy: string;
  fromGroupId: string | null;
  arrivedAt: Date;
  /** It is still there. */
  current: boolean;
}

export interface MapNode {
  key: string;
  name: string;
  /** 0 to 1. */
  weight: number;
  /** The post is in this group now. */
  current: boolean;
  /** The post has been in this group and left it (it may be back there now). */
  passed: boolean;
  /** Covered in the current round. */
  covered: boolean;
  /** Can be sent the post. */
  eligible: boolean;
  /** One of the author's own groups. */
  own: boolean;
  /** When it arrived in this group, for the groups it is in now; null for the others. */
  arrivedAt: string | null;
}

export interface MapEdge {
  /** A node key, or "you" for the author. */
  from: string;
  to: string;
  by: 'start' | 'group' | 'author';
  at: string;
}

export interface GroupMap {
  /** 1 for the first round, 2 once every eligible group has had it once, and so on. */
  round: number;
  /** Eligible groups, and how many of them are covered in this round. */
  eligibleGroups: number;
  coveredGroups: number;
  nodes: MapNode[];
  edges: MapEdge[];
}

function arrivedBy(value: string): MapEdge['by'] {
  return value === 'group' || value === 'author' ? value : 'start';
}

/**
 * `groups` are all the groups; `arrivals` are the post's, in any order; `roundStart` is when
 * the current round began. Nodes on the post's path come first, in the order it reached them,
 * then the others, best weighted first.
 */
export function buildGroupMap(groups: MapGroup[], arrivals: MapArrival[], round: number, roundStart: Date): GroupMap {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const ordered = [...arrivals].sort((a, b) => a.arrivedAt.getTime() - b.arrivedAt.getTime());

  const current = new Set(ordered.filter((a) => a.current).map((a) => a.groupId));
  const arrivedNow = new Map(ordered.filter((a) => a.current).map((a) => [a.groupId, a.arrivedAt.toISOString()]));
  const passed = new Set(ordered.filter((a) => !a.current).map((a) => a.groupId));
  const covered = new Set(
    ordered.filter((a) => a.current || a.arrivedAt.getTime() >= roundStart.getTime()).map((a) => a.groupId),
  );

  const pathIds: string[] = [];
  for (const a of ordered) {
    if (!pathIds.includes(a.groupId) && byId.has(a.groupId)) pathIds.push(a.groupId);
  }
  const others = groups
    .filter((g) => !current.has(g.id) && !passed.has(g.id))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.weight - a.weight || a.name.localeCompare(b.name));
  const shown = [...pathIds.map((id) => byId.get(id)!), ...others];

  const keys = new Map(shown.map((g, i) => [g.id, `g${i + 1}`]));
  const nodes = shown.map((g) => ({
    key: keys.get(g.id)!,
    name: g.name,
    weight: g.weight,
    current: current.has(g.id),
    passed: passed.has(g.id),
    covered: covered.has(g.id),
    eligible: g.eligible,
    own: g.own,
    arrivedAt: arrivedNow.get(g.id) ?? null,
  }));

  const edges: MapEdge[] = [];
  for (const a of ordered) {
    const to = keys.get(a.groupId);
    if (!to) continue;
    const by = arrivedBy(a.arrivedBy);
    // The author's push and the start come from the author; a group's push from that group.
    const from = by === 'group' && a.fromGroupId ? keys.get(a.fromGroupId) : 'you';
    if (!from) continue;
    edges.push({ from, to, by, at: a.arrivedAt.toISOString() });
  }

  const eligible = groups.filter((g) => g.eligible);
  return {
    round,
    eligibleGroups: eligible.length,
    coveredGroups: eligible.filter((g) => covered.has(g.id)).length,
    nodes,
    edges,
  };
}
