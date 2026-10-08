import {useI18n} from "@/shared/i18n/I18nContext";
import {walletAdminText} from "../model/walletAdministrationCopy";
import {useEffect,useRef,useState} from "react";
import {RefreshCw,Wallet} from "lucide-react";
import type {ControllerConnection} from "../screens/RewardsControl";
import ReceiveTestMon from './ReceiveTestMon';
import {walletBalanceAmount} from "../model/setupAmount";
import s from "../screens/RewardsControl.module.css";

/** A read-only balance and receive address for the verified controller. */
export default function ControllerWalletCard({connection,address}:{connection:ControllerConnection;address:string}){
 const {locale}=useI18n(),hr=locale==='hr',tr=(text:string)=>walletAdminText(locale,text);
 const [balance,setBalance]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const generation=useRef(0),mounted=useRef(false);
 async function refresh(){
  const ticket=++generation.current;setBusy(true);setError(false);setBalance(null);
  const active=()=>mounted.current&&ticket===generation.current&&connection.isCurrent();
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const read=async()=>{
    const wallet=await connection.getWallet(address);if(!active()||wallet.address!==address)throw Error();
    const chain=await wallet.provider.request({method:"eth_chainId"});if(typeof chain!=="string"||!/^0x[0-9a-f]+$/i.test(chain)||BigInt(chain)!==10143n||!active())throw Error();
    const value=await wallet.provider.request({method:"eth_getBalance",params:[address,"latest"]});
    const after=await wallet.provider.request({method:"eth_chainId"});
    if(!active()||after!==chain||typeof value!=="string"||!/^0x[0-9a-f]+$/i.test(value))throw Error();
    return BigInt(value).toString();
   };
   const value=await Promise.race([read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error()),15000);})]);
   if(active())setBalance(value);
  }catch{if(active())setError(true);}finally{if(timer)clearTimeout(timer);if(active())setBusy(false);}
 }
 useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;generation.current++;};},[connection,address]); // eslint-disable-line react-hooks/exhaustive-deps
 return <section className={`${s.card} ${s.walletCard}`} aria-label={tr("Controller wallet balance")}>
  <div className={s.row}><div><span className={s.eyebrow}>{tr("Operations wallet")}</span><h2><Wallet size={21}/> {tr("Controller funds")}</h2></div><button className={s.secondary} disabled={busy} onClick={()=>void refresh()}><RefreshCw size={15}/>{busy?tr("Checking…"):tr("Refresh balance")}</button></div>
  <strong className={s.walletBalance}>{balance===null?"—":walletBalanceAmount(BigInt(balance),hr)} <small>{tr("test MON")}</small></strong>
  <details className={s.walletExplanation}><summary>{hr?"Namjena sredstava":"What these funds cover"}</summary><p>{tr("Pays explicitly approved distribution fees. Campaign creation uses its configured deployment wallet. These costs never come from sponsor reward pots.")}</p></details>
  {error?<p role="status">{tr("Balance unavailable. Refresh to try again.")}</p>:balance==="0"?<p role="status">{tr("Add test MON to cover campaign fees.")}</p>:null}
  <ReceiveTestMon key={address} address={address} chainId={10143} hr={hr}/>
 </section>;
}
