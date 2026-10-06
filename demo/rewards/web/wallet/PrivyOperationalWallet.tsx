"use client";
import {useI18n} from "@/shared/i18n/I18nContext";
import {walletAdminText} from "@/features/rewards/model/walletAdministrationCopy";
import {useEffect,useRef,useState} from 'react';
import {usePrivy,useCreateWallet,useSigners,type PrivyClientConfig} from '@privy-io/react-auth';
import PrivyUiProvider from './PrivyUiProvider';
import type {OperationalWalletProps} from '@/features/rewards/components/OperationalWalletRuntime';
import s from '@/features/rewards/screens/RewardsControl.module.css';
import a from '@/features/rewards/screens/WalletAdministration.module.css';

const chain={id:10143,name:'Monad Testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:['https://testnet-rpc.monad.xyz']}}};
// Use the app's enabled login methods rather than advertising disabled providers.
const config:PrivyClientConfig={defaultChain:chain,supportedChains:[chain],embeddedWallets:{ethereum:{createOnLogin:'off'},solana:{createOnLogin:'off'},showWalletUIs:true}};
type Candidate={id?:string|null;address:string};

function Owner(props:OperationalWalletProps){
 const {locale}=useI18n(),tr=(text:string)=>walletAdminText(locale,text);
 const {preparation,onSelected,onBusy}=props;
 const controller=preparation.role==='controller',currentAddress=preparation.currentWalletAddress??preparation.deployment.address;
 const privy=usePrivy(),{createWallet}=useCreateWallet(),{addSigners}=useSigners();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[candidate,setCandidate]=useState<Candidate|null>(null),[granted,setGranted]=useState(false),[accepted,setAccepted]=useState(false),[uncertain,setUncertain]=useState(false);
 const custom=privy.user?.linkedAccounts.some(account=>account.type==='custom_auth')===true;
 const allowed=privy.ready&&privy.authenticated&&!custom&&privy.user?.id===preparation.ownerSubject;
 const current=useRef({allowed,subject:privy.user?.id,mounted:true});current.current.allowed=allowed;current.current.subject=privy.user?.id;
 const locked=useRef(false);
 useEffect(()=>{const state=current.current;state.mounted=true;onSelected('');onBusy(false);return()=>{state.mounted=false;};},[onSelected,onBusy]);
 const wallets=privy.user?.linkedAccounts.filter(account=>account.type==='wallet'&&account.chainType==='ethereum'&&account.walletClientType==='privy'&&account.connectorType==='embedded'&&!account.imported)??[];
 const alternatives=wallets.filter(wallet=>wallet.type==='wallet'&&wallet.address.toLowerCase()!==currentAddress&&(!controller||wallet.address.toLowerCase()!==preparation.deployment.address));
 const selected=candidate?alternatives.find(wallet=>wallet.type==='wallet'&&wallet.address.toLowerCase()===candidate.address.toLowerCase()):undefined;
 const selectedId=selected?.type==='wallet'?selected.id??candidate?.id:candidate?.id;
 function choose(next:Candidate|null){setCandidate(next);setGranted(false);setAccepted(false);onSelected('');setError('');}
 async function run(action:(active:()=>boolean)=>Promise<void>,requiresOwner=true){
  if(locked.current||requiresOwner&&!allowed)return;
  const subject=privy.user?.id;
  const active=()=>current.current.mounted&&current.current.subject===subject&&(!requiresOwner||current.current.allowed);
  locked.current=true;setBusy(true);onBusy(true);setError('');
  try{await action(active);}catch{if(active())setError('Privy did not confirm this step. Check the wallets below before trying again. Nothing has been activated.');}
  finally{locked.current=false;if(current.current.mounted){setBusy(false);onBusy(false);}}
 }
 if(!privy.ready)return <p role="status">{tr("Connecting to Privy…")}</p>;
 if(!privy.authenticated)return <><p>{controller?(locale==='hr'?'Povežite Privy račun trenutačnog kontrolora. Vaša Podium prijava ostaje odvojena.':'Connect the current controller’s native Privy account. Your Podium login remains separate.'):tr("Connect the native Privy account that owns the deployment policy. Your Podium login remains separate.")}</p><button className={s.primary} onClick={()=>privy.login()}>{tr("Sign in with Privy")}</button></>;
 if(!allowed)return <><p role="status">{custom?tr("This is a sponsor or athlete wallet session. Switch to the native deployment-owner account."):controller?(locale==='hr'?'Ovaj račun nije vlasnik trenutačnog kontrolora. Prebacite se na njegov račun.':'This Privy account does not own the current controller. Switch to its owner to create a replacement.'):tr("This Privy account does not own the current deployment policy. Switch to its owner to create a replacement.")}</p><button className={s.secondary} disabled={busy} onClick={()=>void run(async()=>{await privy.logout();},false)}>{tr("Switch Privy account")}</button>{error?<p role="alert">{tr(error)}</p>:null}</>;
 return <>
  <p className={s.verified}>{controller?(locale==='hr'?'Povezani ste s vlasnikom trenutačnog kontrolora.':'Connected to the current controller’s owner.'):tr("Connected to the deployment policy’s owner.")}</p>
  <button className={s.primary} disabled={busy||Boolean(candidate)||uncertain} onClick={()=>void run(async active=>{
   // No automatic retry: a timeout may still have created a wallet at Privy.
   setUncertain(true);
   const created=await createWallet(wallets.length?{createAdditional:true}:undefined);
   if(!active())return;
   if(created.chainType!=='ethereum'||created.walletClientType!=='privy'||created.connectorType!=='embedded'||created.imported||created.address.toLowerCase()===currentAddress)throw Error('native_wallet_required');
   choose({id:created.id,address:created.address.toLowerCase()});setUncertain(false);
  })}>{controller?(locale==='hr'?'Izradi novčanik kontrolora':'Create controller wallet'):tr("Create deployment wallet")} · Privy</button>
  {uncertain?<p role="status">{tr("Creation has been requested. If no wallet appears, reconnect this Privy account to refresh its wallet list before creating another.")}</p>:null}
  {alternatives.length?<label className={s.field}>{tr("Or use another wallet on this account")}<select disabled={busy} value={candidate?.address??''} onChange={event=>{
   const wallet=alternatives.find(item=>item.type==='wallet'&&item.address.toLowerCase()===event.target.value);
   if(wallet?.type==='wallet')choose({id:wallet.id,address:wallet.address.toLowerCase()});else choose(null);
  }}><option value="">{tr("Choose a wallet")}</option>{alternatives.map(wallet=>wallet.type==='wallet'?<option key={wallet.address} value={wallet.address.toLowerCase()}>{wallet.address}</option>:null)}</select></label>:null}
  {candidate?<div><p>{tr("Replacement wallet")}</p><p className={a.address}>{candidate.address}</p>
   {!controller?<><p>{tr("Allow Podium’s deployment service to call the approved factory on Monad testnet (10143), with zero MON transferred by the call. Gas is paid from this wallet.")}</p>
   <details><summary>{tr("View restricted permission")}</summary><p>{locale==='hr'?'Tvornica':'Factory'}: <code>{preparation.deployment.factory}</code></p><p>{locale==='hr'?'Potpisnik':'Signer'}: <code>{preparation.deployment.signerId}</code></p><p>{locale==='hr'?'Pravila':'Policy'}: <code>{preparation.deployment.policyId}</code></p></details>
   <label className={a.confirm}><input type="checkbox" checked={accepted} disabled={busy||granted} onChange={event=>setAccepted(event.target.checked)}/>{tr("I approve this restricted campaign-creation permission for the displayed wallet.")}</label>
   <button className={s.secondary} disabled={busy||!accepted||granted} onClick={()=>void run(async active=>{
    const result=await addSigners({address:candidate.address,signers:[{signerId:preparation.deployment.signerId,policyIds:[preparation.deployment.policyId]}]});
    if(!active())return;
    const wallet=result.user.linkedAccounts.find(item=>item.type==='wallet'&&item.address.toLowerCase()===candidate.address.toLowerCase());
    if(wallet?.type==='wallet'&&wallet.id)setCandidate({address:candidate.address,id:wallet.id});
    setGranted(true);
   })}>{granted?tr("Permission submitted"):tr("Approve restricted access in Privy")}</button>
   {granted?<p role="status">{tr("Privy confirmed the permission request. Podium will independently verify it before activation.")}</p>:null}
   </>:<p>{locale==='hr'?'Samo vi potpisujete ovim novčanikom. Administrator mora odvojeno pregledati i aktivirati ovlast kontrolora.':'Only you sign with this wallet. The administrator must separately review and activate controller authority.'}</p>}
   <button className={s.primary} disabled={busy||(!controller&&!granted)||!selectedId} onClick={()=>onSelected(selectedId!)}>{tr("Use this wallet for verification")}</button>
   {(granted||controller)&&!selectedId?<p role="status">{tr("Waiting for Privy’s wallet ID. Reconnect to refresh this wallet; do not create another.")}</p>:null}
  </div>:null}
  <button className={s.secondary} disabled={busy} onClick={()=>void run(async()=>{onSelected('');await privy.logout();},false)}>{tr("Switch Privy account")}</button>
  {busy?<p role="status">{tr("Waiting for Privy…")}</p>:null}{error?<p role="alert">{tr(error)}</p>:null}
 </>;
}
function Session(props:OperationalWalletProps){const {user,authenticated}=usePrivy();return <Owner key={`${user?.id??'guest'}:${authenticated}`} {...props}/>;}
export default function PrivyOperationalWallet(props:OperationalWalletProps){
 return <PrivyUiProvider appId={props.preparation.deployment.appId} config={config}><Session {...props}/></PrivyUiProvider>;
}
