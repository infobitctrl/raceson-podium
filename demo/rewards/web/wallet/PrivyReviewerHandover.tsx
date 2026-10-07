'use client';
import {useEffect,useRef,useState} from 'react';
import {usePrivy,type PrivyClientConfig} from '@privy-io/react-auth';
import PrivyUiProvider from './PrivyUiProvider';
import {readReviewWalletHandover,type ReviewWalletHandover} from '@/features/rewards/data/reviewWalletHandover';
import type {HostedUploadScope} from '@/features/rewards/data/hostedAwardUpload';
import s from '@/features/rewards/screens/RewardsControl.module.css';
import {publicEnv} from '@/lib/public-env';
import {ApiError} from '@/lib/api';
const config:PrivyClientConfig={embeddedWallets:{ethereum:{createOnLogin:'off'},solana:{createOnLogin:'off'},showWalletUIs:true}};
function handoverFailure(error:unknown){
 if(error instanceof ApiError){
  if(error.status===401)return 'Your reviewer session has expired. Return to award review and sign in as Reviewer again.';
  if(error.status===403)return 'This account cannot view wallet access. Return to award review and switch to Reviewer.';
 }
 return 'Wallet status could not be checked. Refresh wallet status before continuing.';
}
function Handover({scope}:{scope:HostedUploadScope}){
 const privy=usePrivy();
 const [view,setView]=useState<ReviewWalletHandover|null>(null),[busy,setBusy]=useState(false),[failure,setFailure]=useState<ReturnType<typeof handoverFailure>|null>(null),[reload,setReload]=useState(0);
 const epoch=useRef(0),locked=useRef(false);
 useEffect(()=>{const generation=++epoch.current;setFailure(null);setView(null);void readReviewWalletHandover(scope).then(v=>{if(epoch.current===generation)setView(v);}).catch(error=>{if(epoch.current===generation)setFailure(handoverFailure(error));});return()=>{epoch.current=generation+1;};},[scope,reload]);
 async function acknowledge(){if(locked.current||!view?.requestId)return;locked.current=true;setBusy(true);setFailure(null);const generation=epoch.current;try{const result=await readReviewWalletHandover(scope,{action:'acknowledge',requestId:view.requestId,expectedFingerprint:view.fingerprint});if(epoch.current===generation)setView(result);}catch(error){if(epoch.current===generation)setFailure(handoverFailure(error));}finally{locked.current=false;if(epoch.current===generation)setBusy(false);}}
 async function back(){await privy.logout();window.location.assign(`/rewards/review/${encodeURIComponent(scope.id)}?slot=${scope.slot}`);}
 return <main className={s.page}><p>Monad testnet · test MON</p><section className={s.card}><h1>Reviewer wallet access</h1>
 {view?<><p className={s.address}>Rewards wallet: {view.operator}</p><p>Recipient: your signed-in reviewer account</p><details><summary>Wallet ownership details</summary><p className={s.address}>{view.reviewerSubject??'Connect the reviewer account first'}</p></details>
 {view.status==='owned'?<><p role="status">{view.acknowledgementRequired?'Wallet ownership changed. Finish saving the handover to retire the previous account.':'The reviewer owns this rewards wallet.'}</p>{view.acknowledgementRequired?<button className={s.primary} disabled={busy} onClick={()=>void acknowledge()}>Finish ownership handover</button>:<button className={s.primary} onClick={()=>void back()}>Return to award review</button>}</>:<><p role="status">Ownership handover is unavailable. Privy does not support transferring this wallet through the current sign-in flow. Reconnecting or retrying will not resolve it.</p><p>The reviewer cannot publish awards with this wallet yet. A supported access setup is required.</p></>}</>:null}
 {failure?<p role="alert">{failure}</p>:null}
 <button className={s.secondary} disabled={busy} onClick={()=>setReload(n=>n+1)}>Refresh wallet status</button><a className={s.secondary} href="/rewards/review">Back to review</a>
 </section></main>;
}
export default function PrivyReviewerHandover(){
 const [scope,setScope]=useState<HostedUploadScope|null>(null),[invalid,setInvalid]=useState(false);
 useEffect(()=>{const q=new URLSearchParams(window.location.search),id=q.get('setup'),approvalId=q.get('approval'),slot=Number(q.get('slot'));const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if([...q].length!==3||!id||!approvalId||!uuid.test(id)||!uuid.test(approvalId)||!q.has('slot')||!Number.isInteger(slot)||slot<0||slot>5){setInvalid(true);return;}setScope({id,approvalId,slot});},[]);
 const appId=process.env.NEXT_PUBLIC_RACESON_REWARD_PRIVY_APP_ID;
 if(invalid||!appId||publicEnv.rewardDemo?.chainId!==10143)return <main className={s.page}><p role="alert">Open the wallet handover from the current award review.</p><a href="/rewards/review">Back to review</a></main>;
 return scope?<PrivyUiProvider appId={appId} config={config}><Handover scope={scope}/></PrivyUiProvider>:<p role="status">Loading wallet handover…</p>;
}
