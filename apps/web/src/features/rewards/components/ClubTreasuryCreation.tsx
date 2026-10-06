import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {useAuth} from '@/lib/auth';
import RewardEmbeddedWalletControls from './RewardEmbeddedWalletControls';
import RewardExplorerLink from './RewardExplorerLink';
import {useRewardEmbeddedWallet} from './RewardEmbeddedWalletContext';
import {prepareBrowserWalletProof,type PreparedWalletProof} from '../data/browserWallet';
import type {WalletProof} from '../model/athleteRewards';
import {clubSafeCreation,clubSafeCreationHistory,type ClubCreationView,type ClubCreationRecord} from '../data/clubSafeCreation';
import {submitClubTreasury} from '../data/clubTreasuries';
import {rewardClubSafeTestnetDependencies} from '@raceson/rewards-chain';
import type {RewardOwnedClub} from '../model/clubTreasuries';
import {formatEther,type Address} from 'viem';
type Attempt={action:'request';requestId:string;clubId:string;proofId:string;owners:string[]};
export default function ClubTreasuryCreation({clubs,onBack,onSaved}:{clubs:RewardOwnedClub[];onBack:()=>void;onSaved:()=>void}){
 const auth=useAuth(),embedded=useRewardEmbeddedWallet(),wallet=embedded.wallet;
 const [clubId,setClubId]=useState(''),[owners,setOwners]=useState(['','','']),[ownerAck,setOwnerAck]=useState(false),[feeAck,setFeeAck]=useState(false);
 const [proofStep,setProofStep]=useState<PreparedWalletProof|null>(null),[proof,setProof]=useState<WalletProof|null>(null),[attempt,setAttempt]=useState<Attempt|null>(null);
 const [view,setView]=useState<ClubCreationView|null>(null),[history,setHistory]=useState<ClubCreationRecord[]>([]),[cursor,setCursor]=useState<string|null>(null);
 const [hash,setHash]=useState(''),[unknown,setUnknown]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[nominated,setNominated]=useState(false);
 const live=useRef(false),flight=useRef(false),abort=useRef<AbortController|null>(null),scope=useRef(wallet),lastWallet=useRef(wallet);scope.current=wallet;
 const session=useRef(auth.session),stepRef=useRef(proofStep);stepRef.current=proofStep;
 const current=()=>live.current&&session.current===auth.session&&scope.current===wallet;
 useEffect(()=>{live.current=true;void loadHistory();return()=>{live.current=false;abort.current?.abort();stepRef.current?.dispose();};},[]);
 useEffect(()=>{if(lastWallet.current!==wallet){lastWallet.current=wallet;abort.current?.abort();stepRef.current?.dispose();setProofStep(null);setProof(null);setFeeAck(false);setView(v=>v?{...v,prepared:null}:null);}},[wallet]);
 async function run(task:()=>Promise<void>){if(flight.current)return;flight.current=true;setBusy(true);setError(null);try{await task();}catch(e){if(live.current){setFeeAck(false);setView(v=>v?{...v,prepared:null}:null);const code=e&&typeof e==='object'&&'code'in e?String(e.code):e instanceof Error?e.message:'';
  setError(code==='reward_club_creation_gas_required'||code==='creation_gas_required'?'Your deployment wallet needs test MON for the displayed network fee. Add test MON, then prepare the saved request again.':code==='reward_wallet_challenge_expired'?'Wallet proof expired. Verify control again, then retry the same saved request.':'This step is not confirmed. Refresh the saved request or verify its transaction before continuing.');}}
  finally{flight.current=false;if(live.current)setBusy(false);}}
 async function loadHistory(after:string|null=null){try{const p=await clubSafeCreationHistory(after);if(live.current){setHistory(old=>after?[...old,...p.items]:p.items);setCursor(p.nextCursor);}}catch{if(live.current){setHistory([]);setCursor(null);setError('Creation history could not be checked. Refresh before continuing.');}}}
 const storageKey=(id:string)=>`podium-safe-creation:${auth.user?.id}:${id}`;
 function retain(id:string,value:string){sessionStorage.setItem(storageKey(id),value);}
 function restore(r:ClubCreationRecord){const local=sessionStorage.getItem(storageKey(r.requestId));setHash(r.verified?.transactionHash??r.transactions.at(-1)?.transactionHash??(/^0x[0-9a-f]{64}$/.test(local??'')?local!:''));setUnknown(local==='unknown');}
 async function select(id:string){stepRef.current?.dispose();setProofStep(null);setProof(null);setFeeAck(false);setNominated(false);const v=await clubSafeCreation(id);if(current()){setView(v);setAttempt(null);restore(v.record);}}
 async function prepareProof(){if(!wallet)return;abort.current?.abort();stepRef.current?.dispose();const controller=new AbortController();abort.current=controller;setProof(null);setProofStep(null);
  const step=await prepareBrowserWalletProof(wallet.provider,window.location.origin,current,()=>{if(live.current){setProof(null);setProofStep(null);setFeeAck(false);setView(v=>v?{...v,prepared:null}:null);}},controller.signal);
  if(current())setProofStep(step);else step.dispose();}
 async function confirmProof(){if(!proofStep)return;const p=await proofStep.confirm();if(current()){if(view&&p.address!==view.record.sender)throw Error('wallet_changed');setProof(p);}}
 const normalized=owners.map(o=>o.trim().toLowerCase()).sort(),validOwners=normalized.length===3&&new Set(normalized).size===3&&normalized.every(o=>/^0x[0-9a-f]{40}$/.test(o)&&BigInt(o)>1n)
  &&clubs.some(c=>c.clubId===clubId);
 async function save(){if(!proof||!validOwners&&!attempt||!ownerAck&&!attempt)return;
  const body=attempt?{...attempt,proofId:proof.proofId}:{action:'request' as const,requestId:crypto.randomUUID(),clubId,proofId:proof.proofId,owners:normalized};setAttempt(body);
  const v=await clubSafeCreation(body.requestId,body);if(current()){setView(v);setAttempt(null);setFeeAck(false);restore(v.record);await loadHistory();}}
 async function prepare(){if(!view||!proof)return;await proofStep?.assertCurrent();const v=await clubSafeCreation(view.record.requestId,{action:'prepare',proofId:proof.proofId});if(current()){setView(v);setFeeAck(false);}}
 async function deploy(){if(!view?.prepared||!proof||!feeAck||!wallet?.sendClubSafeCreation)return;
  const id=view.record.requestId,checked=await clubSafeCreation(id,{action:'prepare',proofId:proof.proofId});
  if(!current()||!checked.prepared||checked.prepared.maximumFee!==view.prepared.maximumFee||checked.prepared.gas!==view.prepared.gas||checked.prepared.gasPrice!==view.prepared.gasPrice||JSON.stringify(checked.record)!==JSON.stringify(view.record))throw Error('creation_changed');
  // Retire further submission before entering the wallet. An unknown result
  // survives reload and must be resolved by its exact observed transaction.
  retain(id,'unknown');setUnknown(true);setFeeAck(false);
  const transactionHash=await wallet.sendClubSafeCreation(checked,current);if(!current())return;retain(id,transactionHash);setHash(transactionHash);setUnknown(false);
  const v=await clubSafeCreation(id,{action:'submitted',transactionHash});if(current()){setView(v);await loadHistory();}}
 async function verify(){if(!view||!/^0x[0-9a-f]{64}$/.test(hash))return;const v=await clubSafeCreation(view.record.requestId,{action:'verify',transactionHash:hash});if(current()){setView(v);setUnknown(false);retain(v.record.requestId,hash);await loadHistory();}}
 async function nominate(){const r=view?.record;if(!r?.verified||!r.current)return;
  await submitClubTreasury({clubId:r.clubId,idempotencyKey:`safe-creation-${r.requestId}`,safeAddress:r.verified.safeAddress as Address,singletonAddress:rewardClubSafeTestnetDependencies.singletonAddress,fallbackHandlerAddress:rewardClubSafeTestnetDependencies.fallbackHandlerAddress,owners:r.owners as Address[]});if(current()){setNominated(true);onSaved();}}
 const saved=view?.record,needsRecovery=unknown||!!hash||!!saved?.transactions.length;
 return <section aria-labelledby="club-create-title" className="space-y-4 rounded-xl border border-border bg-card p-5">
  <h2 id="club-create-title" className="text-xl font-semibold">Create your club treasury</h2>
  <p>Choose three owner addresses. Two owners will need to approve each reward. Your connected wallet pays the test MON network fee to create this Safe.</p>
  <RewardEmbeddedWalletControls existingAddress={saved?.sender}/>
  {!saved?<fieldset disabled={busy||!!attempt} className="space-y-3"><label className="block">Club<select aria-label="Club for new treasury" className="block w-full rounded-md border p-2" value={clubId} onChange={e=>{setClubId(e.target.value);setOwnerAck(false);}}><option value="">Choose your club</option>{clubs.map(c=><option key={c.clubId} value={c.clubId}>{c.name}</option>)}</select></label>
   {owners.map((o,i)=><label key={i} className="block">Owner {i+1}<input aria-label={`Treasury owner ${i+1}`} className="block w-full rounded-md border p-2 font-mono text-xs" value={o} maxLength={42} autoComplete="off" spellCheck={false} placeholder="0x…" onChange={e=>{setOwners(old=>old.map((v,j)=>j===i?e.target.value:v));setOwnerAck(false);}}/></label>)}
   <label className="flex gap-2"><input type="checkbox" checked={ownerAck} onChange={e=>setOwnerAck(e.target.checked)}/>I want this treasury to use these three addresses with two signatures required.</label></fieldset>:<div className="space-y-2"><p>Saved creation request · {saved.requestId}</p><p className="break-all">Deployment wallet: {saved.sender}</p><ul>{saved.owners.map(o=><li className="break-all font-mono text-xs" key={o}>{o}</li>)}</ul>{!saved.current?<p role="alert">Club ownership changed. Creation stays on hold; the saved history remains available.</p>:null}</div>}
  {!saved?.verified&&!needsRecovery?<div className="space-y-3"><Button variant="outline" disabled={busy||!wallet||!!saved&&!saved.current} onClick={()=>void run(prepareProof)}>Check deployment wallet control</Button>
   {proofStep&&!proof?<Button disabled={busy} onClick={()=>void run(confirmProof)}>Sign wallet control · Privy</Button>:null}
   {proof?<p role="status" className="break-all">Wallet control checked: {proof.address}</p>:null}
   {!saved?<Button disabled={busy||!proof||(!attempt&&(!validOwners||!ownerAck))} onClick={()=>void run(save)}>{attempt?'Retry same creation request':'Save treasury creation request'}</Button>:<Button variant="outline" disabled={busy||!proof||!saved.current} onClick={()=>void run(prepare)}>Prepare creation and network fee</Button>}
  </div>:null}
  {view?.prepared&&!needsRecovery?<div className="space-y-3 rounded-lg border p-4"><p className="break-all">New treasury: {view.prepared.plan.safe.context.verifyingContract}</p><p>Maximum network fee: <strong>{formatEther(BigInt(view.prepared.maximumFee))} test MON</strong> · Prize deposit: 0</p>
   <label className="flex gap-2"><input type="checkbox" checked={feeAck} disabled={busy} onChange={e=>setFeeAck(e.target.checked)}/>I confirm this treasury and its maximum network fee.</label>
   <Button disabled={busy||!feeAck||!wallet?.sendClubSafeCreation} onClick={()=>void run(deploy)}>Create treasury · confirm with Privy</Button></div>:null}
  {saved&&!saved.verified?<div className="space-y-3">{needsRecovery?<p role="status">Creation is awaiting verification. Check the saved transaction; a wallet hash alone does not confirm a Safe.</p>:<p>If you already confirmed creation in another browser, enter its transaction hash to recover the result.</p>}
   {unknown?<p>The wallet response was not confirmed. Find the creation transaction in your wallet or its <RewardExplorerLink chainId={10143} kind="address" value={saved?.sender??embedded.address??''}/> history, then paste its hash.</p>:null}
   <label className="block">Creation transaction hash<input aria-label="Creation transaction hash" className="block w-full rounded-md border p-2 font-mono text-xs" value={hash} maxLength={66} onChange={e=>setHash(e.target.value.trim().toLowerCase())}/></label>
   <Button disabled={busy||!/^0x[0-9a-f]{64}$/.test(hash)} onClick={()=>void run(verify)}>Verify finalized creation receipt</Button></div>:null}
  {saved?.verified?<div role="status" className="space-y-3"><h3 className="font-semibold">Treasury creation verified</h3><RewardExplorerLink chainId={10143} kind="address" value={saved.verified.safeAddress}/><p>The treasury still needs nomination and readiness review. Owner signatures are collected for each reward.</p>
   {nominated?<p>Nomination saved · awaiting review</p>:<Button disabled={busy||!saved.current} onClick={()=>void run(nominate)}>Nominate this verified treasury</Button>}</div>:null}
  {error?<p role="alert">{error}</p>:null}
  <details className="space-y-3"><summary>Saved treasury creation requests</summary><Button variant="outline" disabled={busy} onClick={()=>void run(()=>loadHistory())}>Refresh creation history</Button>
   <ul>{history.map(r=><li key={r.requestId}><Button variant="ghost" disabled={busy} onClick={()=>void run(()=>select(r.requestId))}>{r.verified?'Verified treasury':'Resume creation request'} · {r.requestId}</Button></li>)}</ul>
   {cursor?<Button variant="outline" disabled={busy} onClick={()=>void run(()=>loadHistory(cursor))}>Load more creation requests</Button>:null}</details>
  <Button variant="ghost" disabled={busy} onClick={onBack}>Back to club rewards</Button>
 </section>;
}
