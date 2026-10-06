import {useEffect,useRef,useState} from 'react';
import {formatEther} from 'viem';
import {sponsorSettlementDataV4} from '@raceson/rewards-chain';
import {decodeControllerSettlement,type ControllerSettlement as View} from '../data/controllerSettlement';
import {controllerJobSchema,confirmControllerJob,recoverControllerJob,type ControllerJob} from '../data/controllerTransactions';
import type {ControllerConnection} from './RewardsControl';
import RewardExplorerLink from '../components/RewardExplorerLink';
import s from './RewardsControl.module.css';
const labels={close:'Close expired claims',returnUnallocated:'Return unallocated prizes',returnExpired:'Return expired awards'};
type Props={connection:ControllerConnection;wallet:string;setupId:string;slot:number;disabled?:boolean};
export default function ControllerSettlement(props:Props){return <Settlement key={`${props.connection.subject}:${props.wallet}:${props.setupId}:${props.slot}`} {...props}/>;}
function Settlement({connection,wallet,setupId,slot,disabled=false}:Props){
 const [view,setView]=useState<View|null>(null),[job,setJob]=useState<ControllerJob|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[ack,setAck]=useState(false),[hash,setHash]=useState(''),[operation,setOperation]=useState<keyof typeof labels>('close');
 const alive=useRef(false),flight=useRef(false),path=`/campaigns/${setupId}/settlement/${slot}`;
 const active=()=>alive.current&&connection.isCurrent();
 function validJob(raw:unknown,v:View){const j=controllerJobSchema.parse(raw),c=j.context,p=v.pot,l=v.lanes;
  if(c.kind!=='settlement'||c.setupId!==setupId||c.slot!==slot||!p||!l||j.transaction.to!==p.address||j.transaction.data!==sponsorSettlementDataV4(c.action))throw Error('controller_transaction_invalid');
  const lane=c.action==='returnUnallocated'?l.unallocated:l.expired;
  if(c.amountWei!==(c.action==='close'?'0':lane.originalWei)||c.recipient!==(c.action==='close'?null:lane.recipient))throw Error('controller_transaction_invalid');return j;
 }
 async function read(){return decodeControllerSettlement(await connection.request(path),setupId,slot,wallet);}
 async function load(){setView(null);setAck(false);const v=await read(),status=await connection.request('/transactions') as {pending?:unknown};let pending:ControllerJob|null=null;
  if(status?.pending){const j=controllerJobSchema.parse(status.pending);if(j.context.kind==='settlement'&&j.context.setupId===setupId&&j.context.slot===slot)pending=validJob(j,v);}
  if(active()){setView(v);setJob(pending);}}
 async function run(task:()=>Promise<void>){if(flight.current)return;flight.current=true;setBusy(true);setError(null);
  try{await task();}catch(e){if(active()){setAck(false);setError(e instanceof Error?e.message:'unavailable');}}
  finally{flight.current=false;if(active())setBusy(false);}}
 useEffect(()=>{alive.current=true;void run(load);return()=>{alive.current=false;};},[]); // eslint-disable-line react-hooks/exhaustive-deps
 async function prepare(action:keyof typeof labels){if(!view||!active())return;setAck(false);
  const j=validJob(await connection.request('/transactions',{action:'prepare',kind:'settlement',setupId,slot,operation:action,expectedSourceHash:view.sourceHash}),view);
  if(j.context.kind!=='settlement'||j.context.action!==action)throw Error('controller_transaction_invalid');if(active())setJob(j);
 }
 async function confirm(){if(!job||job.context.kind!=='settlement'||!view||!ack||!active())return;
  const fresh=await read();if(!active()||fresh.sourceHash!==view.sourceHash)throw Error('controller_session_changed');
  const checked=validJob(await connection.request('/transactions',{action:'prepare',kind:'settlement',setupId,slot,operation:job.context.action,expectedSourceHash:fresh.sourceHash}),fresh);
  if(!active()||checked.id!==job.id||JSON.stringify(checked.transaction)!==JSON.stringify(job.transaction)||JSON.stringify(checked.context)!==JSON.stringify(job.context))throw Error('controller_transaction_invalid');
  const sent=validJob(await confirmControllerJob(connection,wallet,checked),fresh);if(active()){setJob(sent);setAck(false);if(sent.confirmed)setView(await read());}
 }
 async function recover(){if(!job||!view||!active())return;const result=validJob(await recoverControllerJob(connection,job),view);if(active()){setJob(result);setAck(false);if(result.confirmed)setView(await read());}}
 async function verifyHash(){const v=decodeControllerSettlement(await connection.request(path,{action:'receipt',requestId:crypto.randomUUID(),operation,transactionHash:hash}),setupId,slot,wallet);if(active()){setView(v);setAck(false);setHash('');}}
 const amount=(v:string)=>`${formatEther(BigInt(v))} test MON`,blocked=disabled||busy||!connection.wallets.includes(wallet)||!connection.isCurrent();
 return <section className={`${s.card} ${s.review}`} aria-label="Prize settlement"><span className={s.eyebrow}>After the claim window</span><h3>Prize settlement</h3><p>Close expired claims, then return each remaining balance to its original destination. Paid awards stay paid.</p>
  <button className={s.secondary} disabled={busy||disabled} onClick={()=>void run(load)}>Refresh settlement</button>
  {error?<p role="alert">{error==='controller_wallet_rejected'?'Wallet confirmation cancelled. No transaction was submitted.':error==='controller_local_signature_missing'?'No signature is saved in this browser. Return to the browser where you confirmed, or recover its exact transaction hash. The request stays reserved.':error==='controller_balance_required'?'The controller wallet needs test MON for gas. Prize funds are separate.':'Settlement could not be verified. Refresh before signing. Saved transactions remain in Controller settings & gas.'}</p>:null}
  {busy&&!view?<p role="status">Checking original contract balances…</p>:null}
  {view&&!view.pot?<p>Settlement becomes available after a verified contract and prize deposit.</p>:null}
  {view?.pot&&view.lanes?<><dl><div><dt>Prize deposit</dt><dd>{amount(view.pot.amountWei)}</dd></div><div><dt>Paid awards</dt><dd>{amount(view.pot.paidWei)}</dd></div><div><dt>Claim deadline</dt><dd>{view.pot.claimDeadline==='0'?'Claims have not opened':new Date(Number(view.pot.claimDeadline)*1000).toLocaleString()}</dd></div><div><dt>Contract status</dt><dd>{view.pot.state===4?'Closed':view.pot.state===3?'Claims active':'Distribution pending'}{view.pot.paused?' · Paused':''}</dd></div></dl>
   {Object.entries(view.lanes).map(([name,lane])=><div key={name}><strong>{name==='unallocated'?'Unallocated prizes':'Expired awards'}</strong><p>Remaining: {amount(lane.remainingWei)} · Returned: {amount(lane.returnedWei)}</p><p className={s.address}>Original destination: {lane.recipient}</p></div>)}
   {!view.available.length&&view.pot.state!==4?<p>No settlement action is available at the verified block. Closing requires the claim deadline to pass and the contract to be unpaused.</p>:null}
   {!job||job.confirmed?<div className={s.row}>{view.available.map(o=><button key={o.action} className={s.secondary} disabled={blocked||!connection.signTransaction} onClick={()=>void run(()=>prepare(o.action))}>Review · {labels[o.action]}</button>)}</div>:null}
   <details><summary>Verified network details</summary><p className={s.address}>Campaign: {view.pot.address}</p><p>Block: {view.observedBlock?.number}</p>{view.receipts.map(r=><p key={r.id}>{labels[r.body.action]} · {amount(r.body.amountWei)} <RewardExplorerLink chainId={10143} kind="tx" value={r.body.transactionHash}/></p>)}</details>
  </>:null}
  {job?.context.kind==='settlement'&&!job.confirmed?<div className={s.notice}><strong>{labels[job.context.action]}</strong><p>Prize amount: {amount(job.context.amountWei)}</p>{job.context.recipient?<p className={s.address}>Return to: {job.context.recipient}</p>:null}<p>Maximum gas fee: {amount((BigInt(job.transaction.gas)*BigInt(job.transaction.gasPrice)).toString())}. Paid separately by the controller.</p>
   {job.hash?<><RewardExplorerLink chainId={10143} kind="tx" value={job.hash}/><button className={s.secondary} disabled={blocked} onClick={()=>void run(recover)}>Verify saved settlement</button></>:<><label><input type="checkbox" checked={ack} disabled={blocked} onChange={e=>setAck(e.target.checked)}/>I confirm this action, its original destination and maximum gas fee.</label><button className={s.primary} disabled={blocked||!ack||!view||!connection.signTransaction||!view.available.some(o=>o.action===(job.context.kind==='settlement'?job.context.action:null))} onClick={()=>void run(confirm)}>Confirm settlement · Privy</button><button className={s.secondary} disabled={blocked} onClick={()=>void run(recover)}>Recover saved signature</button></>}
  </div>:null}
  <details className={s.section}><summary>Recover an existing settlement hash</summary><p>Verify the exact original transaction before sending again.</p><label className={s.field}>Settlement transaction hash<input value={hash} onChange={e=>setHash(e.target.value)}/></label><label className={s.field}>Settlement operation<select value={operation} onChange={e=>setOperation(e.target.value as keyof typeof labels)}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button className={s.secondary} disabled={blocked||!/^0x[0-9a-f]{64}$/.test(hash)} onClick={()=>void run(verifyHash)}>Verify existing settlement</button></details>
 </section>;
}
