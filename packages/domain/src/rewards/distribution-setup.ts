import {decodeGuidedRewardSetup,guidedSetupReadiness,type GuidedRewardSetup} from "./guided-setup.js";
import {decodeSetupEvent,type RewardSetupEventContext} from "./setup-event.js";
import { allocateRewardWeights, parseRewardUnits } from "./arithmetic.js";

/** A setup is a private planning document, never an approved allocation. */
export type RewardSetupSource = {
  draftId: string; roundId: string | null; categoryId: string; catalogueHash: string;
};
export type RewardSetupRule = {
  basis: "race_position" | "club_points" | "league_position" | "participation" | "manual";
  sharesBps: number[];
  source: RewardSetupSource | null;
};
export type RewardSetupNode = {
  id: string; name: string; shareBps: number; locked: boolean;
  children: RewardSetupNode[]; rule: RewardSetupRule | null;
};
export type RewardSetupContext = { draftId:string; roundId:string|null; editionId:string|null; catalogueHash:string; programmeName:string; eventName:string };
export type RewardSetupPolicy = {
 multipleAwards: "allow"; ties: "split_occupied_places"; fewerFinishers: "raceson_main_treasury"|"selected_return";
 claimWindowDays: number; claimStartsAt: "claims_open"; securityPausesExtendWindow: true; expiredClaims: "fixed_treasury"; treasuryReturn: "original_sender"|"raceson_default";
};
export const defaultRewardSetupPolicy = ():RewardSetupPolicy => ({multipleAwards:"allow",ties:"split_occupied_places",fewerFinishers:"raceson_main_treasury",claimWindowDays:365,claimStartsAt:"claims_open",securityPausesExtendWindow:true,expiredClaims:"fixed_treasury",treasuryReturn:"raceson_default"});
export function decodeRewardSetupPolicy(value:unknown):RewardSetupPolicy {
 const p=object(value,["multipleAwards","ties","fewerFinishers","claimWindowDays","claimStartsAt","securityPausesExtendWindow","expiredClaims","treasuryReturn"]);
 check(p.multipleAwards==="allow"&&p.ties==="split_occupied_places"&&(p.fewerFinishers==="raceson_main_treasury"||p.fewerFinishers==="selected_return")&&p.claimStartsAt==="claims_open"&&p.securityPausesExtendWindow===true&&p.expiredClaims==="fixed_treasury"&&(p.treasuryReturn==="original_sender"||p.treasuryReturn==="raceson_default"));
 check(Number.isInteger(p.claimWindowDays)&&Number(p.claimWindowDays)>=1&&Number(p.claimWindowDays)<=3650);
 return {...defaultRewardSetupPolicy(),fewerFinishers:p.fewerFinishers as RewardSetupPolicy["fewerFinishers"],claimWindowDays:Number(p.claimWindowDays),treasuryReturn:p.treasuryReturn as RewardSetupPolicy["treasuryReturn"]};
}
/** Discovery intent only. Verified source context remains a separate creation gate. */
export type RewardSponsorSelection = {sourceLeagueId:string;sourceSeasonId:string;eventEditionId:string|null;raceId?:string};
export function decodeRewardSponsorSelection(value:unknown):RewardSponsorSelection {
 const hasRace=value!==null&&typeof value==="object"&&"raceId" in value;
 const s=object(value,["sourceLeagueId","sourceSeasonId","eventEditionId",...(hasRace?["raceId"]:[])]);
 check(setupId(s.sourceLeagueId)&&setupId(s.sourceSeasonId)&&(s.eventEditionId===null||setupId(s.eventEditionId)));
 if(hasRace)check(s.eventEditionId!==null&&setupId(s.raceId));
 return {sourceLeagueId:s.sourceLeagueId,sourceSeasonId:s.sourceSeasonId,eventEditionId:s.eventEditionId as string|null,...(hasRace?{raceId:s.raceId as string}:{})};
}
export type RewardDistributionSetup = { sponsorSelection?:RewardSponsorSelection; version: 1|2|3|4|5; guided?:GuidedRewardSetup; programmeKind?:"event"|"league"; event?:RewardSetupEventContext|null; policy?:RewardSetupPolicy; name: string; budgetMon: string; root: RewardSetupNode; context?:RewardSetupContext|null; stage?:"draft"|"ready" };
export type RewardSetupLifecycle = {state:"draft"|"saved"|"deposit"|"funded";canDelete:boolean;archived?:boolean};
export type SavedRewardSetup = { id: string; chainId: 31337 | 10143; revision: number; configuration: RewardDistributionSetup; updatedAt: string; lifecycle?:RewardSetupLifecycle };
export const SETUP_LIMITS = { nodes: 1000, depth: 8, children: 50, winners: 100 } as const;
export function setupId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v);
}
function check(value: unknown): asserts value { if (!value) throw new Error("invalid_reward_setup"); }
function object(value: unknown, keys: string[]) {
  check(value && typeof value === "object" && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  check(Object.keys(row).sort().join() === keys.sort().join()); return row;
}
function name(value: unknown): string {
  check(typeof value === "string" && value.trim().length > 0 && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value)); return value;
}
function share(value: unknown): number { check(Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10000); return Number(value); }
export function decodeRewardSetup(value: unknown): RewardDistributionSetup {
  const version = value && typeof value === "object" && "version" in value ? value.version : null;
  const hasSelection=version===5&&value!==null&&typeof value==="object"&&"sponsorSelection" in value;
  const row = object(value, version===5 ? ["version", "name", "budgetMon", "root", "context", "stage", "policy", "programmeKind", "event", "guided",...(hasSelection?["sponsorSelection"]:[])] : version===4 ? ["version", "name", "budgetMon", "root", "context", "stage", "policy", "programmeKind", "event"] : version===3 ? ["version", "name", "budgetMon", "root", "context", "stage", "policy"] : version===2 ? ["version", "name", "budgetMon", "root", "context", "stage"] : ["version", "name", "budgetMon", "root"]);
  check((row.version === 1 || row.version === 2 || row.version === 3 || row.version === 4 || row.version === 5) && typeof row.budgetMon === "string" && row.budgetMon.length <= 26 && /^(0|[1-9]\d*)(\.\d{1,18})?$/.test(row.budgetMon));
  const amount = parseRewardUnits(row.budgetMon, 18); check(amount > 0n && amount <= 1000000n * 10n ** 18n);
  const ids = new Set<string>();
  function node(value: unknown, depth: number): RewardSetupNode {
    check(depth <= SETUP_LIMITS.depth && ids.size < SETUP_LIMITS.nodes);
    const n = object(value, ["id", "name", "shareBps", "locked", "children", "rule"]);
    check(setupId(n.id) && !ids.has(n.id)); ids.add(n.id);
    check(typeof n.locked === "boolean" && Array.isArray(n.children) && n.children.length <= SETUP_LIMITS.children);
    let rule: RewardSetupRule | null = null;
    if (n.rule !== null) {
      check(depth > 0 && n.children.length === 0);
      const r = object(n.rule, ["basis", "sharesBps", "source"]);
      check(["race_position", "club_points", "league_position", "participation", "manual"].includes(String(r.basis)));
      check(Array.isArray(r.sharesBps) && (r.sharesBps.length >= 1 || version===5 && r.basis==="participation") && r.sharesBps.length <= SETUP_LIMITS.winners);
      let source: RewardSetupSource | null = null;
      if (r.source !== null) {
        const s = object(r.source, ["draftId", "roundId", "categoryId", "catalogueHash"]);
        check(setupId(s.draftId) && (s.roundId === null || setupId(s.roundId)) && setupId(s.categoryId));
        check(typeof s.catalogueHash === "string" && /^[0-9a-f]{64}$/.test(s.catalogueHash));
        source = { draftId: s.draftId, roundId: s.roundId as string | null, categoryId: s.categoryId, catalogueHash: s.catalogueHash };
      }
      rule = { basis: r.basis as RewardSetupRule["basis"], sharesBps: r.sharesBps.map(share), source };
    }
    return { id: n.id, name: name(n.name), shareBps: share(n.shareBps), locked: n.locked, children: n.children.map(c => node(c, depth + 1)), rule };
  }
  const root = node(row.root, 0); check(root.shareBps === 10000 && !root.locked);
  const base:RewardDistributionSetup = { version: 1, name: name(row.name), budgetMon: row.budgetMon, root };
  if(row.version===1)return base;
  check(row.stage==="draft"||row.stage==="ready");
  let context:RewardSetupContext|null=null;
  if(row.context!==null){const c=object(row.context,["draftId","roundId","editionId","catalogueHash","programmeName","eventName"]);
    check(setupId(c.draftId)&&((c.roundId===null&&c.editionId===null)||(setupId(c.roundId)&&setupId(c.editionId)))&&typeof c.catalogueHash==="string"&&/^[0-9a-f]{64}$/.test(c.catalogueHash));
    context={draftId:c.draftId,roundId:c.roundId as string|null,editionId:c.editionId as string|null,catalogueHash:c.catalogueHash,programmeName:name(c.programmeName),eventName:name(c.eventName)};
  }
  const result:RewardDistributionSetup={...base,version:row.version,context,stage:row.stage,...(row.version===3||row.version===4||row.version===5?{policy:decodeRewardSetupPolicy(row.policy)}:{})};
  if(row.version===4||row.version===5){check(row.programmeKind==="event"||row.programmeKind==="league");result.programmeKind=row.programmeKind;result.event=decodeSetupEvent(row.event);check(row.programmeKind==="event"?context===null:result.event===null);}
  if(row.version===5){check(row.programmeKind==="league");result.guided=decodeGuidedRewardSetup(row.guided,root,context);if(hasSelection)result.sponsorSelection=decodeRewardSponsorSelection(row.sponsorSelection);}
  if(result.stage==="ready")check(setupReadiness(result).length===0);
  return result;
}
export function decodeSavedRewardSetup(value: unknown, chainId?: number, id?: string): SavedRewardSetup {
  const hasLifecycle=Boolean(value&&typeof value==="object"&&"lifecycle" in value);
  const r = object(value, ["id", "chainId", "revision", "configuration", "updatedAt",...(hasLifecycle?["lifecycle"]:[])]);
  check(setupId(r.id) && (!id || r.id === id) && (r.chainId === 31337 || r.chainId === 10143) && (!chainId || r.chainId === chainId));
  check(Number.isInteger(r.revision) && Number(r.revision) >= 1 && Number(r.revision) <= 2147483645);
  check(typeof r.updatedAt === "string" && Number.isFinite(Date.parse(r.updatedAt)) && new Date(r.updatedAt).toISOString() === r.updatedAt);
  let lifecycle:RewardSetupLifecycle|undefined;
  if(hasLifecycle){const hasArchive=Boolean(r.lifecycle&&typeof r.lifecycle==="object"&&"archived" in r.lifecycle);
    const l=object(r.lifecycle,["state","canDelete",...(hasArchive?["archived"]:[])]);
    check(["draft","saved","deposit","funded"].includes(String(l.state))&&typeof l.canDelete==="boolean"&&(!l.canDelete||l.state==="draft"||l.state==="saved"));
    check(!hasArchive||typeof l.archived==="boolean");
    lifecycle={state:l.state as RewardSetupLifecycle["state"],canDelete:l.canDelete,...(hasArchive?{archived:l.archived as boolean}:{})};}
  const configuration=decodeRewardSetup(r.configuration);
  return { id: r.id, chainId: r.chainId, revision: Number(r.revision), configuration, updatedAt: r.updatedAt,...(lifecycle?{lifecycle}:{}) };
}
export function setupNodes(root: RewardSetupNode): RewardSetupNode[] { return [root, ...root.children.flatMap(setupNodes)]; }
export function setupPath(root: RewardSetupNode, id: string): RewardSetupNode[] {
  if (root.id === id) return [root];
  for (const child of root.children) { const path = setupPath(child, id); if (path.length) return [root, ...path]; }
  return [];
}
export function updateSetupNode(root: RewardSetupNode, id: string, update: (n: RewardSetupNode) => RewardSetupNode): RewardSetupNode {
  return root.id === id ? update(root) : { ...root, children: root.children.map(child => updateSetupNode(child, id, update)) };
}
export function presetSetupShares(count: number, curve: "equal" | "descending" = "equal"): number[] {
  check(Number.isInteger(count) && count >= 1 && count <= SETUP_LIMITS.winners);
  const rows = allocateRewardWeights(10000n, Array.from({ length: count }, (_, i) => ({ key: String(i).padStart(3, "0"), weight: BigInt(curve === "equal" ? 1 : count - i) }))).allocations;
  return rows.map(r => Number(r.amount));
}
/** Only explicitly requested balancing adjusts siblings. Locked shares stay fixed. */
export function balanceSetupChildren(children: RewardSetupNode[], mode: "equal" | "proportional"): RewardSetupNode[] {
  const fixed = children.filter(c => c.locked).reduce((sum, c) => sum + c.shareBps, 0);
  check(fixed <= 10000);
  const free = children.filter(c => !c.locked); check(free.length > 0 || fixed === 10000);
  const weighted = mode === "proportional" && free.some(c => c.shareBps > 0);
  const amounts = new Map(allocateRewardWeights(BigInt(10000 - fixed), free.map(c => ({ key: c.id, weight: BigInt(weighted ? c.shareBps : 1) }))).allocations.map(r => [r.key, Number(r.amount)]));
  return children.map(c => c.locked ? c : { ...c, shareBps: amounts.get(c.id)! });
}
export type SetupPreviewRow = { id: string; amountWei: bigint | null; retainedWei: bigint | null; slots: bigint[]; totalShareBps: number; pathShare: number; issue: "overallocated" | "unallocated" | "empty" | null };
/** Integer arithmetic; incomplete splits retain funds instead of renormalizing. */
export function previewRewardSetup(value: unknown) {
  const setup = decodeRewardSetup(value), budgetWei = parseRewardUnits(setup.budgetMon, 18);
  const rows: SetupPreviewRow[] = [];
  function visit(node: RewardSetupNode, amount: bigint | null, pathShare: number) {
    const proportional = setup.version===5 && setup.guided?.groups.some(g=>g.nodeId===node.id&&g.method==="proportional");
    if(proportional){rows.push({id:node.id,amountWei:amount,retainedWei:amount===null?null:0n,slots:[],totalShareBps:10000,pathShare,issue:null});return;}
    const shares = node.rule ? node.rule.sharesBps : node.children.map(c => c.shareBps);
    const totalShareBps = shares.reduce((a, b) => a + b, 0);
    const issue = !shares.length ? "empty" : totalShareBps > 10000 ? "overallocated" : totalShareBps < 10000 ? "unallocated" : null;
    let retainedWei: bigint | null = null, amounts: bigint[] = [];
    if (amount !== null && totalShareBps <= 10000) {
      const split = allocateRewardWeights(amount, [...shares.map((s, i) => ({ key: `a${String(i).padStart(3, "0")}`, weight: BigInt(s) })), { key: "retained", weight: BigInt(10000 - totalShareBps) }]).allocations;
      retainedWei = split.find(s => s.key === "retained")!.amount;
      amounts = shares.map((_, i) => split.find(s => s.key === `a${String(i).padStart(3, "0")}`)!.amount);
    }
    rows.push({ id: node.id, amountWei: amount, retainedWei, slots: node.rule ? amounts : [], totalShareBps, pathShare, issue });
    node.children.forEach((child, i) => visit(child, amounts[i] ?? null, pathShare * child.shareBps / 10000));
  }
  visit(setup.root, budgetWei, 1);
  return { budgetWei, rows, retainedWei: rows.some(r => r.retainedWei === null) ? null : rows.reduce((n, r) => n + r.retainedWei!, 0n), complete: rows.every(r => !r.issue) };
}
export function createRewardSetup(id: string, hr = false): RewardDistributionSetup {
  return { version: 1, name: hr ? "Moj program nagrada" : "My reward programme", budgetMon: "100000", root: { id, name: hr ? "Glavni fond" : "Main pot", shareBps: 10000, locked: false, children: [], rule: null } };
}

