import type {DistributionNode} from './publicDistribution';

export type RadialNode = {node: DistributionNode; path: string[]; depth: number; x: number; y: number; radius: number; parentId?: string};
/** Equal leaf slots express hierarchy, not value. Amounts remain exact inside each
 * circle. Increase ring radii when needed so adjacent circles cannot overlap. */
export function radialDistribution(tree: DistributionNode, maxDepth = Infinity) {
  const entries: (RadialNode & {angle: number})[] = [];
  const weight = (node: DistributionNode, depth: number): number => depth >= maxDepth || !node.children.length ? 1 : node.children.reduce((sum, child) => sum + weight(child, depth + 1), 0);
  const total = weight(tree, 0);
  const visit = (node: DistributionNode, depth: number, start: number, path: string[], parentId?: string) => {
    const slots = weight(node, depth);
    const angle = -Math.PI / 2 + (start + slots / 2) / total * Math.PI * 2;
    entries.push({node, path, depth, angle, parentId, x: 0, y: 0, radius: depth === 0 ? 60 : node.level === 'winner' || node.level === 'reserve' ? 34 : node.level === 'category' ? 40 : 46});
    if (depth >= maxDepth) return;
    let cursor = start;
    for (const child of node.children) {visit(child, depth + 1, cursor, [...path, child.id], node.id); cursor += weight(child, depth + 1);}
  };
  visit(tree, 0, 0, []);
  const depths = Math.max(...entries.map(e => e.depth));
  const rings: number[] = [0];
  let previousRadius = 60;
  for (let depth = 1; depth <= depths; depth++) {
    const row = entries.filter(e => e.depth === depth).sort((a,b) => a.angle - b.angle);
    const radius = Math.max(...row.map(e => e.radius));
    let distance = rings[depth - 1]! + previousRadius + radius + 26;
    if (row.length > 1) {
      const gap = Math.min(...row.map((e,i) => (row[(i+1)%row.length]!.angle - e.angle + Math.PI*2) % (Math.PI*2)));
      distance = Math.max(distance, (radius*2+14)/(2*Math.sin(gap/2)));
    }
    rings.push(distance); previousRadius = radius;
  }
  const size = 2 * (rings[depths]! + previousRadius + 18);
  for (const entry of entries) {entry.x = size/2 + Math.cos(entry.angle)*rings[entry.depth]!; entry.y = size/2 + Math.sin(entry.angle)*rings[entry.depth]!;}
  return {nodes: entries, rings: rings.slice(1), size};
}
