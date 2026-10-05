import {useEffect, useRef, useState} from "react";
import {Link} from "react-router-dom";
import type {SponsorLaunch} from "@raceson/domain/rewards/sponsor-launch";
import {saveRewardSetup} from "../data/distributionSetups";
import s from "./SponsorLaunch.module.css";

/** Copies only saved rules. No execution, source approval, deposit or claim state. */
export default function SponsorRecoveryCopy({launch, hr}: {launch: SponsorLaunch; hr: boolean}) {
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[created,setCreated]=useState<string|null>(null);
  const attempt=useRef<{id:string;requestId:string;configuration:SponsorLaunch["setup"]["configuration"]}|null>(null),active=useRef(true),flight=useRef(false);
  const t=(en:string,local:string)=>hr?local:en;
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  async function create() {
    if(flight.current||created)return;
    flight.current=true;setBusy(true);setFailed(false);
    try {
      if(!attempt.current){
        const configuration=structuredClone(launch.setup.configuration);
        configuration.stage="draft";
        configuration.name=`${configuration.name.slice(0,80)} · ${t("corrected draft","ispravljeni nacrt")}`;
        if(configuration.guided)configuration.guided.groups.forEach(g=>{g.eligibilityApproved=false;});
        attempt.current={id:crypto.randomUUID(),requestId:crypto.randomUUID(),configuration};
      }
      const fixed=attempt.current;
      const saved=await saveRewardSetup(fixed.id,{requestId:fixed.requestId,expectedRevision:0,configuration:fixed.configuration});
      if(active.current)setCreated(saved.id);
    } catch {if(active.current)setFailed(true);}
    finally {flight.current=false;if(active.current)setBusy(false);}
  }
  return <section className={s.card} aria-label={t("Correct campaign source links","Ispravi poveznice kampanje")}>
    <h2>{t("Official source links are missing","Nedostaju službene poveznice")}</h2>
    <p>{t("This saved launch has incomplete source selections. Its contract rules are frozen. Create an editable copy with the same budget, prize amounts and claim policy, then link the official league, rounds and categories before launching it.","Ovo spremljeno pokretanje nema potpune izvore. Pravila ugovora su zaključana. Stvorite kopiju s istim proračunom, iznosima nagrada i pravilima preuzimanja, pa povežite službenu ligu, kola i kategorije prije pokretanja.")}</p>
    <p>{t("The original campaign and any funds remain unchanged. A draft copy does not deploy a contract or move money.","Izvorna kampanja i sredstva ostaju nepromijenjeni. Kopija nacrta ne postavlja ugovor i ne premješta sredstva.")}</p>
    {created?<Link className={s.primary} to={`/rewards/create?opportunity=league&step=1&setup=${created}`}>{t("Connect sources in corrected draft","Poveži izvore u ispravljenom nacrtu")}</Link>
      :<button className={s.primary} disabled={busy} onClick={()=>void create()}>{busy?t("Creating draft…","Izrada nacrta…"):failed?t("Retry the same draft copy","Ponovi istu kopiju nacrta"):t("Create corrected draft","Stvori ispravljeni nacrt")}</button>}
    {failed?<p role="alert">{t("The copy was not confirmed. Retry the same request to recover it without creating another copy.","Kopija nije potvrđena. Ponovite isti zahtjev za oporavak bez stvaranja dodatne kopije.")}</p>:null}
  </section>;
}
