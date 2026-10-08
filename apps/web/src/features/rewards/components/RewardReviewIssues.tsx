import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Flag,RefreshCw} from 'lucide-react';
import {reviewIssues,type ReviewIssues} from '../data/operations';
import s from './RewardOperations.module.css';

export default function RewardReviewIssues({setupId,slot,contextHash,approved,hr,children,readIssues=reviewIssues}:{setupId:string;slot:number;contextHash:string;approved:boolean;hr:boolean;children:ReactNode;readIssues?:typeof reviewIssues}){
 const [data,setData]=useState<ReviewIssues|null>(null),[editing,setEditing]=useState(false),[description,setDescription]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const flight=useRef(false),mounted=useRef(true),request=useRef<{key:string;id:string}|null>(null);
 const t=(en:string,local:string)=>hr?local:en;
 useEffect(()=>{let active=true;mounted.current=true;setData(null);setError('');void readIssues(setupId,slot).then(v=>{if(active)setData(v);}).catch(()=>{if(active)setError('load');});return()=>{active=false;mounted.current=false;};},[setupId,slot,contextHash,reload,readIssues]);
 async function change(action:'report'|'withdraw',issueId?:string){
  if(!data||flight.current)return;
  const key=JSON.stringify([action,data.revision,description.trim(),issueId]);
  if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
  flight.current=true;setBusy(true);setError('');
  try{const common={requestId:request.current.id,expectedRevision:data.revision};const next=await readIssues(setupId,slot,action==='report'?{...common,action,contextHash:data.contextHash,description:description.trim()}:{...common,action,issueId:issueId!});if(mounted.current){setData(next);setEditing(false);setDescription('');request.current=null;}}
  catch{if(mounted.current)setError('save');}
  finally{flight.current=false;if(mounted.current)setBusy(false);}
 }
 const open=data?.issues.filter(i=>!i.withdrawnAt)??[],history=data?.issues.filter(i=>i.withdrawnAt)??[];
 return <section className={s.issues} aria-label={t('Reviewer decision','Odluka pregledavatelja')}>
 {approved||data&&!open.length&&!busy&&!error?children:null}
 {!data&&!error?<p role="status">{t('Checking reported issues…','Provjera prijavljenih problema…')}</p>:null}
 {error?<div role="alert"><p>{t('Issue status could not be confirmed. Reload before approving or retrying.','Stanje problema nije potvrđeno. Osvježite prije odobrenja ili ponovnog pokušaja.')}</p><button className={s.secondary} disabled={busy} onClick={()=>setReload(v=>v+1)}><RefreshCw size={14}/>{t('Reload issues','Osvježi probleme')}</button></div>:null}
 {open.map(i=><div key={i.id} className={s.flag}><strong><Flag size={16}/>{t('Issue flagged','Problem prijavljen')}</strong><p className={s.description}>{i.description}</p><small>{new Date(i.createdAt).toLocaleString(hr?'hr-HR':'en-GB')}</small>{i.canWithdraw?<button className={s.secondary} disabled={busy} onClick={()=>void change('withdraw',i.id)}>{t('Withdraw flag','Povuci prijavu')}</button>:<p>{t('The reporting reviewer must withdraw this flag before approval.','Pregledavatelj koji je prijavio problem mora povući prijavu prije odobrenja.')}</p>}</div>)}
 {data?.canReport&&!approved&&!open.length&&!error?(editing?<form onSubmit={e=>{e.preventDefault();void change('report');}}><label className={s.field}>{t('Describe the issue','Opišite problem')}<textarea value={description} onChange={e=>setDescription(e.target.value)} disabled={busy} minLength={8} maxLength={2000} required rows={4}/></label><small>{t('Describe the result or allocation to check. Do not include private athlete information.','Opišite rezultat ili raspodjelu koju treba provjeriti. Nemojte uključivati privatne podatke sportaša.')}</small><div className={s.actions}><button className={s.secondary} type="button" disabled={busy} onClick={()=>setEditing(false)}>{t('Cancel','Odustani')}</button><button className={s.primary} disabled={busy||description.trim().length<8}>{busy?t('Saving…','Spremanje…'):t('Submit flag','Pošalji prijavu')}</button></div></form>:<button className={s.secondary} disabled={busy} onClick={()=>setEditing(true)}><Flag size={14}/>{t('Flag an issue','Prijavi problem')}</button>):null}
 {open.length?<p>{t('Approval is on hold until all flags are withdrawn. Official results and reward amounts are unchanged.','Odobrenje je na čekanju dok se sve prijave ne povuku. Službeni rezultati i iznosi nagrada ostaju isti.')}</p>:null}
 {history.length?<details><summary>{t('Issue history','Povijest prijava')} ({history.length})</summary>{history.map(i=><div key={i.id} className={s.history}><p className={s.description}>{i.description}</p><small>{t('Withdrawn','Povučeno')} · {new Date(i.withdrawnAt!).toLocaleString(hr?'hr-HR':'en-GB')}</small></div>)}</details>:null}
 </section>;
}
