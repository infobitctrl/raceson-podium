import {expect,it} from 'vitest';
import {createGuidedSetup} from '@raceson/domain/rewards/guided-setup-editor';
import type {SavedRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import type {DirectoryCampaign} from '@raceson/domain/rewards/public-directory';
import {savedCampaignNext,savedCampaignStatus,savedCampaignAction} from './savedCampaignPresentation';
const id='73000000-0000-4000-8000-000000000001';
const record:SavedRewardSetup={id,revision:1,chainId:10143,updatedAt:'2026-09-30T00:00:00.000Z',configuration:createGuidedSetup(()=>crypto.randomUUID()),lifecycle:{state:'funded',canDelete:false,archived:false}};
const live:DirectoryCampaign={verified:true,selection:null,publishedAt:record.updatedAt,campaign:{id,name:'Synthetic race',chainId:10143,address:'0x'+'1'.repeat(40),budgetWei:'10',fundingHash:'0x'+'2'.repeat(64),blockNumber:'10',blockTimestamp:'100',pots:[{slot:1,name:'Race',amountWei:'10',state:3,paused:false,allocatedWei:'10',paidWei:'0',returnedWei:'0',remainingWei:'10',claimDeadline:'200',groups:[]}]}};
it('uses verified distribution state without interpreting open claims as payment',()=>{
 expect(savedCampaignStatus(record,false,false,live)).toBe('Last checked · Claims open');
 expect(savedCampaignNext(record,false,live)).toBe('Athletes & clubs · Claim rewards');
 expect(savedCampaignStatus(record,false)).toBe('Funded');
 expect(savedCampaignNext(record,false)).toContain('Check current distribution');
});
it('does not borrow another campaign’s state or hide failed verification',()=>{
 expect(savedCampaignStatus(record,false,false,{...live,campaign:{...live.campaign,id:'other'}})).toBe('Funded');
 expect(savedCampaignStatus(record,false,false,{...live,verified:false})).toBe('Status unavailable');
 expect(savedCampaignNext(record,false,{...live,verified:false})).toBe('Check campaign status');
});
it('keeps pause and expiry distinct and provides the responsible role',()=>{
 const paused={...live,campaign:{...live.campaign,pots:live.campaign.pots.map(p=>({...p,paused:true}))}};
 expect(savedCampaignStatus(record,false,false,paused)).toBe('Last checked · Claims paused');
 expect(savedCampaignNext(record,false,paused)).toContain('Review the pause');
 const expired={...live,campaign:{...live.campaign,blockTimestamp:'201'}};
 expect(savedCampaignStatus(record,false,false,expired)).toBe('Last checked · Awaiting settlement');
});

it('keeps sponsor actions role appropriate and does not claim availability on failed verification',()=>{
 expect(savedCampaignAction(record,false,live)).toBe('Track rewards');
 expect(savedCampaignAction(record,false,{...live,verified:false})).toBe('Check status');
 expect(savedCampaignAction(record,false)).toBe('Check distribution');
 expect(savedCampaignAction({...record,lifecycle:{state:'deposit',canDelete:false}},false)).toBe('Review source links');
 expect(savedCampaignAction({...record,lifecycle:{state:'draft',canDelete:true},configuration:{...record.configuration,stage:'draft'}},false)).toBe('Continue setup');
});
