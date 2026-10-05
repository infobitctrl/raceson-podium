import {expect,it} from 'vitest';
import {createRewardSetup,decodeRewardSetup,defaultRewardSetupPolicy,previewRewardSetup,setupNodes,setupReadiness} from '@raceson/domain/rewards/distribution-setup';
import {generateLeagueSetupTree,leagueRewardOptions} from './setupLeagueTree';
import type {RewardSourceCatalogueV2} from '@raceson/domain/rewards/source-mapping-v2';
const id=(n:number)=>`78000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ctx={draftId:id(1),roundId:null,editionId:null,catalogueHash:'a'.repeat(64),programmeName:'Season',eventName:'Season'};
const catalogue:RewardSourceCatalogueV2={categories:[{id:id(2),competitionId:id(3),competitionName:'Long',name:'Overall',target:'individual',eligibility:{}},{id:id(4),competitionId:id(3),competitionName:'Long',name:'Clubs',target:'club',eligibility:{}}],rounds:[1,2,3].map(n=>({id:id(10+n),editionId:id(20+n),slot:n,name:`Round ${n}`,date:'2026-10-03',status:n===3?'cancelled':'published',races:[{id:id(30+n),competitionId:id(3),name:'Long',distanceMetres:'25000',publicationId:null,publicationState:null,resultCount:0}]}))};
it('creates league and round category pots together, with independent winner counts and correct result sources',()=>{
 const options=leagueRewardOptions(catalogue,ctx);expect(options).toHaveLength(6);
 let counter=100;const root=generateLeagueSetupTree(createRewardSetup(id(90)).root,ctx,options.map((o,i)=>({...o,winners:i+1})),()=>id(counter++));
 expect(root.children.map(n=>[n.name,n.shareBps])).toEqual([['League',5000],['Rounds',5000]]);
 expect(root.children[1].children.map(n=>[n.name,n.shareBps])).toEqual([['Round 1',5000],['Round 2',5000]]);
 expect(root.children[0].children[1].rule).toMatchObject({basis:'club_points',source:{roundId:null}});
 expect(root.children[1].children[0].children[1].rule).toMatchObject({basis:'club_points',source:{roundId:id(11)}});
 expect(setupNodes(root).filter(n=>n.rule).map(n=>n.rule!.sharesBps.length)).toEqual([1,2,3,4,5,6]);
 const setup=decodeRewardSetup({...createRewardSetup(id(90)),version:4,programmeKind:'league',event:null,context:ctx,stage:'ready',policy:defaultRewardSetupPolicy(),root});
 expect(setupReadiness(setup)).toEqual([]);expect(previewRewardSetup(setup).complete).toBe(true);
});
it('creates only selected round/category groups and leaves the input tree intact',()=>{
 const options=leagueRewardOptions(catalogue,{...ctx,roundId:id(12)});expect(options).toHaveLength(2);expect(options.every(o=>o.roundId===id(12))).toBe(true);
 const root=createRewardSetup(id(90)).root,before=structuredClone(root);let counter=100;
 const next=generateLeagueSetupTree(root,ctx,[{...options[0],winners:10}],()=>id(counter++));
 expect(next.children).toHaveLength(1);expect(next.children[0].name).toBe('Rounds');expect(next.children[0].children[0].children).toHaveLength(1);expect(root).toEqual(before);
});
