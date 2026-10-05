import {setupId} from '@raceson/domain/rewards/distribution-setup';

export const rewardsControlLink = (id:string,slot:number) => `/rewards/control?campaign=${encodeURIComponent(id)}&pot=${slot}`;
export const resultsHandoffLink = (id:string,slot:number,hostedCopy=false) => hostedCopy
 ? `/rewards/review?campaign=${encodeURIComponent(id)}&pot=${slot}`
 : `/rewards/manage/campaigns/${encodeURIComponent(id)}?pot=${slot}`;
/** Navigation hints only; controller authorization still comes from the server. */
export function controllerSelection(search:string) {
 const query=new URLSearchParams(search),id=query.get('campaign'),pot=query.get('pot');
 return {campaign:query.getAll('campaign').length===1&&setupId(id)?id:null,
  slot:query.getAll('pot').length===1&&pot!==null&&/^[0-5]$/.test(pot)?Number(pot):null};
}
