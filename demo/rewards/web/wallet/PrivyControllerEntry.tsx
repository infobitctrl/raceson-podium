"use client";
import {useMemo,useRef,useState,useLayoutEffect,useEffect} from "react";
import {usePrivy,useWallets,useCreateWallet,useSignTransaction,useSigners,type PrivyClientConfig} from "@privy-io/react-auth";
import PrivyUiProvider from "./PrivyUiProvider";
import RewardsControl,{ControlShell,type ControllerConnection} from "@/features/rewards/screens/RewardsControl";
import {createControllerRequest} from "@/features/rewards/data/controller";
import {publicEnv} from "@/lib/public-env";
import type {RewardWalletProvider} from "@/features/rewards/data/browserWallet";
import {ArrowRight} from "lucide-react";
import s from "@/features/rewards/screens/RewardsControl.module.css";

const chain={id:10143,name:"Monad Testnet",nativeCurrency:{name:"MON",symbol:"MON",decimals:18},rpcUrls:{default:{http:["https://testnet-rpc.monad.xyz"]}}};
// Use the app's enabled login methods rather than advertising disabled providers.
const config:PrivyClientConfig={defaultChain:chain,supportedChains:[chain],
  embeddedWallets:{ethereum:{createOnLogin:"off"},solana:{createOnLogin:"off"},showWalletUIs:true}};

function WalletLoading({onRetry,onSwitch,unavailable=false,connecting=false}:{onRetry:()=>void;onSwitch?:()=>void;unavailable?:boolean;connecting?:boolean}){
  const [delayed,setDelayed]=useState(false);
  useEffect(()=>{const timer=setTimeout(()=>setDelayed(true),15_000);return()=>clearTimeout(timer);},[]);
  const recover=unavailable||delayed;
  return <section className={`${s.card} ${s.login}`}><h2 role="status">{recover?"Wallet connection paused":connecting?"Connecting to Privy…":"Connecting your controller wallet…"}</h2>
    <p>{recover?"Privy hasn’t connected your wallet. Retry the connection to continue with your existing account.":"Waiting for Privy to finish connecting."}</p>
    {recover?<div className={s.row}><button className={s.primary} onClick={onRetry}>Retry connection</button>{onSwitch?<button className={s.secondary} onClick={onSwitch}>Switch Privy account</button>:null}</div>:null}</section>;
}

