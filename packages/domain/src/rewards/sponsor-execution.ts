import {sponsorLaunchPlan, type SponsorLaunch} from "./sponsor-launch.js";
import {setupId} from "./distribution-setup.js";

export type SponsorExecutionPolicy = {operator: string; treasury: string; reviewPeriods: number[]};
export type SponsorExecutionPlan = {
  version: 4; launchId: string; setupRevision: number; configurationHash: string; chainId: 10143 | 31337;
  funder: string; operator: string; unallocatedTreasury: string; expiredTreasury: string;
  claimLifetime: number; reviewPeriods: number[]; caps: string[]; budgetWei: string;
};
export type SponsorExecutionRecord = {plan: SponsorExecutionPlan; deploymentHash: string | null; fundingHash: string | null};
export const sponsorAddress = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/i.test(v);
export const sponsorTxHash = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0{64}$/.test(v);
function requireValue(v: unknown): asserts v {if (!v) throw Error("invalid_sponsor_execution");}
function exact(v: unknown, keys: string[]): Record<string, unknown> {
  requireValue(v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === keys.sort().join());
  return v as Record<string, unknown>;
}
export function decodeSponsorExecutionPolicy(v: unknown): SponsorExecutionPolicy {
  const p = exact(v, ["operator", "treasury", "reviewPeriods"]);
  requireValue(sponsorAddress(p.operator) && sponsorAddress(p.treasury) && Array.isArray(p.reviewPeriods)
    && p.reviewPeriods.length === 6 && p.reviewPeriods.every(n => Number.isInteger(n) && n >= 0 && n <= 2592000));
  return {operator: (p.operator as string).toLowerCase(), treasury: (p.treasury as string).toLowerCase(), reviewPeriods: [...p.reviewPeriods as number[]]};
}
export function createSponsorExecutionPlan(launch: SponsorLaunch, funder: string, policy: SponsorExecutionPolicy): SponsorExecutionPlan {
  const p = decodeSponsorExecutionPolicy(policy), c = launch.setup.configuration, preview = sponsorLaunchPlan(launch.setup);
  requireValue(sponsorAddress(funder) && funder.toLowerCase() !== p.operator && preview.complete && c.policy && c.guided?.pots.length === 6);
  const caps = Array.from({length: 6}, (_, slot) => {
    const pots = c.guided!.pots.filter(pot => pot.slot === slot);
    requireValue(pots.length === 1);
    const amount = preview.pots.find(pot => pot.id === pots[0]!.nodeId)?.amountWei;
    requireValue(amount != null);
    return amount;
  });
  return decodeSponsorExecutionPlan({version: 4, launchId: launch.id, setupRevision: launch.setup.revision, configurationHash: launch.configurationHash,
    chainId: launch.setup.chainId, funder: funder.toLowerCase(), operator: p.operator,
    unallocatedTreasury: c.policy!.fewerFinishers === "selected_return" && c.policy!.treasuryReturn === "original_sender" ? funder.toLowerCase() : p.treasury, expiredTreasury: c.policy!.treasuryReturn === "original_sender" ? funder.toLowerCase() : p.treasury,
    claimLifetime: c.policy!.claimWindowDays * 86400, reviewPeriods: p.reviewPeriods, caps, budgetWei: preview.budgetWei});
}
export function decodeSponsorExecutionPlan(v: unknown): SponsorExecutionPlan {
  const p = exact(v, ["version", "launchId", "setupRevision", "configurationHash", "chainId", "funder", "operator", "unallocatedTreasury", "expiredTreasury", "claimLifetime", "reviewPeriods", "caps", "budgetWei"]);
  const wei = (n: unknown): n is string => typeof n === "string" && /^(0|[1-9][0-9]{0,24})$/.test(n);
  requireValue(p.version === 4 && setupId(p.launchId) && Number.isInteger(p.setupRevision) && (p.setupRevision as number) > 0 && typeof p.configurationHash === "string" && /^[0-9a-f]{64}$/.test(p.configurationHash)
    && [10143, 31337].includes(p.chainId as number) && [p.funder, p.operator, p.unallocatedTreasury, p.expiredTreasury].every(sponsorAddress)
    && p.funder !== p.operator && [p.funder, p.operator, p.unallocatedTreasury, p.expiredTreasury].every(a => a === (a as string).toLowerCase())
    && Number.isInteger(p.claimLifetime) && (p.claimLifetime as number) >= 86400 && (p.claimLifetime as number) <= 3650 * 86400
    && (p.claimLifetime as number) % 86400 === 0 && Array.isArray(p.reviewPeriods) && p.reviewPeriods.length === 6
    && p.reviewPeriods.every(n => Number.isInteger(n) && n >= 0 && n <= 2592000)
    && wei(p.budgetWei) && BigInt(p.budgetWei) > 0n && Array.isArray(p.caps) && p.caps.length === 6 && p.caps.every(wei)
    && p.caps.reduce((sum, n) => sum + BigInt(n), 0n) === BigInt(p.budgetWei));
  const c = p as SponsorExecutionPlan;
  return {version: 4, launchId: c.launchId, setupRevision: c.setupRevision, configurationHash: c.configurationHash,
    chainId: c.chainId, funder: c.funder, operator: c.operator, unallocatedTreasury: c.unallocatedTreasury,
    expiredTreasury: c.expiredTreasury, claimLifetime: c.claimLifetime, reviewPeriods: [...c.reviewPeriods], caps: [...c.caps], budgetWei: c.budgetWei};
}
export function decodeSponsorExecutionRecord(v: unknown): SponsorExecutionRecord | null {
  if (v === null) return null;
  const p = exact(v, ["plan", "deploymentHash", "fundingHash"]);
  const plan = decodeSponsorExecutionPlan(p.plan);
  requireValue((p.deploymentHash === null || sponsorTxHash(p.deploymentHash)) && (p.fundingHash === null || sponsorTxHash(p.fundingHash))
    && (p.fundingHash === null || p.deploymentHash !== null));
  return {plan, deploymentHash: p.deploymentHash as string | null, fundingHash: p.fundingHash as string | null};
}
