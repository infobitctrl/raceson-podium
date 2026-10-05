import type {SponsorLaunch} from "@raceson/domain/rewards/sponsor-launch";
import {sponsorTxHash} from "@raceson/domain/rewards/sponsor-execution";
import type {SponsorExecutionView} from "../data/sponsorExecutionCodec";

export type SponsorPendingReceipt={action:"deployment"|"funding";hash:string};
export function sponsorReceiptKey(launch:SponsorLaunch){
 return `raceson:sponsor-receipt:v1:${launch.setup.chainId}:${launch.setup.id}:${launch.id}`;
}
const legacyKey=(launch:SponsorLaunch)=>`raceson:sponsor-tx:${launch.setup.chainId}:${launch.setup.id}`;
function decode(raw:string|null):SponsorPendingReceipt|null{
 try{
  const value:unknown=JSON.parse(raw??"null");
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const p=value as Record<string,unknown>;
  return Object.keys(p).sort().join() === "action,hash" && (p.action==="deployment"||p.action==="funding")&&sponsorTxHash(p.hash)?{action:p.action,hash:p.hash as string}:null;
 }catch{return null;}
}
export function readSponsorReceipt(launch:SponsorLaunch):SponsorPendingReceipt|null{
 const key=sponsorReceiptKey(launch);
 try{const p=decode(localStorage.getItem(key));if(p)return p;}catch{/* Session fallback. */}
 try{return decode(sessionStorage.getItem(key))??decode(sessionStorage.getItem(legacyKey(launch)));}catch{return null;}
}
/** Public receipt recovery only; no wallet, account credentials or authority. */
export function saveSponsorReceipt(launch:SponsorLaunch,p:SponsorPendingReceipt):boolean{
 const key=sponsorReceiptKey(launch),value=JSON.stringify(p);let durable=false;
 try{localStorage.setItem(key,value);durable=true;}catch{/* Keep a tab fallback. */}
 try{sessionStorage.setItem(key,value);}catch{/* Caller retains it in memory. */}
 return durable;
}
export function clearSponsorReceipt(launch:SponsorLaunch,p:SponsorPendingReceipt){
 const remove=(storage:Storage,key:string)=>{const stored=decode(storage.getItem(key));if(stored?.hash===p.hash&&stored.action===p.action)storage.removeItem(key);};
 try{remove(localStorage,sponsorReceiptKey(launch));}catch{/* Optional browser storage. */}
 try{remove(sessionStorage,sponsorReceiptKey(launch));remove(sessionStorage,legacyKey(launch));}catch{/* Optional browser storage. */}
}
export function sponsorReceiptConfirmed(view:SponsorExecutionView,p:SponsorPendingReceipt):boolean{
 if(!view.record||!view.observation)return false;
 return p.action==="deployment"?view.record.deploymentHash===p.hash&&view.observation.deploymentHash===p.hash:
  view.record.fundingHash===p.hash&&view.observation.fundingHash===p.hash&&view.observation.funded;
}
