import type {DistributionNode} from './publicDistribution';

export type RadialNode = {node: DistributionNode; path: string[]; depth: number; x: number; y: number; radius: number; parentId?: string};
const TAU = Math.PI * 2, GAP = 12, REWARD_RADIUS = 34;
const isReward = (node: DistributionNode) => node.level === 'winner' || node.level === 'reserve';

/** Reserve sectors for categories, then pack rewards into short outward rows.
 * Reward count affects sector width sublinearly instead of stretching every
 * hierarchy ring to accommodate all winners on a single circumference.
 * Geometry never represents money; node values and parent paths are untouched. */
export function radialDistribution(tree: DistributionNode, maxDepth = Infinity) {
  type Entry = RadialNode & {angle: number; distance: number};
  const entries: Entry[] = [];
  const rows = new Map<number, Entry[]>();
  const groups: {parent: Entry; children: DistributionNode[]; span: number}[] = [];
  const weights = new Map<DistributionNode, number>();
  const measure = (node: DistributionNode, depth: number): number => {
    const weight = depth >= maxDepth || !node.children.length ? 1
      : node.children.every(isReward) ? Math.max(1, Math.ceil(Math.sqrt(node.children.length / 2)))
      : node.children.reduce((sum, child) => sum + measure(child, depth + 1), 0);
    weights.set(node, weight);
    return weight;
  };
  const total = measure(tree, 0);
  const visit = (node: DistributionNode, depth: number, start: number, path: string[], parentId?: string) => {
    const slots = weights.get(node)!;
    const angle = -Math.PI / 2 + (start + slots / 2) / total * TAU;
    const entry: Entry = {node, path, depth, angle, parentId, distance: 0, x: 0, y: 0,
      radius: depth === 0 ? 60 : isReward(node) ? REWARD_RADIUS : node.level === 'category' ? 40 : 46};
    entries.push(entry);
    const row = rows.get(depth) ?? [];
    row.push(entry); rows.set(depth, row);
    if (depth >= maxDepth || !node.children.length) return;
    if (node.children.every(isReward)) {
      // Known sporting places come first, ties keep source order, reserves last.
      const children = [...node.children].sort((a, b) => Number(a.level === 'reserve') - Number(b.level === 'reserve')
        || (a.rank ?? Infinity) - (b.rank ?? Infinity));
      groups.push({parent: entry, children, span: slots / total * TAU});
      return;
    }
    let cursor = start;
    for (const child of node.children) {
      visit(child, depth + 1, cursor, [...path, child.id], node.id);
      cursor += weights.get(child)!;
    }
  };
  visit(tree, 0, 0, []);

  const rings: number[] = [];
  let distance = 0, previousRadius = 60;
  for (const [depth, row] of rows) {
    if (depth === 0) continue;
    const radius = Math.max(...row.map(e => e.radius));
    distance += previousRadius + radius + GAP;
    if (row.length > 1) {
      for (let i = 0; i < row.length; i++) {
        const a = row[i]!, b = row[(i + 1) % row.length]!;
        const angle = (b.angle - a.angle + TAU) % TAU;
        distance = Math.max(distance, (a.radius + b.radius + GAP) / (2 * Math.sin(angle / 2)));
      }
    }
    for (const entry of row) entry.distance = distance;
    rings.push(distance); previousRadius = radius;
  }

  let extent = distance + previousRadius;
  if (groups.length) {
    const pitch = REWARD_RADIUS * 2 + GAP;
    let firstRow = distance + previousRadius + REWARD_RADIUS + GAP;
    for (const group of groups) firstRow = Math.max(firstRow, pitch / (2 * Math.sin(Math.min(Math.PI, group.span) / 2)));
    for (const {parent, children, span} of groups) {
      let offset = 0, row = 0;
      while (offset < children.length) {
        const radius = firstRow + row * pitch;
        const step = 2 * Math.asin(pitch / (2 * radius));
        // The first three rewards have their own inner rows. Later places share rows
        // when needed; sorting is radial first, then clockwise within the row.
        const count = row < 3 ? 1 : Math.min(children.length - offset, Math.max(1, Math.floor(span / step)));
        for (let i = 0; i < count; i++) {
          const node = children[offset + i]!;
          entries.push({node, path: [...parent.path, node.id], depth: parent.depth + 1, parentId: parent.node.id,
            angle: parent.angle + (i - (count - 1) / 2) * step, distance: radius, radius: REWARD_RADIUS, x: 0, y: 0});
        }
        extent = Math.max(extent, radius + REWARD_RADIUS);
        offset += count; row++;
      }
    }
  }
  const size = 2 * (extent + 18);
  for (const entry of entries) {
    entry.x = size / 2 + Math.cos(entry.angle) * entry.distance;
    entry.y = size / 2 + Math.sin(entry.angle) * entry.distance;
  }
  // Only hierarchy levels get guide circles: reward rows need no full orbit.
  return {nodes: entries, rings, size};
}
