import {expect,it} from 'vitest';
import {selectCampaigns} from './podiumDirectory';
import {sortResultRows} from './resultSorting';
import type {DirectoryCampaign} from '@raceson/domain/rewards/public-directory';
import type {ResultDisplay} from '../data/resultDisplay';
const item=(id:string,name:string,budget:string,finished=false)=>({campaign:{id,name,budgetWei:budget,pots:[{amountWei:budget,paidWei:'0',returnedWei:finished?budget:'0',remainingWei:finished?'0':budget,state:finished?4:1,paused:false}]},verified:true,publishedAt:'2026-09-28T10:00:00Z',selection:null}) as DirectoryCampaign;
it('sorts wei precisely before display pagination, searches accents, preserves records and separates finished',()=>{
 const a=item('a','Šubićevac','1000000000000000001'),b=item('b','Zebra','1000000000000000000'),c=item('c','Closed','100',true),rows=[a,b,c];
 expect(selectCampaigns(rows,{status:'active',query:'',sort:'funded',descending:false}).map(i=>i.campaign.id)).toEqual(['b','a']);
 expect(selectCampaigns(rows,{status:'active',query:'subicevac',sort:'name',descending:false})).toEqual([a]);
 expect(selectCampaigns(rows,{status:'finished',query:'',sort:'date',descending:true})).toEqual([c]);expect(rows).toEqual([a,b,c]);
});
it('result sorting never rewrites official rank and keeps missing values last in either direction',()=>{
 const rows=[{key:'a',rank:2,race:'Race',name:'Zed',amountWei:'1000000000000000001',timeMs:20,categories:[]},{key:'b',rank:1,race:'Race',name:'Amy',amountWei:'1000000000000000000',timeMs:10,categories:[]},{key:'c',rank:null,race:'Race',name:'DNS',amountWei:null,timeMs:null,categories:[]}] as ResultDisplay['rows'];
 expect(sortResultRows(rows,'reward').map(r=>r.key)).toEqual(['b','a','c']);expect(sortResultRows(rows,'reward',true).map(r=>r.key)).toEqual(['a','b','c']);expect(sortResultRows(rows,'time',true).map(r=>r.key)).toEqual(['a','b','c']);expect(sortResultRows(rows,'official').map(r=>r.rank)).toEqual([1,2,null]);expect(rows[0].rank).toBe(2);
});
