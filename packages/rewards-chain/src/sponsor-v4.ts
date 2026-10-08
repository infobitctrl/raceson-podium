import {decodeSponsorExecutionPlan, type SponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";
import {TransactionNotFoundError, TransactionReceiptNotFoundError, decodeEventLog, encodeAbiParameters, encodeDeployData, encodeFunctionData, getContractAddress, getCreate2Address, hashDomain, keccak256, padHex, parseAbi, parseAbiParameters, stringToHex, toHex, type Address, type Hex, type PublicClient} from "viem";
import {sponsorProgrammeBuild, sponsorCampaignBuild} from "./sponsor-v4-build.js";
export {sponsorProgrammeBuild, sponsorCampaignBuild} from "./sponsor-v4-build.js";

import {sponsorFactoryBuild} from "./sponsor-factory-v4-build.js";
export {sponsorFactoryBuild} from "./sponsor-factory-v4-build.js";
import {sponsorProgrammeBuildV5, sponsorCampaignBuildV5, sponsorFactoryBuildV5, walletRegistryBuildV1} from "./sponsor-v5-build.js";

import {sponsorProgrammeBuildV6, sponsorCampaignBuildV6, sponsorFactoryBuildV6, walletRegistryBuildV2} from "./sponsor-v6-build.js";

const configTuple = "(address funder,address operator,address unallocatedTreasury,address expiredTreasury,bytes32 programmeId,bytes32 manifestHash,uint256 budget,uint64 claimLifetime,uint256[6] caps,bytes32[6] campaignIds,uint64[6] reviewPeriods)";
const configTupleV5 = configTuple.replace("address operator,", "address operator,address walletRegistry,");
const configTupleFor = (p: SponsorExecutionPlan) => p.version >= 5 ? configTupleV5 : configTuple;
export const sponsorProgrammeAbi = parseAbi([
  `constructor(${configTuple} c)`, "function fundProgramme() payable", "function funded() view returns(bool)",
  "function cancelled() view returns(bool)", "function caps(uint256) view returns(uint256)", "function campaigns(uint256) view returns(address)",
  "event ProgrammeFunded(address indexed funder,uint256 amount)",
]);
export const sponsorCampaignAbi = parseAbi([
  "function state() view returns(uint8)", "function accountedFunding() view returns(uint256)",
  "function paid(uint256) view returns(uint256)", "function allocated(uint256) view returns(uint256)",
  "function treasuryReturned() view returns(uint256)", "function budgets(uint256) view returns(uint256)",
  "function paused() view returns(bool)", "function claimDeadline() view returns(uint256)", "function entitlementCount() view returns(uint256)",
]);
const tuple6 = <T>(v: T[]) => v as [T,T,T,T,T,T];
const check = (value: unknown): void => {if (!value) throw Error("sponsor_chain_verification_failed");};
export function sponsorContractConfiguration(input: SponsorExecutionPlan) {
  const p = decodeSponsorExecutionPlan(input);
  const programmeId = keccak256(stringToHex(`raceson:sponsor:v${p.version}:${p.chainId}:${p.launchId}`));
  const campaignIds = tuple6(p.caps.map((_, i) => keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint8"), [programmeId, i]))));
  const caps = tuple6(p.caps.map(BigInt)), reviewPeriods = tuple6(p.reviewPeriods.map(BigInt));
  const base = {funder: p.funder as Address, operator: p.operator as Address, unallocatedTreasury: p.unallocatedTreasury as Address,
    expiredTreasury: p.expiredTreasury as Address, programmeId, manifestHash: `0x${p.configurationHash}` as Hex,
    ...(p.version >= 5 ? {walletRegistry:p.walletRegistry as Address} : {}),
    budget: BigInt(p.budgetWei), claimLifetime: BigInt(p.claimLifetime), caps, campaignIds, reviewPeriods};
  // Full rules fingerprint + immutable economic/authority settings, not just labels.
  const manifestHash = keccak256(encodeAbiParameters(parseAbiParameters(`${configTupleFor(p)},uint256`), [base, BigInt(p.chainId)]));
  return {...base, manifestHash};
}
export function sponsorDeploymentData(plan: SponsorExecutionPlan): Hex {
  const p=decodeSponsorExecutionPlan(plan),build=p.version===6?sponsorProgrammeBuildV6:p.version===5?sponsorProgrammeBuildV5:sponsorProgrammeBuild;
  check(keccak256(build.bytecode) === build.creationCodeHash);
  return encodeDeployData({abi: parseAbi([`constructor(${configTupleFor(p)} c)`]), bytecode: build.bytecode, args: [sponsorContractConfiguration(p)]});
}
export const sponsorFactoryAbi = parseAbi([`function deploy(${configTuple} c) returns(address programme)`,
 "event ProgrammeCreated(bytes32 indexed configurationHash,address indexed programme)"]);
export const sponsorFactoryAbiForVersion = (version:4|5|6) => parseAbi([`function deploy(${version>=5?configTupleV5:configTuple} c) returns(address programme)`,"event ProgrammeCreated(bytes32 indexed configurationHash,address indexed programme)"]);
export const sponsorFactoryData = (plan:SponsorExecutionPlan) => encodeFunctionData({abi:sponsorFactoryAbiForVersion(plan.version),functionName:"deploy",args:[sponsorContractConfiguration(plan)]});
export const sponsorFactorySalt = (plan:SponsorExecutionPlan) => keccak256(encodeAbiParameters(parseAbiParameters(configTupleFor(plan)),[sponsorContractConfiguration(plan)]));
export const sponsorFactoryProgrammeAddress = (plan:SponsorExecutionPlan,factory:Address) => getCreate2Address({from:factory,salt:sponsorFactorySalt(plan),bytecode:sponsorDeploymentData(plan)});
export async function verifySponsorFactory(reader:Pick<PublicClient,"getChainId"|"getCode">,factory:Address,chainId=10143,blockNumber?:bigint,version:4|5|6=4){
 check(await reader.getChainId()===chainId);
 const code=await reader.getCode({address:factory,...(blockNumber!==undefined?{blockNumber}:{blockTag:"finalized" as const})});
 check(code&&keccak256(code)===(version===6?sponsorFactoryBuildV6.runtimeTemplateHash:version===5?sponsorFactoryBuildV5.runtimeTemplateHash:sponsorFactoryBuild.runtimeHash));
}
export const sponsorFundingData = () => encodeFunctionData({abi: sponsorProgrammeAbi, functionName: "fundProgramme"});

function runtime(build: {runtimeBytes: number; runtimeTemplateHash: Hex; offsets: Record<string, readonly number[]>}, code: Hex | undefined, values: Record<string, Hex>) {
  check(typeof code === "string" && code!.length === build.runtimeBytes * 2 + 2);
  let template = code!.toLowerCase();
  for (const [name, offsets] of Object.entries(build.offsets)) {
    const word = values[name]; check(word?.length === 66);
    for (const offset of offsets) {
      const at = offset * 2 + 2; check(template.slice(at, at + 64) === word!.slice(2).toLowerCase());
      template = template.slice(0, at) + "0".repeat(64) + template.slice(at + 64);
    }
  }
  check(keccak256(template as Hex) === build.runtimeTemplateHash);
}
const word = (v: bigint | number | string): Hex => typeof v === "string" ? padHex(v as Hex) : toHex(v, {size: 32});
const same = (a: string | null | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
export type SponsorChainReader = Pick<PublicClient, "getChainId" | "getBlock" | "getTransaction" | "getTransactionReceipt" | "getCode" | "readContract" | "getBalance">;
export type SponsorPotObservation = {slot: number; address: string; amountWei: string; state: number; paused: boolean;
  allocatedWei: string; paidWei: string; returnedWei: string; remainingWei: string; claimDeadline: string; entitlementCount: string};
export type SponsorChainObservation = {address: string; deploymentHash: string; funded: boolean; cancelled: boolean; fundingHash: string | null;
  blockNumber: string; blockHash: string; blockTimestamp: string; pots: SponsorPotObservation[]};

export type SponsorReceiptCode = "sponsor_receipt_pending" | "sponsor_receipt_reverted";
/** A verified lookup outcome, never evidence that money moved. */
export class SponsorReceiptError extends Error {
  constructor(readonly code: SponsorReceiptCode, readonly transactionHash: Hex) {
    super(code);
    this.name = "SponsorReceiptError";
  }
}

type ReceiptAnchor = {number: bigint; hash: Hex};
async function checkAnchor(reader: SponsorChainReader, chainId: number, anchor: ReceiptAnchor) {
  check(await reader.getChainId() === chainId && (await reader.getBlock({blockNumber: anchor.number})).hash === anchor.hash);
}
async function receiptLookup<T>(lookup: () => Promise<T>, reader: SponsorChainReader, chainId: number, anchor: ReceiptAnchor, hash: Hex): Promise<T> {
  try {return await lookup();} catch (error) {
    // Do not infer pending from provider text, timeouts or generic RPC errors.
    if (!(error instanceof TransactionNotFoundError || error instanceof TransactionReceiptNotFoundError)) throw error;
    await checkAnchor(reader, chainId, anchor);
    throw new SponsorReceiptError("sponsor_receipt_pending", hash);
  }
}
async function checkTransactionBlock(reader: SponsorChainReader, tx: {blockNumber: bigint | null; blockHash: Hex | null}) {
  if (tx.blockNumber === null) {check(tx.blockHash === null); return;}
  check(typeof tx.blockNumber === "bigint" && tx.blockNumber >= 0n && tx.blockHash !== null
    && (await reader.getBlock({blockNumber: tx.blockNumber})).hash === tx.blockHash);
}
async function checkReceiptFinality(reader: SponsorChainReader, chainId: number, anchor: ReceiptAnchor,
  receipt: {blockNumber: bigint; blockHash: Hex; status: string}, hash: Hex) {
  check(typeof receipt.blockNumber === "bigint" && receipt.blockNumber >= 0n && receipt.blockHash !== null
    && (receipt.status === "success" || receipt.status === "reverted"));
  check((await reader.getBlock({blockNumber: receipt.blockNumber})).hash === receipt.blockHash);
  if (receipt.blockNumber > anchor.number || receipt.status === "reverted") {
    await checkAnchor(reader, chainId, anchor);
    check((await reader.getBlock({blockNumber: receipt.blockNumber})).hash === receipt.blockHash);
    // Even a revert can be reorganized before finality.
    throw new SponsorReceiptError(receipt.blockNumber > anchor.number ? "sponsor_receipt_pending" : "sponsor_receipt_reverted", hash);
  }
}

/** Server-owned reader only. Pins constructor, runtime AND child code at a canonical
 * finalized block. A browser hash is a lookup hint, never a trusted receipt. */
export async function observeSponsorProgramme(reader: SponsorChainReader, input: SponsorExecutionPlan, deploymentHash: Hex, fundingHash?: Hex): Promise<SponsorChainObservation> {
  return observeSponsorProgrammeScope(reader,input,deploymentHash,fundingHash);
}
/** Controller actions concern one pot. Verify the whole programme's deployment,
 * funding, immutable caps/child addresses and the selected pot's runtime/state.
 * Other pots' mutable state is intentionally absent from this scoped result. */
export async function observeSponsorProgrammePot(reader:SponsorChainReader,input:SponsorExecutionPlan,deploymentHash:Hex,fundingHash:Hex,slot:number):Promise<SponsorChainObservation>{
  check(Number.isInteger(slot)&&slot>=0&&slot<6&&BigInt(decodeSponsorExecutionPlan(input).caps[slot]!)>0n);
  return observeSponsorProgrammeScope(reader,input,deploymentHash,fundingHash,slot);
}
async function observeSponsorProgrammeScope(reader:SponsorChainReader,input:SponsorExecutionPlan,deploymentHash:Hex,fundingHash?:Hex,selectedSlot?:number):Promise<SponsorChainObservation>{
  const p = decodeSponsorExecutionPlan(input), c = sponsorContractConfiguration(p);
  check(await reader.getChainId() === p.chainId);
  const anchor = await reader.getBlock({blockTag: "finalized"});
  check(anchor.number !== null && anchor.hash !== null);
  const blockNumber = anchor.number!;
  const receiptAnchor = {number: blockNumber, hash: anchor.hash!};
  const lookup = <T>(hash: Hex, get: () => Promise<T>) => receiptLookup(get, reader, p.chainId, receiptAnchor, hash);
  const tx = await lookup(deploymentHash, () => reader.getTransaction({hash: deploymentHash}));
  check(tx.chainId === p.chainId && same(tx.hash, deploymentHash) && tx.value === 0n && tx.gas <= 30_000_000n
    && tx.input.toLowerCase() === (tx.to ? sponsorFactoryData(p) : sponsorDeploymentData(p)));
  await checkTransactionBlock(reader, tx);
  if (tx.to) await verifySponsorFactory(reader, tx.to, p.chainId, blockNumber, p.version);
  const receipt = await lookup(deploymentHash, () => reader.getTransactionReceipt({hash: deploymentHash}));
  // Creation is permissionless: the gas payer gains no authority. The exact
  // constructor, runtime and children below bind funder, oracle and refunds.
  // This also accepts a dedicated deployment wallet without sharing oracle keys.
  check(tx.chainId === p.chainId && same(tx.hash, deploymentHash) && same(receipt.transactionHash, deploymentHash)
    && tx.value === 0n && same(receipt.from, tx.from)
    && tx.blockNumber === receipt.blockNumber
    && tx.blockHash === receipt.blockHash && tx.transactionIndex === receipt.transactionIndex
    && tx.gas <= 30_000_000n);
  let address:Address;
  if(tx.to){
    check(same(receipt.to,tx.to)&&receipt.contractAddress===null&&tx.input.toLowerCase()===sponsorFactoryData(p));
    await verifySponsorFactory(reader,tx.to,p.chainId,receipt.blockNumber,p.version);
    address=sponsorFactoryProgrammeAddress(p,tx.to);
    await checkReceiptFinality(reader,p.chainId,receiptAnchor,receipt,deploymentHash);
    const logs=receipt.logs.filter(log=>same(log.address,tx.to!));check(logs.length===1);
    const event=decodeEventLog({abi:sponsorFactoryAbi,data:logs[0]!.data,topics:logs[0]!.topics});
    check(!logs[0]!.removed&&event.eventName==="ProgrammeCreated"&&same(event.args.programme,address)&&event.args.configurationHash===sponsorFactorySalt(p));
  }else{
    check(receipt.to===null&&tx.input.toLowerCase()===sponsorDeploymentData(p));
    address=getContractAddress({from:tx.from,nonce:BigInt(tx.nonce)});
    check(receipt.status === "reverted" ? receipt.contractAddress === null : same(receipt.contractAddress,address));
    await checkReceiptFinality(reader,p.chainId,receiptAnchor,receipt,deploymentHash);
  }
  // These independent values share one finalized block; do not serialize network latency.
  const [programmeCode, funded, cancelled, slots] = await Promise.all([
    reader.getCode({address, blockNumber}),
    reader.readContract({address, abi: sponsorProgrammeAbi, functionName: "funded", blockNumber}),
    reader.readContract({address, abi: sponsorProgrammeAbi, functionName: "cancelled", blockNumber}),
    Promise.all(Array.from({length:6}, (_,slot) => Promise.all([
      reader.readContract({address, abi: sponsorProgrammeAbi, functionName: "campaigns", args: [BigInt(slot)], blockNumber}),
      reader.readContract({address, abi: sponsorProgrammeAbi, functionName: "caps", args: [BigInt(slot)], blockNumber}),
    ]))),
  ]);
  if(p.version>=5) await verifySponsorWalletRegistry(reader,p,blockNumber);
  runtime(p.version===6?sponsorProgrammeBuildV6:p.version===5?sponsorProgrammeBuildV5:sponsorProgrammeBuild, programmeCode, {
    ...(p.version>=5?{walletRegistry:word(p.walletRegistry!)}:{}),
    funder: word(c.funder), operator: word(c.operator), unallocatedTreasury: word(c.unallocatedTreasury), expiredTreasury: word(c.expiredTreasury),
    programmeId: c.programmeId, programmeManifestHash: c.manifestHash, budget: word(c.budget), claimLifetime: word(c.claimLifetime),
  });
  check(typeof funded === "boolean" && typeof cancelled === "boolean" && !(funded && cancelled));
  const pots: SponsorChainObservation["pots"] = [];
  let nonce = 1n;
  for (let slot = 0; slot < 6; slot++) {
    const [child, cap] = slots[slot]!;
    check(cap === c.caps[slot]);
    if (cap === 0n) {check(BigInt(child) === 0n); continue;}
    check(same(child, getContractAddress({from: address, nonce: nonce++})));
    if(selectedSlot!==undefined&&slot!==selectedSlot)continue;
    const name = "RacesOnRewardCampaign", version = p.version===6?"7":p.version===5?"6":"5";
    const short = (s: string) => `${padHex(stringToHex(s), {size: 31, dir: "right"})}${toHex(s.length, {size: 1}).slice(2)}` as Hex;
    const args = {address: child, abi: sponsorCampaignAbi, blockNumber};
    const [campaignCode, accounted, state, paused, deadline, count, allocatedRace, allocatedLeague, paidRace, paidLeague, returned, balance] = await Promise.all([
      reader.getCode({address: child, blockNumber}),
      reader.readContract({...args, functionName: "accountedFunding"}), reader.readContract({...args, functionName: "state"}),
      reader.readContract({...args, functionName: "paused"}), reader.readContract({...args, functionName: "claimDeadline"}),
      reader.readContract({...args, functionName: "entitlementCount"}),
      reader.readContract({...args, functionName: "allocated", args: [0n]}), reader.readContract({...args, functionName: "allocated", args: [1n]}),
      reader.readContract({...args, functionName: "paid", args: [0n]}), reader.readContract({...args, functionName: "paid", args: [1n]}),
      reader.readContract({...args, functionName: "treasuryReturned"}), reader.getBalance({address: child, blockNumber}),
    ]);
    runtime(p.version===6?sponsorCampaignBuildV6:p.version===5?sponsorCampaignBuildV5:sponsorCampaignBuild, campaignCode, {
      ...(p.version>=5?{walletRegistry:word(p.walletRegistry!)}:{}),
      operator: word(c.operator), treasury: word(c.unallocatedTreasury), expiredTreasury: word(c.expiredTreasury), cancellationTreasury: word(c.funder),
      fundingSource: word(address), CLAIM_LIFETIME: word(c.claimLifetime), programmeId: c.programmeId, campaignId: c.campaignIds[slot]!,
      programmeManifestHash: c.manifestHash, enabledPot: word(slot === 0 ? 1 : 0), reviewPeriod: word(c.reviewPeriods[slot]!),
      _cachedChainId: word(p.chainId), _cachedThis: word(child), _hashedName: keccak256(stringToHex(name)), _hashedVersion: keccak256(stringToHex(version)),
      _name: short(name), _version: short(version), _cachedDomainSeparator: hashDomain({domain: {name, version, chainId: BigInt(p.chainId), verifyingContract: child}, types: {EIP712Domain: [
        {name: "name", type: "string"}, {name: "version", type: "string"}, {name: "chainId", type: "uint256"}, {name: "verifyingContract", type: "address"}]} }),
    });
    check(accounted === (funded ? cap : 0n));
    const allocated = allocatedRace + allocatedLeague, paid = paidRace + paidLeague;
    check(Number.isInteger(state) && state >= 0 && state <= 5 && typeof paused === "boolean"
      && allocated <= accounted && paid <= allocated && paid + returned <= accounted && balance >= accounted - paid - returned
      && (slot === 0 ? allocatedRace === 0n && paidRace === 0n : allocatedLeague === 0n && paidLeague === 0n)
      && (funded ? state >= 1 : state === 0) && (state === 3 || state === 4 ? deadline > 0n : true));
    pots.push({slot, address: child.toLowerCase(), amountWei: cap.toString(), state, paused,
      allocatedWei: allocated.toString(), paidWei: paid.toString(), returnedWei: returned.toString(),
      remainingWei: (accounted - paid - returned).toString(), claimDeadline: deadline.toString(), entitlementCount: count.toString()});
  }
  if (fundingHash) {
    const ftx = await lookup(fundingHash, () => reader.getTransaction({hash: fundingHash}));
    check(ftx.chainId === p.chainId && same(ftx.hash, fundingHash) && same(ftx.from, p.funder) && same(ftx.to, address)
      && ftx.value === c.budget && ftx.input.toLowerCase() === sponsorFundingData());
    await checkTransactionBlock(reader, ftx);
    const fr = await lookup(fundingHash, () => reader.getTransactionReceipt({hash: fundingHash}));
    check(ftx.chainId === p.chainId && same(ftx.hash, fundingHash) && same(fr.transactionHash, fundingHash)
      && same(ftx.from, p.funder) && same(fr.from, p.funder) && same(ftx.to, address) && same(fr.to, address)
      && ftx.value === c.budget && ftx.input.toLowerCase() === sponsorFundingData() && fr.contractAddress === null
      && fr.blockHash === ftx.blockHash && fr.blockNumber === ftx.blockNumber && fr.transactionIndex === ftx.transactionIndex);
    await checkReceiptFinality(reader,p.chainId,receiptAnchor,fr,fundingHash);
    check(funded);
    const logs = fr.logs.filter(log => same(log.address, address));
    check(logs.length === 1);
    const log = logs[0]!;
    check(!log.removed && log.transactionHash === fr.transactionHash && log.blockHash === fr.blockHash && log.blockNumber === fr.blockNumber);
    const event = decodeEventLog({abi: sponsorProgrammeAbi, data: log.data, topics: log.topics});
    check(event.eventName === "ProgrammeFunded" && same(event.args.funder, p.funder) && event.args.amount === c.budget);
  }
  check(await reader.getChainId() === p.chainId && (await reader.getBlock({blockNumber})).hash === anchor.hash
    && (await reader.getBlock({blockNumber: receipt.blockNumber})).hash === receipt.blockHash);
  return {address: address.toLowerCase(), deploymentHash, funded, cancelled, fundingHash: fundingHash ?? null,
    blockNumber: blockNumber.toString(), blockHash: anchor.hash!, blockTimestamp: anchor.timestamp.toString(), pots};
}

export async function verifySponsorWalletRegistry(reader:Pick<PublicClient,"getCode">,input:SponsorExecutionPlan,blockNumber:bigint){
 const p=decodeSponsorExecutionPlan(input);check(p.version>=5);
 const address=p.walletRegistry as Address,name="RacesOnWalletRegistry",version=p.version===6?"2":"1";
 const short=(s:string)=>`${padHex(stringToHex(s),{size:31,dir:"right"})}${toHex(s.length,{size:1}).slice(2)}` as Hex;
 runtime(p.version===6?walletRegistryBuildV2:walletRegistryBuildV1,await reader.getCode({address,blockNumber}),{
  identityIssuer:word(p.identityIssuer!),_cachedChainId:word(p.chainId),_cachedThis:word(address),
  _hashedName:keccak256(stringToHex(name)),_hashedVersion:keccak256(stringToHex(version)),_name:short(name),_version:short(version),
  _cachedDomainSeparator:hashDomain({domain:{name,version,chainId:BigInt(p.chainId),verifyingContract:address},types:{EIP712Domain:[
   {name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}]}}),
 });
}
