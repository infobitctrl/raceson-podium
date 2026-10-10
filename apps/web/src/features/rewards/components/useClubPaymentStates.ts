import {useEffect,useState} from 'react';
import type {SponsorClubAward} from '../data/sponsorClubClaims';
import {clubSafeCreationHistory,type ClubCreationRecord} from '../data/clubSafeCreation';
import {readClubDirectClaimV5} from '../data/clubDirectClaimsV5';

export type ClubPaymentState='paid'|'unclaimed'|'checking'|'unavailable';
export const clubAwardKey=(award:SponsorClubAward)=>`${award.approvalId}:${award.entitlementId}`;
export const isDirectClubAward=(award:SponsorClubAward)=>[5,6].includes(award.protocolVersion??4);
const recordedPaid=(award:SponsorClubAward)=>isDirectClubAward(award)?award.directClaim?.paid===true:award.claims.some(claim=>claim.paid);

/** Receipt records can lag an on-chain payment. Reconcile display only; never prepare or sign. */
export function useClubPaymentStates(awards:SponsorClubAward[],onAccessError?:(error:unknown)=>void){
 const [result,setResult]=useState<{source:SponsorClubAward[];states:Record<string,ClubPaymentState>}|null>(null);
 useEffect(()=>{
  let active=true;
  const unresolved=awards.filter(award=>isDirectClubAward(award)&&!recordedPaid(award));
  const put=(award:SponsorClubAward,state:ClubPaymentState)=>{if(active)setResult(previous=>({source:awards,states:{...(previous?.source===awards?previous.states:{}),[clubAwardKey(award)]:state}}));};
  const failed=(error:unknown)=>{if(active&&error&&typeof error==='object'&&'status' in error&&[401,403].includes(Number(error.status)))onAccessError?.(error);};
  if(unresolved.length)void (async()=>{
   try{
    const records:ClubCreationRecord[]=[];let after:string|null=null;
    do{const page=await clubSafeCreationHistory(after);if(!active)return;records.push(...page.items);after=page.nextCursor;}while(after);
    await Promise.all(unresolved.map(async award=>{
     const treasury=records.find(record=>record.clubId===award.clubId&&record.current&&record.verified);
     if(!treasury){put(award,'unclaimed');return;}
     try{
      const view=await readClubDirectClaimV5({approvalId:award.approvalId,entitlementId:award.entitlementId},treasury.requestId);
      if(view.clubId!==award.clubId||view.safeAddress!==treasury.verified!.safeAddress||view.amountWei!==award.amountWei||(view.protocolVersion??5)!==award.protocolVersion)throw Error('award_changed');
      put(award,view.status==='paid'?'paid':'unclaimed');
     }catch(error){put(award,'unavailable');failed(error);}
    }));
   }catch(error){unresolved.forEach(award=>put(award,'unavailable'));failed(error);}
  })();
  return()=>{active=false;};
 },[awards,onAccessError]);
 return (award:SponsorClubAward):ClubPaymentState=>recordedPaid(award)?'paid':!isDirectClubAward(award)?'unclaimed':result?.source===awards?result.states[clubAwardKey(award)]??'checking':'checking';
}
