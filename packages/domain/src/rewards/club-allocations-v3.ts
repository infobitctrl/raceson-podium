/** Private club-owner read projection. Revision is not sporting readiness;
 * stored consent is not renewed consent. Only a recorded receipt is confirmed. */
export type ClubAllocationV3={entitlementId:string;approvalId:string;draftId:string;slot:1|2|3|4|5|6;
  sourceKind:"synthetic_rehearsal"|"minimized_source"|"native_finale"|"final_league";amountWei:string;campaignAddress:string;recordedAt:string;
  allocationRevision:"latest"|"superseded";uploadId:string|null;claimAccess:"not_prepared"|"available"|"organizer_required";
  claim:null|{claimId:string;requestId:string;recipientAddress:string;recipientConsented:boolean;operatorApproved:boolean};
  payment:null|{state:"prepared"|"signed"|"queued"|"leased"|"broadcasting"|"submitted"|"confirmed";recipientAddress:string;
    transactionHash:string|null;confirmed:boolean;blockNumber:string|null;blockHash:string|null}};
export type ClubAllocationsPageV3={schema:"raceson-club-allocations-v3";chainId:31337|10143;clubId:string;items:ClubAllocationV3[];nextCursor:string|null};
function check(v:unknown):asserts v{if(!v)throw Error("invalid_reward_club_allocations_v3");}
function object(v:unknown,keys:string[]){
  check(v&&typeof v==="object"&&!Array.isArray(v)&&Object.getOwnPropertySymbols(v).length===0);
  const descriptors=Object.getOwnPropertyDescriptors(v);
  check(Object.keys(descriptors).sort().join("\0")===[...keys].sort().join("\0")&&keys.every(k=>"value" in descriptors[k]));
  return Object.fromEntries(keys.map(k=>[k,descriptors[k].value])) as Record<string,unknown>;
}
const hex=(v:unknown,n:number):v is string=>typeof v==="string"&&new RegExp(`^0x[0-9a-f]{${n}}$`).test(v)&&BigInt(v)>0n;
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const uint=(v:unknown):v is string=>typeof v==="string"&&/^[1-9][0-9]{0,77}$/.test(v)&&BigInt(v)<(1n<<256n);
export const clubAllocationCursorV3=(v:unknown):v is string=>typeof v==="string"&&/^0x[0-9a-f]{64}$/.test(v);
export function decodeClubAllocationsV3(raw:unknown,chainId:31337|10143,clubId:string,after:string|null=null):ClubAllocationsPageV3{
  const p=object(raw,["schema","chainId","clubId","items","nextCursor"]);
  check([31337,10143].includes(chainId)&&uuid(clubId)&&p.schema==="raceson-club-allocations-v3"&&p.chainId===chainId&&p.clubId===clubId
    &&(after===null||clubAllocationCursorV3(after))&&Array.isArray(p.items)&&p.items.length<=50);
  const list=p.items as unknown[],entries=Object.getOwnPropertyDescriptors(list);let previous=after;
  check(Object.getOwnPropertyNames(list).length===list.length+1&&Object.getOwnPropertySymbols(list).length===0);
  const items=Array.from({length:list.length},(_,n)=>{
    check(entries[String(n)]&&"value" in entries[String(n)]);
    const v=object(entries[String(n)].value,["entitlementId","approvalId","draftId","slot","sourceKind","amountWei","campaignAddress","recordedAt",
      "allocationRevision","uploadId","claimAccess","claim","payment"]);
    check(hex(v.entitlementId,64)&&(previous===null||v.entitlementId>previous)&&uuid(v.approvalId)&&uuid(v.draftId)
      &&Number.isInteger(v.slot)&&Number(v.slot)>=1&&Number(v.slot)<=6&&uint(v.amountWei)&&hex(v.campaignAddress,40)
      &&typeof v.recordedAt==="string"&&Number.isFinite(Date.parse(v.recordedAt))&&["latest","superseded"].includes(String(v.allocationRevision))
      &&(v.uploadId===null||uuid(v.uploadId))&&["not_prepared","available","organizer_required"].includes(String(v.claimAccess))
      &&(v.slot===5?v.sourceKind==="native_finale":v.slot===6?v.sourceKind==="final_league":["synthetic_rehearsal","minimized_source"].includes(String(v.sourceKind))));
    previous=v.entitlementId as string;
    let claim=null,payment=null;
    if(v.claim!==null){const c=object(v.claim,["claimId","requestId","recipientAddress","recipientConsented","operatorApproved"]);
      check(v.claimAccess==="available"&&v.uploadId!==null&&uuid(c.claimId)&&uuid(c.requestId)&&hex(c.recipientAddress,40)
        &&typeof c.recipientConsented==="boolean"&&typeof c.operatorApproved==="boolean"&&(!c.operatorApproved||c.recipientConsented));
      claim=c as ClubAllocationV3["claim"];
    }else check(v.claimAccess!=="available");
    if(v.payment!==null){const r=object(v.payment,["state","recipientAddress","transactionHash","confirmed","blockNumber","blockHash"]);
      check(v.uploadId!==null&&v.claimAccess!=="not_prepared"&&["prepared","signed","queued","leased","broadcasting","submitted","confirmed"].includes(String(r.state))
        &&hex(r.recipientAddress,40)&&typeof r.confirmed==="boolean"&&(r.state==="confirmed")===r.confirmed
        &&(r.state==="prepared"?r.transactionHash===null:hex(r.transactionHash,64))
        &&(r.confirmed?uint(r.blockNumber)&&hex(r.blockHash,64):r.blockNumber===null&&r.blockHash===null));
      payment=r as ClubAllocationV3["payment"];
    }
    check(v.claimAccess==="not_prepared"||v.uploadId!==null);
    return{...v,claim,payment} as ClubAllocationV3;
  });
  check(p.nextCursor===null||(items.length===50&&p.nextCursor===previous));
  return{schema:"raceson-club-allocations-v3",chainId,clubId,items,nextCursor:p.nextCursor as string|null};
}
