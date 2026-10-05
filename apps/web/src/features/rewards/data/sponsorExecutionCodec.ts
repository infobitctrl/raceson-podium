import {decodeSponsorExecutionRecord, sponsorAddress, sponsorTxHash, type SponsorExecutionRecord} from "@raceson/domain/rewards/sponsor-execution";
import type {SponsorChainObservation} from "@raceson/rewards-chain/sponsor-v4";
export type SponsorCreationState={status:"unavailable"|"ready"|"processing"|"submitted"|"confirmed"|"failed";hash:string|null;reason:"configuration"|"capacity"|"gas"|"balance"|"connection"|"reverted"|"controller_busy"|null};
export type SponsorExecutionView = {enabled: boolean; record: SponsorExecutionRecord | null; observation: SponsorChainObservation | null;creation?:SponsorCreationState};
export function decodeSponsorExecutionView(value: unknown, chainId: number): SponsorExecutionView {
  const fail = (): never => {throw Error("invalid_sponsor_execution");};
  if (!value || typeof value !== "object" || Array.isArray(value) || !["enabled,observation,record","creation,enabled,observation,record"].includes(Object.keys(value).sort().join())) return fail();
  const v = value as SponsorExecutionView;
  if (typeof v.enabled !== "boolean") return fail();
  if(v.creation!==undefined){const c=v.creation;
    if(!c||Object.keys(c).sort().join()!=="hash,reason,status"||!["unavailable","ready","processing","submitted","confirmed","failed"].includes(c.status)
      ||c.hash!==null&&!sponsorTxHash(c.hash)||![null,"configuration","capacity","gas","balance","connection","reverted","controller_busy"].includes(c.reason))return fail();
  }
  const record = decodeSponsorExecutionRecord(v.record), o = v.observation;
  if (record && record.plan.chainId !== chainId) return fail();
  if (o !== null) {
    if (!record || !o || typeof o !== "object" || Object.keys(o).sort().join() !== "address,blockHash,blockNumber,blockTimestamp,cancelled,deploymentHash,funded,fundingHash,pots"
      || !sponsorAddress(o.address) || !sponsorTxHash(o.deploymentHash) || o.deploymentHash !== record.deploymentHash
      || typeof o.funded !== "boolean" || typeof o.cancelled !== "boolean" || o.funded && o.cancelled
      || !sponsorTxHash(o.blockHash) || !/^(0|[1-9][0-9]*)$/.test(o.blockNumber) || !/^[1-9][0-9]{0,11}$/.test(o.blockTimestamp) || o.fundingHash !== record.fundingHash
      || o.fundingHash !== null && (!sponsorTxHash(o.fundingHash) || !o.funded)
      || !Array.isArray(o.pots) || o.pots.length !== record.plan.caps.filter(c => BigInt(c) > 0n).length) return fail();
    const seen = new Set<number>();
    for (const pot of o.pots) {
      if (!pot || Object.keys(pot).sort().join() !== "address,allocatedWei,amountWei,claimDeadline,entitlementCount,paidWei,paused,remainingWei,returnedWei,slot,state" || !Number.isInteger(pot.slot) || pot.slot < 0 || pot.slot > 5
        || seen.has(pot.slot) || !sponsorAddress(pot.address) || pot.amountWei !== record.plan.caps[pot.slot] || BigInt(pot.amountWei) <= 0n) return fail();
      const uint = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v);
      if (!Number.isInteger(pot.state) || pot.state < 0 || pot.state > 5 || typeof pot.paused !== "boolean"
        || ![pot.allocatedWei, pot.paidWei, pot.returnedWei, pot.remainingWei, pot.claimDeadline, pot.entitlementCount].every(uint)) return fail();
      const deposited = o.funded ? BigInt(pot.amountWei) : 0n;
      if (BigInt(pot.allocatedWei) > deposited || BigInt(pot.paidWei) > BigInt(pot.allocatedWei)
        || BigInt(pot.paidWei) + BigInt(pot.returnedWei) + BigInt(pot.remainingWei) !== deposited
        || (o.funded ? pot.state < 1 : pot.state !== 0) || [3, 4].includes(pot.state) && BigInt(pot.claimDeadline) === 0n) return fail();
      seen.add(pot.slot);
    }
  }
  return {enabled: v.enabled, record, observation: o,...(v.creation?{creation:v.creation}:{})};
}
