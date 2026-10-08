import {expect,it} from 'vitest';
import {radialDistribution} from './radialDistribution';
import type {DistributionNode} from './publicDistribution';
const node=(id:string,level:DistributionNode['level'],children:DistributionNode[]=[]):DistributionNode=>({id,label:id,level,amountWei:1n,children});
it('lays out uneven branches across several rings without overlapping any circles',()=>{
 const tree=node('pool','pool',[node('long','allocation',[node('female','category',Array.from({length:24},(_,i)=>node(`f${i}`,'winner'))),node('male','category',[node('m1','winner')])]),node('short','allocation',[node('junior','category',[node('j1','winner')])])]);
 const graph=radialDistribution(tree);
 expect(graph.rings).toHaveLength(3);
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
