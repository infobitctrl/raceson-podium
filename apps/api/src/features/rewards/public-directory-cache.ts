import {createHash} from 'node:crypto';
import {getCache,type RuntimeCache} from '@vercel/functions';
import {decodePublicDirectory,directoryPublicationIdentity,mergePublicDirectory,type DirectoryCampaign,type PublicDirectory} from '@raceson/domain/rewards/public-directory';

export type PublicDirectoryCache=Pick<RuntimeCache,'get'|'set'>;
const retentionSeconds=86_400;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const key=(item:DirectoryCampaign)=>digest(directoryPublicationIdentity(item));

/** Public display data only. Project/environment scoping also isolates Hobby
 * teams, whose underlying Runtime Cache can be shared between projects. */
export function hostedPublicDirectoryCache(env:NodeJS.ProcessEnv):PublicDirectoryCache|undefined {
 if(env.VERCEL!=='1'||!env.VERCEL_PROJECT_ID||!env.VERCEL_ENV)return undefined;
 return getCache({namespace:`podium-public-directory-v1:${env.VERCEL_PROJECT_ID}:${env.VERCEL_ENV}`,keyHashFunction:digest});
}

async function bounded<T>(operation:()=>Promise<T>):Promise<T|undefined> {
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([Promise.resolve().then(operation),new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),1000);})]);}
 catch{return undefined;}
 finally{clearTimeout(timer);}
}

export async function readDirectorySummaries(published:PublicDirectory,cache?:PublicDirectoryCache):Promise<PublicDirectory> {
 if(!cache)return published;
 const items=await Promise.all(published.items.map(async item=>{
  const value=await bounded(()=>cache.get(key(item)));
  try{
   // One strict public envelope per campaign: no private execution records,
   // recipients, consent, credentials or signing material can pass this decoder.
   const stored=decodePublicDirectory(value);
   if(stored.items.length!==1)return item;
   return mergePublicDirectory({...published,items:[item]},stored).items[0]!;
  }catch{return item;}
 }));
 return mergePublicDirectory(published,{...published,items});
}

export async function saveDirectorySummary(item:DirectoryCampaign,cache?:PublicDirectoryCache):Promise<void> {
 if(!cache||!item.verified)return;
 const value=decodePublicDirectory({chainId:item.campaign.chainId,items:[item],sponsors:0,
  checkedAt:new Date(Number(item.campaign.blockTimestamp)*1000).toISOString(),refreshStatus:'published'});
 // Keep each campaign independent: one slow verifier cannot overwrite another
 // campaign's completed result. A cache failure never invalidates chain facts.
 await bounded(async()=>{
  const existing=await readDirectorySummaries(value,cache);
  await cache.set(key(item),existing,{ttl:retentionSeconds,name:'Verified public campaign summary'});
 });
}
