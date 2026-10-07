import RewardReadiness from "./RewardReadiness";
import roleStyle from "./RewardRoleWorkspace.module.css";
import RewardEmbeddedWalletControls from "./RewardEmbeddedWalletControls";
import {lazy,Suspense,useEffect,useRef,useState} from "react";
import {ArrowRight,Check,LoaderCircle,ShieldCheck,Wallet} from "lucide-react";
import setup from "./RewardWalletSetup.module.css";
import {Button} from "@/components/ui/button";
import {useI18n} from "@/shared/i18n/I18nContext";
import {athleteUxCopy} from "../model/athleteUxCopy";
import type {RewardDestination} from "../model/athleteDestinations";
import {withdrawRewardDestination} from "../data/athleteDestinations";
import RewardExplorerLink from "./RewardExplorerLink";
import RewardDestinationHistory from "./RewardDestinationHistory";
import {workspaceCopy} from "../model/workspaceCopy";
import styles from "./RewardWorkspace.module.css";
import {publicEnv} from "@/lib/public-env";
const WalletPanel=lazy(()=>import("./RewardWalletPanel"));

export default function AthleteProfileWallet(props:{presentation?:"athlete";idPrefix?:string;ready:boolean;failed:boolean;profiles:string[];profileId:string|null;
  onProfile:(id:string)=>void;destinations:RewardDestination[];complete:boolean;refreshing:boolean;
  onRefresh:()=>Promise<void>;onMore:()=>void;}) {
  const {locale,t}=useI18n(),copy=athleteUxCopy(locale);
  return <WalletWorkspace key={props.profileId??"none"} {...props} copy={copy} t={t}/>;
}
function WalletWorkspace({presentation,idPrefix="reward-wallet",ready,failed,profiles,profileId,onProfile,destinations,complete,refreshing,onRefresh,onMore,copy,t}:Parameters<typeof AthleteProfileWallet>[0]&{
  copy:ReturnType<typeof athleteUxCopy>;t:ReturnType<typeof useI18n>["t"];
}) {
  const {locale}=useI18n();
  const [open,setOpen]=useState(false),[replace,setReplace]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  const [access,setAccess]=useState(false);
  const flight=useRef(false),alive=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const chainId=publicEnv.rewardDemo?.mode==="local"?31337:10143;
  const networkDestinations=destinations.filter(d=>d.chainId===chainId);
  const active=ready&&!failed?networkDestinations.filter(d=>d.athleteProfileId===profileId&&d.status!=="withdrawn"):[];
  const current=active.length===1?active[0]:null;
  async function remove(){
    if(!current||!ready||failed||!complete||flight.current||error||refreshing)return;
    flight.current=true;setBusy(true);setError(false);
    try{await withdrawRewardDestination(current.requestId);await onRefresh();if(alive.current){setReplace(false);setOpen(true);}}
    catch{if(alive.current)setError(true);}
    finally{if(alive.current){flight.current=false;setBusy(false);}}
  }
  if(presentation) return <section id={idPrefix} tabIndex={-1} className={setup.workspace} aria-labelledby={`${idPrefix}-title`}>
    <h2 id={`${idPrefix}-title`}>{locale === "hr" ? "Spremnost" : "Readiness"}</h2>
    {ready&&profiles.length>1?<label className={setup.profile}>{copy.profile}<select disabled={busy} value={profileId??""} onChange={e=>onProfile(e.target.value)}>
      <option value="">{copy.choose}</option>{profiles.map(id=><option key={id} value={id}>{id}</option>)}</select></label>:null}
    <div className={setup.card}>
      <div className={setup.intro}><span className={current?.status==="pending_review"?setup.savedIcon:setup.walletIcon}>{current?.status==="pending_review"?<ShieldCheck aria-hidden="true"/>:<Wallet aria-hidden="true"/>}</span>
        <div><h3>{current?(current.status==="identity_hold"?copy.held:copy.saved):(locale==="hr"?"Postavi novčanik":"Set up your wallet")}</h3>
          <p>{current?(locale==="hr"?"Spremnost nagrada provjerava se zasebno.":"Reward readiness is reviewed separately."):(locale==="hr"?"Tri kratka koraka. Nagrade ostaju rezervirane.":"Three quick steps. Your rewards stay reserved.")}</p></div>
      </div>
      {failed?<><p role="status">{copy.unavailable}</p><Button variant="outline" disabled={refreshing} onClick={()=>void onRefresh()}>{copy.refreshWallet}</Button></>:!ready?<p role="status">{copy.loading}</p>:current?<>
        <p className={setup.address}><RewardExplorerLink chainId={current.chainId} kind="address" value={current.address}>{current.address.slice(0,8)}…{current.address.slice(-6)}</RewardExplorerLink></p>
        {current.status==="pending_review"?<p className={setup.proof}><Check aria-hidden="true"/>{locale==="hr"?"Potpis kontrole spremljen":"Wallet-control proof saved"}</p>:null}
        {!replace?<div className={setup.actions}>
          <Button variant="outline" aria-expanded={access} onClick={()=>setAccess(value=>!value)}>{locale==="hr"?"Pristup novčaniku":"Access wallet"}</Button>
          <Button variant="ghost" disabled={!complete||refreshing} onClick={()=>{setAccess(false);setReplace(true);}}>{copy.change}</Button>
        </div>:null}
        {access&&!replace?<RewardEmbeddedWalletControls compact existingAddress={current.address}/>:null}
      </>:null}
      {!current&&!open?<>
        <ol className={setup.preview} aria-label={locale==="hr"?"Koraci postavljanja":"Setup steps"}>
          {[(locale==="hr"?"Novčanik":"Wallet"),(locale==="hr"?"Potvrdi":"Verify"),(locale==="hr"?"Spremi":"Save")].map((label,index)=><li key={label}><span>{index+1}</span>{label}</li>)}
        </ol>
        <Button className={setup.start} disabled={!ready||failed||!profileId||!complete||active.length>0} onClick={()=>setOpen(true)}>{locale==="hr"?"Postavi novčanik":"Set up wallet"}<ArrowRight aria-hidden="true" size={16}/></Button>
        {ready&&!profileId?<p>{copy.choose}</p>:ready&&active.length>1?<p role="status">{locale==="hr"?"Provjeri spremljene novčanike u povijesti.":"Review your saved wallets in history."}</p>:null}
      </>:null}
      {replace&&current?<div className={setup.replace}>
        <p>{copy.replaceHelp}</p>{error?<p role="alert">{copy.failed}</p>:null}
        <div className={setup.actions}><Button aria-busy={busy} disabled={busy||refreshing||error} variant="outline" onClick={()=>void remove()}>{busy?<LoaderCircle aria-hidden="true" className={setup.spinner} size={16}/>:null}{busy?copy.replacing:copy.remove}</Button>
          {error?<Button disabled={refreshing} variant="outline" onClick={()=>void onRefresh().then(()=>{if(alive.current){setError(false);setReplace(false);}})}>{copy.refreshWallet}</Button>:null}
          <Button disabled={busy} variant="ghost" onClick={()=>{setReplace(false);setError(false);}}>{copy.cancel}</Button></div>
      </div>:null}
      {open&&ready&&!failed&&profileId&&active.length===0&&complete?<Suspense fallback={<p role="status">{t("rewards.loading")}</p>}>
        <WalletPanel compact athleteProfileId={profileId} destinations={networkDestinations} destinationsComplete={complete} onDestinationSaved={()=>{setOpen(false);void onRefresh();}}/>
        <Button variant="ghost" onClick={()=>setOpen(false)}>{copy.close}</Button>
      </Suspense>:null}
      {ready&&!complete?<Button variant="outline" disabled={refreshing} onClick={onMore}>{copy.more}</Button>:null}
    </div>
    <details className={setup.history}><summary>{copy.history}</summary>
      {ready&&!failed?<RewardDestinationHistory readOnly items={networkDestinations.filter(d=>!profileId||d.athleteProfileId===profileId)} pending={false} error={null} refreshing={refreshing} hasMore={!complete} onRefresh={()=>void onRefresh()} onMore={onMore}/>:null}
    </details>
  </section>;
  return <section id={idPrefix} tabIndex={-1} className={styles.walletCompact} aria-labelledby={`${idPrefix}-title`}>
    <h2 id={`${idPrefix}-title`} className="flex items-center gap-2 text-lg font-semibold">{!presentation?<Wallet aria-hidden="true" className="h-5 w-5 text-primary"/>:null}{presentation ? (locale === "hr" ? "Spremnost" : "Readiness") : copy.wallet}</h2>
    {ready&&profiles.length>1?<label className="block text-sm">{copy.profile}<select disabled={busy} className="mt-1 w-full rounded border bg-background p-2" value={profileId??""} onChange={e=>onProfile(e.target.value)}>
      <option value="">{copy.choose}</option>{profiles.map(id=><option key={id} value={id}>{id}</option>)}</select></label>:null}
    {failed?<p role="status">{copy.unavailable}</p>:!ready?<p role="status">{copy.loading}</p>:presentation?null:current?<div className={styles.walletAddress}>
      <p className="text-sm font-medium">{current.status==="identity_hold"?copy.held:copy.saved}</p>
      <p className="font-mono text-sm"><RewardExplorerLink chainId={current.chainId} kind="address" value={current.address}>{current.address.slice(0, 8)}…{current.address.slice(-6)}</RewardExplorerLink></p>
    </div>:active.length===0?<p className="text-sm">{copy.empty}</p>:<p className="text-sm">{copy.history}</p>}
    {ready&&!failed?<><RewardReadiness label={locale==='hr'?'Spremnost novčanika':'Wallet readiness'} steps={[
      {id:'profile',title:locale==='hr'?'RacesOn sportski profil':'RacesOn sporting profile',detail:profileId?(locale==='hr'?'Odabran profil za vaše nagrade.':'Profile selected for your rewards.'):(locale==='hr'?'Odaberite profil povezan s nagradom.':'Choose the profile linked to your award.'),state:profileId?'complete':'current'},
      {id:'wallet',title:locale==='hr'?'Odredište nagrada':'Reward destination',detail:current?(current.status==='identity_hold'?(locale==='hr'?'Identitet treba dodatnu provjeru.':'Identity needs further review.'):(presentation?`${current.address.slice(0,8)}…${current.address.slice(-6)}`:(locale==='hr'?'Novčanik je spremljen. Spremnost se provjerava za svaku nagradu.':'Wallet saved. Readiness is reviewed for each reward.'))):(locale==='hr'?'Povežite ili izričito stvorite novčanik kada ste spremni.':'Connect or explicitly create a wallet when you are ready.'),state:current?.status==='pending_review'&&complete?'complete':profileId?'current':'waiting'},
      ...(presentation ? [{id:'proof',title:locale==='hr'?'Dokaz kontrole novčanika':'Wallet-control proof',detail:current?.status==='pending_review'&&complete?(locale==='hr'?'Potpis je spremljen. Spremnost se zasebno provjerava za svaku nagradu.':'Signed proof saved. Readiness is reviewed separately for each reward.'):(locale==='hr'?'Potvrdite kontrolu novčanika besplatnim potpisom.':'Verify wallet control with a free signature.'),state:current?.status==='pending_review'&&complete?'complete' as const:'waiting' as const}] : []),
    ]}/>{!current?<p className={roleStyle.reassurance}>{locale==='hr'?'Nagrada ostaje rezervirana dok postavljate novčanik. Stvaranje novčanika vaš je izbor.':'Your award stays reserved while you set up your wallet. Creating a wallet is your choice.'}</p>:null}</>:null}
    {!current&&!open?<Button variant="outline" disabled={!ready||!profileId||!complete||active.length>0} onClick={()=>setOpen(true)}>{copy.connect}</Button>:null}
    <details className={styles.walletControls} open={open||replace?true:undefined}><summary className="cursor-pointer text-sm font-medium">{current ? (locale === "hr" ? "Uredi" : "Manage") : workspaceCopy(locale).walletSettings}</summary><div className="mt-3 space-y-3">
    {current ? <details><summary className="cursor-pointer text-sm font-medium">{locale === "hr" ? "Pristup novčaniku / novi uređaj" : "Access wallet / new device"}</summary><div className="mt-3"><RewardEmbeddedWalletControls existingAddress={current.address}/></div></details> : null}
    {replace&&current?<div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm">{copy.replaceHelp}</p>{error?<p role="alert" className="text-sm">{copy.failed}</p>:null}
      <div className="flex flex-wrap gap-2"><Button disabled={busy||refreshing||error} variant="outline" onClick={()=>void remove()}>{busy?copy.replacing:copy.remove}</Button>
        {error?<Button disabled={refreshing} variant="outline" onClick={()=>void onRefresh().then(()=>{if(alive.current){setError(false);setReplace(false);}})}>{copy.refreshWallet}</Button>:null}
        <Button disabled={busy} variant="ghost" onClick={()=>{setReplace(false);setError(false);}}>{copy.cancel}</Button></div>
    </div>:current?<Button variant="outline" disabled={!complete||!ready||refreshing} onClick={()=>setReplace(true)}>{copy.change}</Button>
      :null}
    {open&&ready&&profileId&&active.length===0&&complete?<Suspense fallback={<p role="status">{t("rewards.loading")}</p>}>
      <WalletPanel athleteProfileId={profileId} destinations={networkDestinations} destinationsComplete={complete} onDestinationSaved={()=>{setOpen(false);void onRefresh();}}/>
      <Button variant="ghost" onClick={()=>setOpen(false)}>{copy.close}</Button>
    </Suspense>:null}
    {ready&&!complete?<Button variant="outline" disabled={refreshing} onClick={onMore}>{copy.more}</Button>:null}
    <details><summary className="cursor-pointer text-sm">{copy.history}</summary>
      {ready?<RewardDestinationHistory readOnly items={networkDestinations.filter(d=>!profileId||d.athleteProfileId===profileId)} pending={false} error={null} refreshing={refreshing}
        hasMore={!complete} onRefresh={()=>void onRefresh()} onMore={onMore}/>:null}
    </details>
    <details><summary className="cursor-pointer text-sm">{t("rewards.wallet.noWallet")}</summary><p className="mt-2 text-sm">{t("rewards.wallet.noWalletHelp")}</p></details>
    </div></details>
  </section>;
}