/** Readiness concerns configuration only; it never approves sporting results or payouts. */
export function setupReadiness(setup:RewardDistributionSetup):Array<"event"|"distribution"|"sources">{
 if(setup.version===5)return guidedSetupReadiness(setup);
 const issues:Array<"event"|"distribution"|"sources">=[],nodes=setupNodes(setup.root),context=setup.context;
 const direct=setup.version===4&&setup.programmeKind==="event";
 if(direct?!setup.event:!context)issues.push("event");
 if(nodes.some(n=>{const shares=n.rule?n.rule.sharesBps:n.children.map(c=>c.shareBps);return !shares.length||shares.reduce((a,b)=>a+b,0)!==10000;}))issues.push("distribution");
 if(direct){if(!nodes.some(n=>n.rule)||nodes.filter(n=>n.rule).some(n=>!setup.event?.choices.some(c=>c.nodeId===n.id&&c.approved&&n.rule!.basis===(c.groupKey==="club"?"club_points":"race_position"))||!["race_position","club_points"].includes(n.rule!.basis)))issues.push("sources");}
 else if(!nodes.some(n=>n.rule)||nodes.filter(n=>n.rule).some(n=>{const source=n.rule!.source;return !source||!context||source.draftId!==context.draftId||source.catalogueHash!==context.catalogueHash||(context.roundId!==null&&source.roundId!==context.roundId);}))issues.push("sources");
 return issues;
}
export function finishRewardSetup(value:RewardDistributionSetup):RewardDistributionSetup{
 const setup=decodeRewardSetup(value);check(setupReadiness(setup).length===0);
 return decodeRewardSetup({...setup,version:setup.version===5?5:setup.version===4?4:3,policy:setup.policy??defaultRewardSetupPolicy(),context:setup.context??null,stage:"ready"});
}
