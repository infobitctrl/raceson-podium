import {CheckCircle2,ShieldCheck,Users,Wallet} from 'lucide-react';
import ClubTreasuryMembers from './ClubTreasuryMembers';
import type {ClubCreationMember} from '../data/clubSafeCreation';
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
type Attempt={action:'request';requestId:string;clubId:string;proofId:string;owners:string[];memberIds:string[]};
export default function ClubTreasuryCreation({clubs,onBack,onSaved,onVerified}:{clubs:RewardOwnedClub[];onBack:()=>void;onSaved:()=>void;onVerified?:()=>void}){
 const auth=useAuth(),embedded=useRewardEmbeddedWallet(),wallet=embedded.wallet;
 const [clubId,setClubId]=useState(clubs.length===1?clubs[0]!.clubId:''),[members,setMembers]=useState<ClubCreationMember[]>([]),[ownerAck,setOwnerAck]=useState(false),[feeAck,setFeeAck]=useState(false);
 const [proofStep,setProofStep]=useState<PreparedWalletProof|null>(null),[proof,setProof]=useState<WalletProof|null>(null),[attempt,setAttempt]=useState<Attempt|null>(null);
 const [view,setView]=useState<ClubCreationView|null>(null),[history,setHistory]=useState<ClubCreationRecord[]>([]),[cursor,setCursor]=useState<string|null>(null);
 const [hash,setHash]=useState(''),[unknown,setUnknown]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[nominated,setNominated]=useState(false);
 const live=useRef(false),flight=useRef(false),abort=useRef<AbortController|null>(null),scope=useRef(wallet),lastWallet=useRef(wallet);scope.current=wallet;
 const session=useRef(auth.session),stepRef=useRef(proofStep);stepRef.current=proofStep;
 const verifiedNotice=useRef<string|null>(null);
 function notifyVerified(record:ClubCreationRecord){if(record.current&&record.verified&&verifiedNotice.current!==record.requestId){verifiedNotice.current=record.requestId;onVerified?.();}}
 const current=()=>live.current&&session.current===auth.session&&scope.current===wallet;
 useEffect(()=>{live.current=true;void loadHistory();return()=>{live.current=false;abort.current?.abort();stepRef.current?.dispose();};},[]);
 useEffect(()=>{if(lastWallet.current!==wallet){lastWallet.current=wallet;abort.current?.abort();stepRef.current?.dispose();setProofStep(null);setProof(null);setFeeAck(false);setView(v=>v?{...v,prepared:null}:null);}},[wallet]);
 async function run(task:()=>Promise<void>){if(flight.current)return;flight.current=true;setBusy(true);setError(null);try{await task();}catch(e){if(live.current){setFeeAck(false);setView(v=>v?{...v,prepared:null}:null);const code=e&&typeof e==='object'&&'code'in e?String(e.code):e instanceof Error?e.message:'';
  setError(code==='reward_club_creation_gas_required'||code==='creation_gas_required'?'Fee sponsorship is unavailable. Retry shortly; no personal test MON is required.':code==='reward_club_members_changed'?'Member details changed. Refresh the member wallets before creating a treasury.':code==='reward_wallet_challenge_expired'?'Wallet proof expired. Verify control again, then retry the same saved request.':'This step is not confirmed. Refresh the saved request or verify its transaction before continuing.');}}
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
 const normalized=members.flatMap(m=>m.status==='ready'&&m.address?[m.address]:[]).sort(),validOwners=members.length===3&&normalized.length===3&&new Set(normalized).size===3&&normalized.every(o=>/^0x[0-9a-f]{40}$/.test(o)&&BigInt(o)>1n)
  &&clubs.some(c=>c.clubId===clubId);
 async function save(){if(!proof||!validOwners&&!attempt||!ownerAck&&!attempt)return;
  const body=attempt?{...attempt,proofId:proof.proofId}:{action:'request' as const,requestId:crypto.randomUUID(),clubId,proofId:proof.proofId,owners:normalized,memberIds:members.map(m=>m.memberId).sort()};setAttempt(body);
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
 async function verify(){if(!view||!/^0x[0-9a-f]{64}$/.test(hash))return;const v=await clubSafeCreation(view.record.requestId,{action:'verify',transactionHash:hash});if(current()){setView(v);setUnknown(false);retain(v.record.requestId,hash);await loadHistory();if(current())notifyVerified(v.record);}}
 const pendingId=view&&!view.record.verified?view.record.requestId:null;
 const latestReceiptScope=useRef({current,loadHistory,notifyVerified});latestReceiptScope.current={current,loadHistory,notifyVerified};
 useEffect(()=>{
  if(!hash||!pendingId)return;
  let stopped=false,checking=false,tries=0;const id=pendingId;
  const timer=setInterval(()=>{if(stopped||checking||flight.current||tries++>=20)return;checking=true;void clubSafeCreation(id,{action:'verify',transactionHash:hash}).then(v=>{if(!stopped&&latestReceiptScope.current.current()){setView(v);if(v.record.verified){setUnknown(false);void latestReceiptScope.current.loadHistory();latestReceiptScope.current.notifyVerified(v.record);}}}).catch(()=>{/* Keep the exact hash available for explicit recovery. */}).finally(()=>{checking=false;});},3000);
  return()=>{stopped=true;clearInterval(timer);};
 },[hash,pendingId,wallet]);
 async function nominate(){const r=view?.record;if(!r?.verified||!r.current)return;
  await submitClubTreasury({clubId:r.clubId,idempotencyKey:`safe-creation-${r.requestId}`,safeAddress:r.verified.safeAddress as Address,singletonAddress:rewardClubSafeTestnetDependencies.singletonAddress,fallbackHandlerAddress:rewardClubSafeTestnetDependencies.fallbackHandlerAddress,owners:r.owners as Address[]});if(current()){setNominated(true);onSaved();}}
 const saved=view?.record,needsRecovery=unknown||!!hash||!!saved?.transactions.length;
 return <section aria-labelledby="club-create-title" className="space-y-4 rounded-xl border border-border bg-card p-5">
  <h2 id="club-create-title" className="text-xl font-semibold">Create your club treasury with Privy</h2>
  <p className="text-sm text-muted-foreground">Choose three club members. Any two must approve club reward claims.</p>
  <ol aria-label="Treasury setup progress" className="grid grid-cols-3 gap-2 text-sm">{[{name:'Choose members',icon:Users,done:!!saved},{name:'Confirm wallet',icon:Wallet,done:!!view?.prepared||!!saved?.verified},{name:'Create treasury',icon:ShieldCheck,done:!!saved?.verified}].map((step,i)=><li key={step.name} className={`flex flex-col items-center gap-2 rounded-lg border p-3 text-center ${step.done?'border-emerald-200 bg-emerald-50 text-emerald-800':''}`} aria-current={!step.done&&(i===0?!saved:i===1?!!saved&&!view?.prepared:!!view?.prepared)?'step':undefined}>{step.done?<CheckCircle2 size={20} aria-hidden="true"/>:<step.icon size={20} aria-hidden="true"/>}{step.name}</li>)}</ol>
  <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Network fee covered by RacesOn · No test MON needed</p>
  <RewardEmbeddedWalletControls existingAddress={saved?.sender}/>
  {!saved?<fieldset disabled={busy||!!attempt} className="space-y-3"><label className="block">Club<select aria-label="Club for new treasury" className="block w-full rounded-md border p-2" value={clubId} onChange={e=>{setClubId(e.target.value);setMembers([]);setOwnerAck(false);}}><option value="">Choose your club</option>{clubs.map(c=><option key={c.clubId} value={c.clubId}>{c.name}</option>)}</select></label>
   {clubId?<ClubTreasuryMembers clubId={clubId} disabled={busy||!!attempt} onChange={next=>{setMembers(next);setOwnerAck(false);}}/>:null}
   <label className="flex gap-2"><input type="checkbox" checked={ownerAck} onChange={e=>setOwnerAck(e.target.checked)}/>I confirm these three members as the demo treasury owners. Any two must approve.</label></fieldset>:<div className="space-y-2"><p className="font-medium">{saved.verified?'Club treasury':'Members selected'}</p><ul className="space-y-1">{saved.members?.length?saved.members.map(m=><li key={m.memberId} className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-700" aria-hidden="true"/>{m.name}</li>):saved.owners.map(o=><li className="break-all font-mono text-xs" key={o}>{o}</li>)}</ul><details className="text-sm"><summary>View details</summary><p>Saved creation request · {saved.requestId}</p><p className="break-all">Confirmation wallet: {saved.sender}</p>{saved.owners.map(o=><p className="break-all font-mono text-xs" key={o}>{o}</p>)}</details>{!saved.current?<p role="alert">Club ownership or membership changed. Treasury creation is on hold.</p>:null}</div>}
  {!saved?.verified&&!needsRecovery?<div className="flex flex-col items-start gap-3"><Button variant="outline" disabled={busy||!wallet||!!saved&&!saved.current} onClick={()=>void run(prepareProof)}>Verify my wallet</Button>
   {proofStep&&!proof?<Button disabled={busy} onClick={()=>void run(confirmProof)}>Confirm wallet · Privy</Button>:null}
   {proof?<p role="status" className="break-all">Wallet control checked: {proof.address}</p>:null}
   {!saved?<Button disabled={busy||!proof||(!attempt&&(!validOwners||!ownerAck))} onClick={()=>void run(save)}>{attempt?'Retry same creation request':'Save selected members'}</Button>:<Button variant="outline" disabled={busy||!proof||!saved.current} onClick={()=>void run(prepare)}>Prepare treasury</Button>}
  </div>:null}
  {view?.prepared&&!needsRecovery?<div className="space-y-3 rounded-lg border p-4"><p className="break-all text-xs">New treasury: {view.prepared.plan.safe.context.verifyingContract}</p><p className="text-sm">Your network fee: <strong>0 test MON</strong></p><details className="text-xs"><summary>Fee details</summary>Estimated network fee covered by RacesOn: {formatEther(BigInt(view.prepared.maximumFee))} test MON</details>
   <label className="flex gap-2"><input type="checkbox" checked={feeAck} disabled={busy} onChange={e=>setFeeAck(e.target.checked)}/>Create this club treasury with RacesOn covering the fee.</label>
   <Button disabled={busy||!feeAck||!wallet?.sendClubSafeCreation} onClick={()=>void run(deploy)}>Create club treasury · Privy</Button></div>:null}
  {saved&&!saved.verified?<details open={needsRecovery} className="space-y-3"><summary className="text-sm">{needsRecovery?'Confirmation status':'Recover a previous creation'}</summary>{needsRecovery?<p role="status">Confirming treasury… Allow about 30 seconds. Keep this page open.</p>:<p>If you already confirmed creation in another browser, enter its transaction hash to recover the result.</p>}
   {unknown?<p>The wallet response was not confirmed. Find the creation transaction in your wallet or its <RewardExplorerLink chainId={10143} kind="address" value={saved?.sender??embedded.address??''}/> history, then paste its hash.</p>:null}
   <label className="block">Creation transaction hash<input aria-label="Creation transaction hash" className="block w-full rounded-md border p-2 font-mono text-xs" value={hash} maxLength={66} onChange={e=>setHash(e.target.value.trim().toLowerCase())}/></label>
   <Button disabled={busy||!/^0x[0-9a-f]{64}$/.test(hash)} onClick={()=>void run(verify)}>Verify finalized creation receipt</Button></details>:null}
  {saved?.verified?<div role="status" className="space-y-3"><h3 className="flex items-center gap-2 font-semibold text-emerald-700"><CheckCircle2 size={20} aria-hidden="true"/>Club treasury ready</h3><RewardExplorerLink chainId={10143} kind="address" value={saved.verified.safeAddress}/><p>Select this treasury when claiming a club reward. Two members must approve.</p>
   <details><summary className="text-sm">Older campaigns</summary>{nominated?<p>Nomination saved · awaiting review</p>:<Button disabled={busy||!saved.current} onClick={()=>void run(nominate)}>Nominate this verified treasury</Button>}</details></div>:null}
  {busy?<p role="status" className="text-sm text-muted-foreground">Checking treasury setup… Allow about 30 seconds for network checks.</p>:null}
  {error?<p role="alert">{error}</p>:null}
  <details className="space-y-3"><summary>Saved treasury creation requests</summary><Button variant="outline" disabled={busy} onClick={()=>void run(()=>loadHistory())}>Refresh creation history</Button>
   <ul>{history.map(r=><li key={r.requestId}><Button variant="ghost" disabled={busy} onClick={()=>void run(()=>select(r.requestId))}>{r.verified?'Verified treasury':'Resume creation request'} · {r.requestId}</Button></li>)}</ul>
   {cursor?<Button variant="outline" disabled={busy} onClick={()=>void run(()=>loadHistory(cursor))}>Load more creation requests</Button>:null}</details>
  <Button variant="ghost" disabled={busy} onClick={onBack}>Other treasury options</Button>
 </section>;
}
