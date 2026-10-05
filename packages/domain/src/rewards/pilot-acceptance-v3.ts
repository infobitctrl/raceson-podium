/** Browser-safe contract for the fixed, isolated 100-MON acceptance pilot. */
export const pilotDraftIdV3 = "9a000000-0000-4000-8000-000000000052";
export const pilotActionsV3 = ["review_results", "approve_allocation", "publish_results", "complete_funding", "upload_awards",
  "stage_allocation", "activate", "prepare_claim", "approve_claim", "pay", "reconcile"] as const;
export type PilotActionV3 = typeof pilotActionsV3[number];
export type PilotRoundV3 = 2 | 3 | 4;
export type PilotChangeV3 = { action: PilotActionV3; viewHash: string };
export type PilotViewV3 = {
  schema: "raceson-pilot-acceptance-v3"; chainId: 10143; draftId: typeof pilotDraftIdV3; round: PilotRoundV3;
  viewHash: string; campaignAddress: string; budgetWei: string; allocatedWei: string | null; unallocatedWei: string | null;
  awardCount: number; athleteAmountWei: string | null; recipientAddress: string; reviewSeconds: 0;
  nextAction: PilotActionV3 | null; held: boolean; waitingForConsent: boolean; expired: boolean;
  steps: Array<{ action: string; state: string; transactionHash: string | null }>;
  recipientConsented: boolean; operatorApproved: boolean; paid: boolean; claimExpiresAt: string | null;
  paymentTransactionHash: string | null; claimId: string | null; maximumActionGasWei: string;
};
function check(value: unknown): asserts value { if (!value) throw Error("invalid_reward_pilot_view"); }
function object(value: unknown, keys: readonly string[]) {
  check(value && typeof value === "object" && !Array.isArray(value)); const r=value as Record<string,unknown>;
  check(Object.keys(r).sort().join() === [...keys].sort().join()); return r;
}
export function decodePilotChangeV3(value: unknown): PilotChangeV3 {
  const r=object(value,["action","viewHash"]);
  check(pilotActionsV3.includes(r.action as PilotActionV3) && typeof r.viewHash === "string" && /^[0-9a-f]{64}$/.test(r.viewHash));
  return {action:r.action as PilotActionV3,viewHash:r.viewHash};
}
export function decodePilotViewV3(value: unknown, round: PilotRoundV3): PilotViewV3 {
  const r=object(value,["schema","chainId","draftId","round","viewHash","campaignAddress","budgetWei","allocatedWei","unallocatedWei",
    "awardCount","athleteAmountWei","recipientAddress","reviewSeconds","nextAction","held","waitingForConsent","expired","steps",
    "recipientConsented","operatorApproved","paid","claimExpiresAt","paymentTransactionHash","claimId","maximumActionGasWei"]);
  check(r.schema==="raceson-pilot-acceptance-v3" && r.chainId===10143 && r.draftId===pilotDraftIdV3 && r.round===round && [2,3,4].includes(round));
  check(typeof r.viewHash==="string" && /^[0-9a-f]{64}$/.test(r.viewHash));
  for(const key of ["campaignAddress","recipientAddress"])check(typeof r[key]==="string" && /^0x[0-9a-f]{40}$/.test(r[key] as string));
  for(const key of ["budgetWei","maximumActionGasWei"])check(typeof r[key]==="string" && /^(0|[1-9][0-9]{0,77})$/.test(r[key] as string));
  for(const key of ["allocatedWei","unallocatedWei","athleteAmountWei","claimExpiresAt"])check(r[key]===null || typeof r[key]==="string" && /^(0|[1-9][0-9]{0,77})$/.test(r[key] as string));
  for(const key of ["held","waitingForConsent","expired","recipientConsented","operatorApproved","paid"])check(typeof r[key]==="boolean");
  check(r.budgetWei==="10000000000000000000" && r.reviewSeconds===0 && Number.isInteger(r.awardCount) && Number(r.awardCount)>=0 && Number(r.awardCount)<=64);
  check(r.nextAction===null || pilotActionsV3.includes(r.nextAction as PilotActionV3));
  check(r.claimId===null || typeof r.claimId==="string" && /^[0-9a-f-]{36}$/.test(r.claimId));
  const tx=(v:unknown)=>v===null || typeof v==="string" && /^0x[0-9a-f]{64}$/.test(v);
  check(tx(r.paymentTransactionHash) && Array.isArray(r.steps) && r.steps.length<=4);
  const steps=r.steps.map(item=>{const s=object(item,["action","state","transactionHash"]);
    check(["complete_funding","upload_awards","stage_allocation","activate"].includes(String(s.action)) &&
      ["reserved","signed","queued","leased","broadcasting","submitted","confirmed"].includes(String(s.state)) && tx(s.transactionHash));return s;});
  if(r.allocatedWei!==null && r.unallocatedWei!==null)check(BigInt(r.allocatedWei as string)+BigInt(r.unallocatedWei as string)===BigInt(r.budgetWei));
  if(r.paid)check(r.recipientConsented && r.operatorApproved && r.paymentTransactionHash && r.nextAction===null);
  check(new Set(steps.map(s=>s.action)).size===steps.length);
  return {...r,steps} as unknown as PilotViewV3;
}
