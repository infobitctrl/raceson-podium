'use client';
import {useEffect,useRef,useState} from 'react';
import {usePrivy,useAuthorizationSignature,type PrivyClientConfig} from '@privy-io/react-auth';
import PrivyUiProvider from './PrivyUiProvider';
import {readReviewWalletHandover,type ReviewWalletHandover} from '@/features/rewards/data/reviewWalletHandover';
import type {HostedUploadScope} from '@/features/rewards/data/hostedAwardUpload';
import s from '@/features/rewards/screens/RewardsControl.module.css';
import {publicEnv} from '@/lib/public-env';
const config:PrivyClientConfig={embeddedWallets:{ethereum:{createOnLogin:'off'},solana:{createOnLogin:'off'},showWalletUIs:true}};
function Handover({scope}:{scope:HostedUploadScope}){
 const privy=usePrivy(),{generateAuthorizationSignature}=useAuthorizationSignature();
 const [view,setView]=useState<ReviewWalletHandover|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[reload,setReload]=useState(0);
 const epoch=useRef(0),locked=useRef(false),requestId=useRef<string|null>(null);
 const current=useRef({subject:privy.user?.id,authenticated:privy.authenticated});current.current={subject:privy.user?.id,authenticated:privy.authenticated};
 useEffect(()=>{const generation=++epoch.current;setFailed(false);void readReviewWalletHandover(scope).then(v=>{if(epoch.current===generation)setView(v);}).catch(()=>{if(epoch.current===generation)setFailed(true);});return()=>{epoch.current=generation+1;};},[scope,reload]);
 async function transfer(){
  if(locked.current||!view?.body||view.status!=='transfer_required'||!privy.ready||!privy.authenticated||privy.user?.id!==view.ownerSubject)return;
  locked.current=true;setBusy(true);setFailed(false);const generation=epoch.current,subject=view.ownerSubject;
  const active=()=>epoch.current===generation&&current.current.authenticated&&current.current.subject===subject;
  try{
   const latest=await readReviewWalletHandover(scope);if(!active()||latest.fingerprint!==view.fingerprint||latest.ownerSubject!==subject||!latest.body)throw Error('handover_changed');
   const requestExpiry=Date.now()+90000;
   // This signs only the exact provider PATCH. The user sees and explicitly
   // approves the fixed reviewer recipient before any ownership change.
   const {signature}=await generateAuthorizationSignature({version:1,method:'PATCH',url:`https://api.privy.io/v1/wallets/${latest.walletId}`,body:latest.body,headers:{'privy-app-id':latest.appId,'privy-request-expiry':String(requestExpiry)}});
   if(!active())return;const ownerToken=await privy.getAccessToken();if(!active()||!ownerToken)throw Error('owner_session_changed');
   requestId.current??=crypto.randomUUID();
   const result=await readReviewWalletHandover(scope,{action:'transfer',requestId:requestId.current,expectedFingerprint:latest.fingerprint,ownerToken,authorizationSignature:signature,requestExpiry});
   if(active())setView(result);
  }catch{if(epoch.current===generation)setFailed(true);}finally{locked.current=false;if(epoch.current===generation)setBusy(false);}
 }
 async function acknowledge(){if(locked.current||!view?.requestId)return;locked.current=true;setBusy(true);setFailed(false);const generation=epoch.current;try{const result=await readReviewWalletHandover(scope,{action:'acknowledge',requestId:view.requestId,expectedFingerprint:view.fingerprint});if(epoch.current===generation)setView(result);}catch{if(epoch.current===generation)setFailed(true);}finally{locked.current=false;if(epoch.current===generation)setBusy(false);}}
 async function back(){await privy.logout();window.location.assign(`/rewards/review/${encodeURIComponent(scope.id)}?slot=${scope.slot}`);}
 return <main className={s.page}><p>Monad testnet · test MON</p><section className={s.card}><h1>Move rewards execution to the reviewer</h1><p>The current wallet owner hands the existing rewards wallet to the signed-in reviewer. This is a one-time handover. The reviewer then approves and publishes awards from the review page.</p>
 {view?<><p className={s.address}>Rewards wallet: {view.operator}</p><p>Recipient: your signed-in reviewer account</p><details><summary>Wallet ownership details</summary><p className={s.address}>{view.reviewerSubject??'Connect the reviewer account first'}</p></details>
 {view.status==='owned'?<><p role="status">{view.acknowledgementRequired?'Wallet ownership changed. Finish saving the handover to retire the previous account.':'The reviewer owns this rewards wallet.'}</p>{view.acknowledgementRequired?<button className={s.primary} disabled={busy} onClick={()=>void acknowledge()}>Finish ownership handover</button>:<button className={s.primary} onClick={()=>void back()}>Return to award review</button>}</>:view.status==='connect_required'?<a className={s.secondary} href={`/rewards/review/${encodeURIComponent(scope.id)}?slot=${scope.slot}`}>Connect reviewer wallet access in award review</a>:<>
 <p>Handing over this wallet gives the reviewer signing control for its existing reward contracts and test-MON gas balance. The previous account loses wallet control.</p>
 {!privy.ready?<p role="status">Connecting wallet authorization…</p>:!privy.authenticated?<button className={s.primary} onClick={()=>privy.login()}>Current owner: authorize handover</button>:privy.user?.id!==view.ownerSubject?<><p>Sign in as the current rewards-wallet owner for this one-time handover.</p><button className={s.secondary} disabled={busy} onClick={()=>void privy.logout()}>Switch to current wallet owner</button></>:<button className={s.primary} disabled={busy} onClick={()=>void transfer()}>{busy?'Verifying wallet handover…':'Hand over rewards wallet to reviewer'}</button>}
 </>}</>:null}
 {failed?<p role="alert">The handover could not be confirmed. Refresh its status before trying again. A completed ownership change will be recovered.</p>:null}
 <button className={s.secondary} disabled={busy} onClick={()=>setReload(n=>n+1)}>Refresh handover status</button><a className={s.secondary} href="/rewards/review">Back to review</a>
 </section></main>;
}
export default function PrivyReviewerHandover(){
 const [scope,setScope]=useState<HostedUploadScope|null>(null),[invalid,setInvalid]=useState(false);
 useEffect(()=>{const q=new URLSearchParams(window.location.search),id=q.get('setup'),approvalId=q.get('approval'),slot=Number(q.get('slot'));const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if(q.size!==3||!id||!approvalId||!uuid.test(id)||!uuid.test(approvalId)||!q.has('slot')||!Number.isInteger(slot)||slot<0||slot>5){setInvalid(true);return;}setScope({id,approvalId,slot});},[]);
 const appId=process.env.NEXT_PUBLIC_RACESON_REWARD_PRIVY_APP_ID;
 if(invalid||!appId||publicEnv.rewardDemo?.chainId!==10143)return <main className={s.page}><p role="alert">Open the wallet handover from the current award review.</p><a href="/rewards/review">Back to review</a></main>;
 return scope?<PrivyUiProvider appId={appId} config={config}><Handover scope={scope}/></PrivyUiProvider>:<p role="status">Loading wallet handover…</p>;
}
