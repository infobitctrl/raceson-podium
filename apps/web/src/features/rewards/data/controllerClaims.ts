import {sponsorClubClaimSchema} from './sponsorClubClaims';
import {z} from 'zod';
import {decodeHostedClaimQueue} from './hostedClaimReviews';
import {sponsorClaimSchema} from './sponsorProgramme';
import type {ControllerRequest} from './controller';
const uuid=z.string().uuid();
export async function getControllerClaims(request:ControllerRequest,approvalId:string,after:string|null=null,club=false){
 uuid.parse(approvalId);if(after!==null)uuid.parse(after);
 return decodeHostedClaimQueue(await request(`/${club?'club-claims':'claims'}?approvalId=${approvalId}${after?`&after=${after}`:''}`),approvalId,after);
}
export async function requestControllerClaim(request:ControllerRequest,wallet:string,id:string,approvalId:string,body?:unknown,club=false){
 uuid.parse(id);uuid.parse(approvalId);
 const v=(club?sponsorClubClaimSchema:sponsorClaimSchema).parse(await request(`/${club?'club-claims':'claims'}/${id}`,body));
 if(club&&('candidate'in v)&&v.address!==v.candidate.safeAddress)throw Error('invalid_claim');
 if(v.claimId!==id||v.approvalId!==approvalId||v.role!=='operator'||v.chainId!==10143||v.operatorAddress!==wallet
  ||v.claim&&v.claim.recipient!==v.address||v.transaction&&(v.transaction.from!==wallet||v.transaction.chainId!==10143||v.transaction.value!=='0'||v.transaction.to!==v.context?.verifyingContract))throw Error('invalid_claim');
 return v;
}
