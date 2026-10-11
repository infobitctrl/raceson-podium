import {expect,it} from 'vitest';
import {radialDistribution} from './radialDistribution';
import type {DistributionNode} from './publicDistribution';
const node=(id:string,level:DistributionNode['level'],children:DistributionNode[]=[]):DistributionNode=>({id,label:id,level,amountWei:1n,children});
it('lays out uneven branches across several rings without overlapping any circles',()=>{
 const tree=node('pool','pool',[node('long','allocation',[node('female','category',Array.from({length:24},(_,i)=>node(`f${i}`,'winner'))),node('male','category',[node('m1','winner')])]),node('short','allocation',[node('junior','category',[node('j1','winner')])])]);
 const graph=radialDistribution(tree);
 expect(graph.rings).toHaveLength(2);
 expect(graph.nodes).toHaveLength(32);
 for(const [i,a] of graph.nodes.entries()) for(const b of graph.nodes.slice(i+1)) expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeGreaterThanOrEqual(a.radius+b.radius);
 for(const e of graph.nodes){expect(e.x-e.radius).toBeGreaterThanOrEqual(0);expect(e.x+e.radius).toBeLessThanOrEqual(graph.size);expect(e.y-e.radius).toBeGreaterThanOrEqual(0);expect(e.y+e.radius).toBeLessThanOrEqual(graph.size);}
 const winner=graph.nodes.find(e=>e.node.id==='m1')!;
 expect(winner.path).toEqual(['long','male','m1']);expect(winner.parentId).toBe('male');
});
it('retains a central root and exact amounts with no results, and respects the visible depth',()=>{
 const empty=radialDistribution(node('empty','pool'));
 expect(empty.rings).toEqual([]);expect(empty.nodes[0]!.x).toBe(empty.size/2);
 const tree=node('pool','pool',[node('track','allocation',[node('category','category',[node('reward','winner')])])]);
 expect(radialDistribution(tree,1).nodes.map(e=>e.node.id)).toEqual(['pool','track']);
 expect(radialDistribution(tree).nodes.at(-1)!.node.amountWei).toBe(1n);
});

function assertGeometry(tree: DistributionNode) {
 const graph=radialDistribution(tree);
 for(const [i,a] of graph.nodes.entries()) {
  expect(Number.isFinite(a.x)&&Number.isFinite(a.y)).toBe(true);
  for(const b of graph.nodes.slice(i+1)) {
   if(Math.hypot(a.x-b.x,a.y-b.y)+1e-7<a.radius+b.radius) throw Error(`Overlapping circles: ${a.node.id}, ${b.node.id}`);
  }
  expect(Math.min(a.x-a.radius,a.y-a.radius)).toBeGreaterThanOrEqual(0);
  expect(Math.max(a.x+a.radius,a.y+a.radius)).toBeLessThanOrEqual(graph.size);
 }
 return graph;
}
it('packs hundreds of rewards into bounded rows instead of one enormous ring',()=>{
 const categories=[274,274,41,50,40,24,18,12,6,5,1].map((count,c)=>node(`cat-${c}`,'category',Array.from({length:count},(_,i)=>({...node(`reward-${c}-${i}`,'winner'),rank:i+1}))));
 const tree=node('pool','pool',Array.from({length:6},(_,p)=>node(`pot-${p}`,'allocation',[node(`track-${p}`,'allocation',p===0?categories:Array.from({length:8},(_,c)=>node(`empty-${p}-${c}`,'category')))])));
 const graph=assertGeometry(tree);
 expect(graph.nodes.filter(e=>e.node.level==='winner')).toHaveLength(745);
 // At a 640px fit view, reward dots retain a usable overview, not subpixel dust.
 expect(graph.size).toBeLessThan(6000);
 const rewardDistances=graph.nodes.filter(e=>e.parentId==='cat-0').map(e=>Math.hypot(e.x-graph.size/2,e.y-graph.size/2));
 expect(new Set(rewardDistances.map(r=>Math.round(r))).size).toBeGreaterThan(3);
 for(let i=1;i<rewardDistances.length;i++)expect(rewardDistances[i]+1e-7).toBeGreaterThanOrEqual(rewardDistances[i-1]);
 expect(rewardDistances[0]).toBeLessThan(rewardDistances[1]);
});
it('preserves rank ties, unknown places, reserves, and exact source nodes without mutation',()=>{
 const children=[{...node('third','winner'),rank:3},{...node('first','winner'),rank:1},node('reserve','reserve'),{...node('tied','winner'),rank:1},node('unknown','winner')];
 const tree=node('pool','pool',[node('category','category',children)]);
 const graph=assertGeometry(tree);
 expect(graph.nodes.filter(e=>e.parentId==='category').map(e=>e.node.id)).toEqual(['first','tied','third','unknown','reserve']);
 expect(children.map(n=>n.id)).toEqual(['third','first','reserve','tied','unknown']);
 for(const child of children)expect(graph.nodes.find(e=>e.node.id===child.id)!.node).toBe(child);
});
it('handles sparse, single-branch, wide and uneven-depth trees at every visible level',()=>{
 const trees=[node('pool','pool'),node('pool','pool',[node('cat','category',Array.from({length:300},(_,i)=>node(`w${i}`,'winner')))]),
  node('pool','pool',Array.from({length:60},(_,i)=>node(`a${i}`,'allocation',[node(`c${i}`,'category',[node(`w${i}`,'winner')])]))),
  node('pool','pool',[node('early','category',[node('r1','winner')]),node('deep','allocation',[node('deeper','allocation',[node('late','category',[node('r2','winner')])])])])];
 for(const tree of trees) {
  assertGeometry(tree);
  for(const depth of [0,1,2,3])expect(radialDistribution(tree,depth).nodes.every(e=>e.depth<=depth)).toBe(true);
 }
});
