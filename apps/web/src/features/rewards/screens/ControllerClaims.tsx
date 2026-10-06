import {useEffect,useRef,useState} from 'react';
import {getControllerClaims,requestControllerClaim} from '../data/controllerClaims';
import type {HostedClaimQueue} from '../data/hostedClaimReviews';
import type {SponsorClubClaim} from '../data/sponsorClubClaims';
import type {SponsorClaim} from '../data/sponsorProgramme';
import {signProgrammeClaim} from '../data/sponsorProgrammeWallet';
import {controllerJobSchema,confirmControllerJob,type ControllerJob} from '../data/controllerTransactions';
import type {ControllerConnection} from './RewardsControl';
import RewardClaimDialog from '../components/RewardClaimDialog';
import RewardClaimProgress from '../components/RewardClaimProgress';
import {setupAmount} from '../model/setupAmount';
import s from './RewardsControl.module.css';
type Props={connection:ControllerConnection;wallet:string;setupId:string;approvalId:string;disabled?:boolean;requestedClaimId?:string|null;club?:boolean};
export default function ControllerClaims(props:Props){
 return <ClaimQueue key={`${props.connection.subject}:${props.wallet}:${props.setupId}:${props.approvalId}:${props.club?'club':'athlete'}`} {...props}/>;
}
function ClaimQueue({connection,wallet,setupId,approvalId,disabled=false,requestedClaimId=null,club=false}:Props){
 const [items,setItems]=useState<HostedClaimQueue['items']>([]),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const alive=useRef(false),flight=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function load(after:string|null){if(flight.current)return;flight.current=true;setBusy(true);setFailed(false);setSelected(null);if(after===null)setItems([]);
  try{const page=await getControllerClaims(connection.request,approvalId,after,club);if(alive.current&&connection.isCurrent()){setItems(old=>after?[...old,...page.items]:page.items);setCursor(page.nextCursor);if(requestedClaimId&&page.items.some(i=>i.id===requestedClaimId))setSelected(requestedClaimId);}}
  catch{if(alive.current){setItems([]);setCursor(null);setFailed(true);}}
  finally{flight.current=false;if(alive.current)setBusy(false);}}
 useEffect(()=>{void load(null);},[]); // eslint-disable-line react-hooks/exhaustive-deps
 return <section className={s.card} aria-label={club?"Club claim payments":"Recipient claim payments"}><h3>{club?"Club claim payments":"Recipient claim payments"}</h3><p>Recipient consent and controller approval are separate. Payment needs a verified testnet receipt.</p>
  <button className={s.secondary} disabled={busy||disabled} onClick={()=>void load(null)}>Refresh recipient claims</button>
  {failed?<p role="alert">Private claims could not be verified. Refresh before continuing.</p>:busy&&!items.length?<p role="status">Loading recipient claims…</p>:!items.length?<p>No recipient requests for this award version yet.</p>:<ul>{items.map(item=><li key={item.id}><strong>{setupAmount(BigInt(item.amountWei),false)} test MON</strong> · <span className={s.address}>{item.address}</span>{' '}<button className={s.secondary} disabled={busy||disabled} onClick={()=>setSelected(item.id)}>{item.paid?'View verified payment':'Review claim'}</button></li>)}</ul>}
  {cursor&&!failed?<button className={s.secondary} disabled={busy||disabled} onClick={()=>void load(cursor)}>Load more recipient claims</button>:null}
  {selected&&!failed&&!disabled?<RewardClaimDialog club={club} hr={false} onClose={()=>void load(null)}>{onBusy=><NativeClaimDetail key={selected} club={club} connection={connection} wallet={wallet} setupId={setupId} approvalId={approvalId} id={selected} onBusy={onBusy}/>}</RewardClaimDialog>:null}
 </section>;
}
export function NativeClaimDetail({connection,wallet,setupId,approvalId,id,onBusy,club=false}:Omit<Props,'disabled'>&{id:string;onBusy?:(busy:boolean)=>void}){
 const [view,setView]=useState<SponsorClaim|SponsorClubClaim|null>(null),[job,setJob]=useState<ControllerJob|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),[ack,setAck]=useState(false),[paymentAck,setPaymentAck]=useState(false);
 const kind=club?'clubClaim':'claim';
 const alive=useRef(false),flight=useRef(false),signature=useRef<{message:string;signature:string}|null>(null);
 const active=()=>alive.current&&connection.isCurrent();
 const read=(body?:unknown)=>requestControllerClaim(connection.request,wallet,id,approvalId,body,club);
 function validJob(value:unknown){const j=controllerJobSchema.parse(value),c=j.context;if(c.kind!==kind||c.claimId!==id||c.setupId!==setupId||c.approvalId!==approvalId)throw Error('invalid_claim');return j;}
 async function load(){setView(null);setAck(false);setPaymentAck(false);const v=await read();
  const status=await connection.request('/transactions') as {pending?:unknown};
  let pending:ControllerJob|null=null;if(status?.pending){const p=controllerJobSchema.parse(status.pending);if(p.context.kind===kind&&p.context.claimId===id)pending=validJob(p);}
  if(active()){setView(v);setJob(pending);if(!v.signing)signature.current=null;}}
 async function run(task:()=>Promise<void>){if(flight.current)return;flight.current=true;setBusy(true);setError(false);
  try{await task();}catch{if(active()){setView(null);setAck(false);setPaymentAck(false);setError(true);}}
  finally{flight.current=false;if(active())setBusy(false);}}
 useEffect(()=>{alive.current=true;void run(load);return()=>{alive.current=false;};},[]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{onBusy?.(busy);},[busy,onBusy]);
 async function approve(){if(!view?.signing||!ack||!active())return;const fresh=await read();
  const message=JSON.stringify(fresh.signing);if(message!==JSON.stringify(view.signing)||!fresh.current||fresh.status!=='awaiting_operator')throw Error('invalid_claim');
  if(signature.current?.message!==message){const selected=await connection.getWallet(wallet);if(!active()||selected.address!==wallet)throw Error('controller_session_changed');
   const signed=await signProgrammeClaim(selected.provider,fresh,active);if(!active())throw Error('controller_session_changed');signature.current={message,signature:signed};}
  if(!active())throw Error('controller_session_changed');
  const saved=await read({action:'operator',signature:signature.current.signature});if(active()){signature.current=null;setAck(false);setView(saved);}}
 async function prepare(){if(!view?.transaction||!active())return;
  const j=validJob(await connection.request('/transactions',{action:'prepare',kind,claimId:id,expectedSourceStamp:view.sourceStamp,expectedProfileFingerprint:view.profileFingerprint}));
  if(j.transaction.to!==view.transaction.to||j.transaction.data!==view.transaction.data)throw Error('invalid_claim');
  if(active()){setJob(j);setPaymentAck(false);}}
 async function pay(){if(!job||!view||!paymentAck||!active())return;
  const checked=validJob(await connection.request('/transactions',{action:'prepare',kind,claimId:id,expectedSourceStamp:view.sourceStamp,expectedProfileFingerprint:view.profileFingerprint}));
  if(!active()||checked.context.kind!==kind||job.context.kind!==kind||checked.id!==job.id||JSON.stringify(checked.transaction)!==JSON.stringify(job.transaction)||checked.context.source!==job.context.source)throw Error('controller_session_changed');
  const sent=validJob(await confirmControllerJob(connection,wallet,checked));if(active()){setJob(sent);setPaymentAck(false);}}
 async function verify(){if(!job||!active())return;const next=validJob(await connection.request('/transactions',{action:'resume',id:job.id}));
  if(active()){setJob(next);if(next.confirmed){const current=await read();if(active())setView(current);}}}
 const pending=job?.hash&&!job.confirmed?job.hash:null;
 return <section className={s.card}><h3>Controller claim review</h3><button className={s.secondary} disabled={busy} onClick={()=>void run(load)}>Refresh claim status</button>
  {error?<p role="alert">The claim changed or could not be verified. Refresh before continuing. Saved transactions remain in Controller settings & gas.</p>:null}
  {view?<><RewardClaimProgress club={club} view={view} pending={pending} hr={false}/>{view.claim?<p><strong>{setupAmount(BigInt(view.claim.amount),false)} test MON</strong></p>:null}<p className={s.address}>{view.address}</p>
   {view.status==='held'?<p role="status">On hold · reward remains reserved</p>:view.status==='paid'?<p role="status">Payment confirmed</p>:view.status==='awaiting_consent'?<p role="status">Waiting for recipient consent</p>:view.status==='awaiting_review'?<p role="status">Waiting for readiness review</p>:null}
   {view.current&&view.signing&&view.status==='awaiting_operator'?<><label><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>I approve this exact recipient and reward.</label><button className={s.primary} disabled={busy||!ack||!connection.wallets.includes(wallet)} onClick={()=>void run(approve)}>Sign operator approval · Privy</button></>:null}
   {view.current&&view.transaction&&!job?<button className={s.secondary} disabled={busy||!connection.signTransaction} onClick={()=>void run(prepare)}>Prepare exact payment</button>:null}
   {view.receipt?<p className={s.address}>Verified transaction: {view.receipt.transactionHash}</p>:null}
  </>:null}
  {job&&!job.confirmed?<div><p>Maximum gas fee: {setupAmount(BigInt(job.transaction.gas)*BigInt(job.transaction.gasPrice),false)} test MON. Prize funds are separate.</p>
   {!job.hash?<><label><input type="checkbox" checked={paymentAck} disabled={busy} onChange={e=>setPaymentAck(e.target.checked)}/>I confirm this payment and its maximum gas fee.</label><button className={s.primary} disabled={busy||!paymentAck||!view?.current||view.status!=='ready_to_pay'} onClick={()=>void run(pay)}>Pay exact reward · Privy</button></>:<><p className={s.address}>{job.hash}</p><button className={s.secondary} disabled={busy} onClick={()=>void run(verify)}>Verify payment receipt</button></>}
  </div>:null}
 </section>;
}
