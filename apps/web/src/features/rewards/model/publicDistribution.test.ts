import {describe,it,expect} from 'vitest';
import {publicDistributionTree,publicTrackGroups,sortPublicRewards,publicFinishTime} from './publicDistribution';
import type {PublicRewardPage,PublicSponsorCampaign} from '@raceson/domain/rewards/public-campaign';
const pot={slot:3,name:'Round 3',amountWei:'100',groups:[{name:'Long · Female',amountWei:'40'},{name:'Short · Male',amountWei:'40'},{name:'Combined clubs',amountWei:'20'}]} as PublicSponsorCampaign['pots'][number];
const campaign={budgetWei:'100',pots:[pot]} as PublicSponsorCampaign;
const row={id:'opaque',number:1,kind:'athlete',amountWei:'60',status:'claimed',breakdown:[{category:'Long · Female',amountWei:'40',place:1},{category:'Short · Male',amountWei:'20',place:2}]} as PublicRewardPage['rows'][number];
describe('public allocation economics',()=>{
 it('uses track budgets for single races, retaining independent club funds',()=>{expect(publicTrackGroups(pot.groups).map(t=>[t.label,t.amountWei])).toEqual([['Long',40n],['Short',40n],['Combined clubs',20n]]);expect(publicDistributionTree(campaign,pot,null,false).children.map(n=>n.label)).toEqual(['Long','Short','Combined clubs']);});
 it('splits a combined entitlement by exact contribution without duplicating its payment',()=>{const tree=publicDistributionTree(campaign,pot,[row],false);const female=tree.children[0]!.children[0]!,male=tree.children[1]!.children[0]!;expect(female.children[0]).toMatchObject({amountWei:40n,status:'claimed',reference:'opaque'});expect(male.children[0]).toMatchObject({amountWei:20n,status:'claimed'});expect(male.children[1]).toMatchObject({amountWei:20n,level:'reserve'});});
 it('keeps unavailable breakdowns neutral and league pots distinct',()=>{const tree=publicDistributionTree({...campaign,pots:[{...pot,slot:0,name:'League'},pot],budgetWei:'200'},pot,[{...row,breakdown:undefined}],false);expect(tree.children.map(n=>n.label)).toEqual(['League','Round 3']);expect(tree.children[1]!.children[0]!.children[0]!.children).toEqual([]);});
 it('sorts exact wei without floating point loss and preserves deterministic ties',()=>{const rows=[{...row,id:'a',amountWei:'1000000000000000001'},{...row,id:'b',number:2,amountWei:'1000000000000000000'}];expect(sortPublicRewards(rows,'amount',false).map(r=>r.id)).toEqual(['b','a']);});
});

import {publicAmount} from './publicAmount';
it('sorts sporting names, positions and exact times with absent values last',()=>{
 const rows=[{...row,id:'a',number:1,display:{name:'Runner 10',club:null,timeMs:null},breakdown:[{category:'Distance',amountWei:'60',place:null}]},
 {...row,id:'b',number:2,display:{name:'Runner 2',club:'Club 2',timeMs:'1000000000000001'}},
 {...row,id:'c',number:3,display:{name:'Runner 3',club:'Club 1',timeMs:'1000000000000000'}}];
 expect(sortPublicRewards(rows,'name',false).map(r=>r.id)).toEqual(['b','c','a']);
 expect(sortPublicRewards(rows,'time',false).map(r=>r.id)).toEqual(['c','b','a']);
 expect(sortPublicRewards(rows,'time',true).map(r=>r.id)).toEqual(['b','c','a']);
 expect(sortPublicRewards(rows,'position',true).at(-1)?.id).toBe('a');
});
it('displays all wei precision without truncating paid amounts',()=>{expect(publicAmount(43750000000000000n)).toBe('0.04375');expect(publicAmount(1n)).toBe('0.000000000000000001');expect(publicAmount(1000000000000000001n,true)).toBe('1,000000000000000001');});

it('formats copied finish times with millisecond precision and leaves absent league times empty',()=>{expect(publicFinishTime('5199630')).toBe('01:26:39.630');expect(publicFinishTime('0')).toBe('00:00:00.000');expect(publicFinishTime(null)).toBe('—');});

it('sorts aggregated rewards by the selected category position without changing amounts or breakdowns',()=>{
 const rows=[row,{...row,id:'second',number:2,breakdown:[{category:'Long · Female',place:2,amountWei:'40'},{category:'Short · Male',place:1,amountWei:'20'}]},
 {...row,id:'unknown',number:3,breakdown:[{category:'Long · Female',place:1,amountWei:'40'},{category:'Short · Male',place:null,amountWei:'20'}]}];
 const original=structuredClone(rows);
 expect(sortPublicRewards(rows,'position',false,false,'Short · Male').map(r=>r.id)).toEqual(['second','opaque','unknown']);
 expect(sortPublicRewards(rows,'position',true,false,'Short · Male').map(r=>r.id)).toEqual(['opaque','second','unknown']);
 expect(rows).toEqual(original);
});
