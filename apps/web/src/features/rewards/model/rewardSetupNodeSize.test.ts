import {expect,it} from 'vitest';
import {createRewardSetup,presetSetupShares,type RewardSetupNode} from '@raceson/domain/rewards/distribution-setup';
import {rewardSetupLayout} from './rewardSetupLayout';
import {rewardSetupNodeSizes} from './rewardSetupNodeSize';
const node=(id:string,children:RewardSetupNode[]=[],count=0):RewardSetupNode=>({id,name:id,shareBps:2000,locked:false,children,rule:count?{basis:'race_position',sharesBps:presetSetupShares(count),source:null}:null});
const league=()=>{const root=createRewardSetup('root').root;root.children=[node('league',[node('participation',[],25),node('km',[],25),node('club',[],25)]),node('races',Array.from({length:5},(_,r)=>node(`round${r}`,Array.from({length:7},(_,c)=>node(`category${r}-${c}`,[],r?10:0)))))];return root;};
it('keeps all 401 points on evenly spaced rings for a league with 355 winners',()=>{
 const layout=rewardSetupLayout(league(),new Set(),true);
 expect(layout.points).toHaveLength(401);
 for(let d=1;d<layout.radii.length;d++)expect(layout.radii[d]-layout.radii[d-1]).toBeCloseTo(layout.radii[1]);
 for(const width of [350,1000]){
  const scale=layout.bounds.width/Math.min(width,650),sizes=rewardSetupNodeSizes(layout.points,scale);
  for(let i=0;i<layout.points.length;i++)for(let j=i+1;j<layout.points.length;j++){
   const a=layout.points[i],b=layout.points[j];
   expect(sizes.get(a.id)!.radius+sizes.get(b.id)!.radius).toBeLessThan(Math.hypot(a.x-b.x,a.y-b.y));
  }
  expect(sizes.get('root')!.radius/scale).toBeGreaterThan(width===350?12:23);
 }
});
it('uses zoom to reveal readable labels without enlarging circles beyond their screen size',()=>{
 const layout=rewardSetupLayout(league(),new Set(),true),overview=rewardSetupNodeSizes(layout.points,layout.bounds.width/650),detail=rewardSetupNodeSizes(layout.points,1);
 expect(overview.get('category1-1:place:1')!.labels).toBe(false);
 expect(detail.get('league')!.labels).toBe(true);
 expect(detail.get('league')!.radius).toBe(25);
 expect(detail.get('root')!.radius).toBe(36);
});