function Account({onRetry}:{onRetry:()=>void}){
  const {signTransaction}=useSignTransaction(),{addSigners}=useSigners();
  const privy=usePrivy(),wallets=useWallets(),{createWallet}=useCreateWallet(),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const custom=Boolean(privy.user?.linkedAccounts.some(a=>a.type==="custom_auth"));
  const embedded=wallets.wallets.filter(w=>w.walletClientType==="privy"&&w.connectorType==="embedded"&&w.linked&&!w.imported);
  const hasLinkedEmbedded=privy.user?.linkedAccounts.some(a=>a.type==="wallet"&&a.chainType==="ethereum"&&a.walletClientType==="privy")===true;
  const key=`${privy.user?.id??""}:${embedded.map(w=>w.address.toLowerCase()).sort().join(":")}:${custom}:${privy.authenticated}:${wallets.ready}`;
  const retired=useRef<string|null>(null);
  const epoch=useRef({key,value:0});if(epoch.current.key!==key)epoch.current={key,value:epoch.current.value+1};
  const current=useRef({key,privy,embedded,mounted:true,signTransaction,addSigners});current.current={key,privy,embedded,mounted:true,signTransaction,addSigners};
  // Restore liveness before child request effects, including Strict Mode replay.
  // Actual unmounts still invalidate pending token/provider work.
  useLayoutEffect(()=>{current.current.mounted=true;return()=>{current.current.mounted=false;};},[]);
  const connection=useMemo<ControllerConnection|null>(()=>{
    if(!privy.ready||!privy.authenticated||!privy.user||!wallets.ready||custom)return null;
    const generation=epoch.current.value;
    const active=()=>epoch.current.value===generation&&retired.current!==key&&current.current.mounted&&current.current.key===key&&current.current.privy.authenticated;
    return{subject:privy.user.id,wallets:embedded.map(w=>w.address.toLowerCase()),isCurrent:active,
      signTransaction:async(address,tx)=>{
        if(!active()||!current.current.embedded.some(w=>w.address.toLowerCase()===address))throw Error('controller_session_changed');
        const {signature}=await current.current.signTransaction({chainId:10143,type:0,...(tx.to?{to:tx.to}:{}),data:tx.data,value:0n,nonce:Number(tx.nonce),gasLimit:BigInt(tx.gas),gasPrice:BigInt(tx.gasPrice)},{address,uiOptions:{showWalletUIs:true}});
        if(!active())throw Error('controller_session_changed');return signature;
      },addSigner:async(address,signerId,policyId)=>{
        if(!active())throw Error('controller_session_changed');await current.current.addSigners({address,signers:[{signerId,policyIds:[policyId]}]});if(!active())throw Error('controller_session_changed');
      },request:createControllerRequest(()=>current.current.privy.getAccessToken(),active,new URLSearchParams(window.location.search).get('wallet')??undefined),getWallet:async address=>{
        const selected=current.current.embedded.find(w=>w.address.toLowerCase()===address);
        if(!active()||!selected)throw Error("controller_session_changed");
        await selected.switchChain(10143);if(!active())throw Error("controller_session_changed");
        const provider=await selected.getEthereumProvider();if(!active())throw Error("controller_session_changed");
        return{address:selected.address.toLowerCase(),provider:provider as RewardWalletProvider};
      }};
  // A changed identity or wallet set retires all in-flight requests and signers.
  },[key,privy.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(action:()=>Promise<unknown>){if(busy)return;setBusy(true);setError(null);try{await action();}catch{setError("Privy could not complete this action. Try again.");}finally{setBusy(false);}}
  if(!privy.ready)return <WalletLoading key="privy" connecting onRetry={onRetry}/>;
  if(custom)return <section className={`${s.card} ${s.login}`}><h2>Use your controller account</h2><p>This browser currently has a sponsor or athlete wallet session. Switch Privy accounts to enter Control. Your RacesOn login stays separate.</p><button className={s.primary} disabled={busy} onClick={()=>void run(()=>privy.logout())}>Switch Privy account</button>{error?<p role="alert">{error}</p>:null}</section>;
  if(!privy.authenticated)return <section className={`${s.card} ${s.login}`}><h2>Sign in to Control</h2><p>Use the dedicated RacesOn controller account. No platform account is required.</p><button className={s.primary} onClick={()=>privy.login()}>Sign in with Privy</button><p>Signing in does not move funds or approve a distribution.</p></section>;
  if(!wallets.ready||(!embedded.length&&hasLinkedEmbedded))return <><WalletLoading key={privy.user?.id} onRetry={onRetry} onSwitch={busy?undefined:()=>void run(()=>privy.logout())} unavailable={wallets.ready&&hasLinkedEmbedded}/>{error?<p role="alert">{error}</p>:null}</>;
  return <>{!embedded.length?<section className={s.card}><h2>Create your controller wallet</h2><p className={s.address}>{privy.user?.id}</p><p>Create one Privy wallet for controller gas and contract approvals. The owner must designate this account before it can operate campaigns.</p><div className={s.row}><button className={s.primary} disabled={busy} onClick={()=>void run(()=>createWallet())}>Create controller wallet · Privy</button><button className={s.secondary} disabled={busy} onClick={()=>void run(()=>privy.logout())}>Switch Privy account</button></div>{error?<p role="alert">{error}</p>:null}</section>:connection?<RewardsControl key={key} connection={connection} onLogout={()=>{retired.current=key;void run(()=>privy.logout());}}/>:null}</>;
}

/** Separate route composition: no Supabase AuthProvider or custom-JWT runtime. */
export default function PrivyControllerEntry(){
  const [enabled,setEnabled]=useState(false),[attempt,setAttempt]=useState(0),appId=process.env.NEXT_PUBLIC_RACESON_REWARD_PRIVY_APP_ID;
  const available=Boolean(appId&&publicEnv.rewardDemo?.chainId===10143&&publicEnv.rewardPortalEnabled);
  return <ControlShell>{enabled&&available?<PrivyUiProvider key={attempt} appId={appId!} config={config}><Account onRetry={()=>setAttempt(a=>a+1)}/></PrivyUiProvider>:<section className={s.entryLayout} aria-label="Controller access"><div className={s.entryAccess}><h2>Controller sign-in required</h2><p>Use the Privy account assigned to your campaigns.</p><button className={s.primary} disabled={!available} onClick={()=>setEnabled(true)}>Continue with Privy <ArrowRight size={18}/></button>{!available?<p role="status">Privy Control requires the configured Monad testnet demo.</p>:<p className={s.entryNote}>Independent controller login · no RacesOn account required</p>}</div></section>}</ControlShell>;
}
