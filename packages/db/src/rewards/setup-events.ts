import {setupId} from '@raceson/domain/rewards/distribution-setup';
import type {EventRewardGroup,RewardEventCatalogue,RewardEventRace,RewardEventSummary,EventRewardResults} from '@raceson/domain/rewards/setup-event';
import {createAdminSupabaseClient} from '../supabase.js';
import {RewardLedgerStoreError,type RewardLedgerRpc} from './programme-ledger.js';
import type {RewardAccountIdentity} from './athlete-wallets.js';
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('invalid_reward_setup');return v as Record<string,unknown>;};
const text=(v:unknown)=>{if(typeof v!=='string'||!v.trim()||v.length>500)throw Error('invalid_reward_setup');return v;};
const uuid=(v:unknown)=>{if(!setupId(v))throw Error('invalid_reward_setup');return v;};
const nullableNumber=(v:unknown):number|null=>{if(v===null||v===undefined)return null;const n=Number(v);if(!Number.isFinite(n)||n<0)throw Error('invalid_reward_setup');return n;};
const arr=(v:unknown):unknown[]=>{if(!Array.isArray(v))throw Error('invalid_reward_setup');return v;};
function summary(v:unknown):RewardEventSummary {const e=obj(v);const date=text(e.date);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('invalid_reward_setup');return {id:uuid(e.id),name:text(e.name),date,organizationName:text(e.organizationName)};}
/** Read only explicit classifications: missing settings never invent eligible groups. */
export function eventCatalogue(v:unknown):RewardEventCatalogue {
 const e=obj(v),hash=text(e.catalogueHash);if(!/^[0-9a-f]{64}$/.test(hash))throw Error('invalid_reward_setup');
 const races:RewardEventRace[]=arr(e.races).map(value=>{const r=obj(value),ranking=r.ranking&&typeof r.ranking==='object'?obj(r.ranking):{},groups:EventRewardGroup[]=[],missing:string[]=[];
 const group=(key:string,label:string,kind:EventRewardGroup['kind'],gender:'F'|'M'|null=null,min:number|null=null,max:number|null=null)=>{if(!/^[a-zA-Z0-9_.:-]{1,100}$/.test(key)||groups.some(g=>g.key===key)||(min!==null&&max!==null&&min>max)){missing.push('Invalid classification');return;}groups.push({key,label,kind,gender,minimumAge:min,maximumAge:max});};
 if(r.resultsMode==='standard'){
  if(ranking.overall&&obj(ranking.overall).enabled===true)group('overall','Overall finishers','overall');else missing.push('Overall ranking is not configured');
  if(Array.isArray(ranking.classifications)&&ranking.classifications.length){for(const item of ranking.classifications){const c=obj(item);if(c.gender!==null&&c.gender!=='F'&&c.gender!=='M'){missing.push('Invalid category eligibility');continue;}group(`category:${text(c.key)}`,text(c.label),'category',c.gender as 'F'|'M'|null,nullableNumber(c.minimumAge),nullableNumber(c.maximumAge));}}
  else {if(ranking.sex&&obj(ranking.sex).enabled===true)for(const item of arr(obj(ranking.sex).buckets)){const c=obj(item);if(c.gender==='F'||c.gender==='M')group(`sex:${text(c.key)}`,text(c.label),'sex',c.gender);}
   if(ranking.age&&obj(ranking.age).enabled===true)for(const item of arr(obj(ranking.age).buckets)){const c=obj(item);group(`age:${text(c.key)}`,text(c.label),'age',null,nullableNumber(c.minAge),nullableNumber(c.maxAge));}}
  const team=ranking.team?obj(ranking.team):{};
  if(team.enabled===true&&team.mode==='club'&&team.scoringMethod==='best_three_by_place'&&Number.isInteger(team.scoringCount)&&Number(team.scoringCount)>0)group('club',typeof team.label==='string'?team.label:'Club standings','club');else missing.push('Club ranking is not configured');
 } else missing.push('This route has no competitive standings');
 const distanceKm=nullableNumber(r.distanceKm);if(!distanceKm)missing.push('Distance is missing');
 return {id:uuid(r.id),name:text(r.name),distanceKm,minimumAge:nullableNumber(r.minimumAge),maximumAge:nullableNumber(r.maximumAge),genders:arr(r.genders??[]).map(text),groups,missing};});
 if(races.length>50)throw Error('invalid_reward_setup');return {...summary(v),catalogueHash:hash,races};
}
function resultPreview(raw:Record<string,unknown>,catalogue:RewardEventCatalogue,raceId:string):EventRewardResults {
 const race=catalogue.races.find(r=>r.id===raceId);if(!race)throw Error('reward_setup_not_found');const p=raw.publication===null?null:obj(raw.publication),rows:Record<string,unknown>[]=arr(raw.rows).map(obj).map(r=>({...r,gender:["female","f","F"].includes(String(r.gender))?"F":["male","m","M"].includes(String(r.gender))?"M":null}));
 const validRun=p&&p.runRaceId===raceId&&p.runStatus==='succeeded'&&p.completed===true;
 const ambiguous=rows.length>10000||rows.length!==raw.expectedCount||rows.some(r=>r.valid!==true)||new Set(rows.map(r=>r.athleteId)).size!==rows.length;
 const finishers=rows.filter(r=>r.participation==='finished'&&['official','corrected','provisional'].includes(String(r.status)));
 const badRanks=finishers.some(r=>!Number.isSafeInteger(r.rank)||Number(r.rank)<1||!Number.isSafeInteger(r.finishTimeMs)||Number(r.finishTimeMs)<=0);
 const groups=race.groups.map(g=>{let issue=!validRun?'awaiting_publication':ambiguous||badRanks?'ambiguous_results':null;
  const mins=[g.minimumAge,race.minimumAge].filter((n):n is number=>n!==null),maxs=[g.maximumAge,race.maximumAge].filter((n):n is number=>n!==null);const min=mins.length?Math.max(...mins):null,max=maxs.length?Math.min(...maxs):null;
  if(finishers.some(r=>(min!==null||max!==null)&&r.age===null||(g.gender!==null||race.genders.length>0&&!race.genders.includes('U'))&&!['M','F'].includes(String(r.gender))))issue='eligibility_review';
  const eligible=finishers.filter(r=>(!g.gender||r.gender===g.gender)&&(!race.genders.length||race.genders.includes(String(r.gender??'U')))&&(min===null||Number(r.age)>=min)&&(max===null||Number(r.age)<=max));
  let candidates=eligible.map(r=>({beneficiaryId:uuid(r.athleteId),name:text(r.name),order:Number(r.rank),evidenceIds:[uuid(r.id)],evidenceValue:Number(r.finishTimeMs)}));
  if(g.kind==='club'){
   const rawRace=arr(obj(raw.catalogue).races).map(obj).find(r=>r.id===raceId)!;const count=Number(obj(obj(rawRace.ranking).team).scoringCount);
   const clubs=new Map<string,typeof eligible>();for(const r of eligible){if(r.clubId===null)continue;const id=uuid(r.clubId);clubs.set(id,[...(clubs.get(id)??[]),r]);}
   const ranked=[...clubs].map(([id,members])=>{const scorers=members.sort((a,b)=>Number(a.rank)-Number(b.rank)).slice(0,count);return {id,name:text(scorers[0].clubName),score:scorers.reduce((n,r)=>n+Number(r.rank),0),last:Number(scorers.at(-1)!.rank),scorers};}).sort((a,b)=>a.score-b.score||a.last-b.last||a.id.localeCompare(b.id));
   candidates=ranked.map((c,i)=>({beneficiaryId:c.id,name:c.name,order:ranked.findIndex(x=>x.score===c.score&&x.last===c.last)+1,evidenceIds:c.scorers.map(r=>uuid(r.id)),evidenceValue:c.score}));
  }
  return {raceId,groupKey:g.key,issue,candidates:issue?[]:candidates};});
 return {catalogueHash:catalogue.catalogueHash,publicationId:p?uuid(p.id):null,publicationState:p?text(p.state):null,publishedAt:p?text(p.publishedAt):null,groups};
}
export async function rewardSetupEvents(identity:RewardAccountIdentity,editionId:string|null,raceId:string|null,rpc?:RewardLedgerRpc){
 if(!setupId(identity.userId)||!setupId(identity.sessionId)||editionId!==null&&!setupId(editionId)||raceId!==null&&(!editionId||!setupId(raceId)))throw Error('invalid_reward_setup');
 const {data,error}=await (rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))('service_reward_setup_events',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_edition_id:editionId,p_race_id:raceId});
 if(error){const code=(error as {message?:unknown}).message;throw new RewardLedgerStoreError(typeof code==='string'&&['reward_account_session_required','reward_setup_not_found','invalid_reward_setup'].includes(code)?code:'reward_ledger_unavailable');}
 if(!editionId){const list=arr(data);if(list.length>500)throw Error('reward_event_limit');return list.map(summary);}
 const raw=obj(data),catalogue=eventCatalogue(raw.catalogue);if(catalogue.id!==editionId)throw Error('invalid_reward_setup');
 return raceId?resultPreview(raw,catalogue,raceId):catalogue;
}
