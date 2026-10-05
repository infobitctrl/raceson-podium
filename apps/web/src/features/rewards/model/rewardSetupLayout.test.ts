import {expect,it} from 'vitest';
import {rewardSetupLayout} from './rewardSetupLayout';
import {createRewardSetup,presetSetupShares,type RewardSetupNode} from '@raceson/domain/rewards/distribution-setup';
it('gives small reward groups space beside groups with many winners and retains every point',()=>{
 const root=createRewardSetup('root').root;
 const leaf=(id:string,count:number):RewardSetupNode=>({id,name:id,shareBps:2000,locked:false,children:[],rule:{basis:'race_position',sharesBps:presetSetupShares(count),source:null}});
 root.children=[{id:'race',name:'Race',shareBps:6000,locked:false,rule:null,children:[leaf('overall',10),leaf('categoryA',5),leaf('categoryB',3),leaf('special',1),leaf('club',2)]},{id:'participation',name:'Participation',shareBps:4000,locked:false,rule:null,children:[leaf('a',4),leaf('b',6),leaf('c',8)]}];
 const layout=rewardSetupLayout(root,new Set(),true);expect(layout.points).toHaveLength(50);
 const criteria=layout.points.filter(p=>p.depth===2);
 for(let i=0;i<criteria.length;i++)for(let j=i+1;j<criteria.length;j++)expect(Math.hypot(criteria[i].x-criteria[j].x,criteria[i].y-criteria[j].y)).toBeGreaterThan(130);
 expect(layout.points.find(p=>p.id==='root')).toMatchObject({x:0,y:0,parentId:null});
 const collapsed=rewardSetupLayout(root,new Set(['race']),true);expect(collapsed.points.some(p=>p.id==='participation')).toBe(true);expect(collapsed.points.some(p=>p.id==='overall')).toBe(false);
});

it('aligns uneven nested branches on shared rings and keeps sibling positions when collapsed',()=>{
 const node=(id:string,children:RewardSetupNode[]=[]):RewardSetupNode=>({id,name:id,shareBps:5000,locked:false,children,rule:null});
 const root=node('root',[node('a',[node('a1',[node('a11')]),node('a2')]),node('b',[node('b1'),node('b2'),node('b3')])]);
 const full=rewardSetupLayout(root,new Set(),true),closed=rewardSetupLayout(root,new Set(['a']),true);
 for(const p of full.points)expect(Math.hypot(p.x,p.y)).toBeCloseTo(full.radii[p.depth],9);
 for(const p of closed.points){const before=full.points.find(n=>n.id===p.id)!;expect(p.x).toBe(before.x);expect(p.y).toBe(before.y);}
 expect(full.bounds.x+full.bounds.width/2).toBe(0);expect(full.bounds.y+full.bounds.height/2).toBe(0);
 const moved=rewardSetupLayout(root,new Set(),true,{a:1e10}),a=full.points.find(p=>p.id==='a')!,after=moved.points.find(p=>p.id==='a')!;
 expect(after.angle-a.angle).toBeCloseTo(a.travel);expect(moved.points.find(p=>p.id==='a11')!.angle).toBeGreaterThan(full.points.find(p=>p.id==='a11')!.angle);
 expect(moved.points.find(p=>p.id==='b')!.angle).toBe(full.points.find(p=>p.id==='b')!.angle);
 for(const p of moved.points)expect(Math.hypot(p.x,p.y)).toBeCloseTo(moved.radii[p.depth],9);
 const changed=structuredClone(root);changed.children[0].shareBps=0;changed.children[1].shareBps=10000;
 expect(rewardSetupLayout(changed,new Set(),true).points.map(p=>[p.x,p.y])).toEqual(full.points.map(p=>[p.x,p.y]));
});
