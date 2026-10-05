import type {SponsorLaunch} from "@raceson/domain/rewards/sponsor-launch";
import type {SponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";
import type {SponsorChainObservation} from "@raceson/rewards-chain/sponsor-v4";
import RewardExplorerLink from "./RewardExplorerLink";
import {setupAmount} from "../model/setupAmount";
import s from "./SponsorLaunch.module.css";
import d from "./SponsorDashboard.module.css";
import {sponsorAccounting, sponsorCampaignStatus, sponsorChartPercent, sponsorPotStatus} from "../model/sponsorDashboard";

/** A finalized accounting projection, never an allocation/recipient approval. */
export default function SponsorDistribution({launch, plan, observation, hr}: {
  launch: SponsorLaunch; plan: SponsorExecutionPlan; observation: SponsorChainObservation; hr: boolean;
}) {
  if (!observation.funded) return null;
  const t = (en: string, local: string) => hr ? local : en;
  const amount = (wei: string) => `${setupAmount(BigInt(wei), hr)} test MON`;
  const title = (slot: number) => {
    const pot = launch.id === plan.launchId ? launch.setup.configuration.guided?.pots.find(p => p.slot === slot) : null;
    return launch.setup.configuration.root.children.find(p => p.id === pot?.nodeId)?.name
      ?? (slot === 0 ? t("League", "Liga") : `${t("Round", "Kolo")} ${slot}`);
  };
  const status = (pot: SponsorChainObservation['pots'][number]) => sponsorPotStatus(pot, observation, hr);
  const totals = sponsorAccounting(observation), total = totals.paid + totals.held + totals.returned;
  const segments = [
    {label: t("Paid", "Isplaćeno"), value: totals.paid, color: '#f56617'},
    {label: t("Held, not yet claimed", "Zadržano, još nije preuzeto"), value: totals.held, color: '#201c19'},
    ...(totals.returned > 0n ? [{label: t("Returned", "Vraćeno"), value: totals.returned, color: '#b8aa99'}] : []),
  ];
  return <section className={`${d.card} ${d.current}`} aria-label={t("Results and payouts", "Rezultati i isplate")}>
    <span className={d.eyebrow}>{t("Current task", "Trenutni zadatak")}</span>
    <h2>{sponsorCampaignStatus(observation, hr)}</h2>
    <p className={d.intro}>{t("Athletes and clubs claim their own rewards. Open claims is not payment — only confirmed claims are paid.", "Sportaši i klubovi sami preuzimaju nagrade. Otvoreno preuzimanje nije isplata — isplaćene su samo potvrđene transakcije.")}</p>
    <div className={d.bar} role="img" aria-label={segments.map(row => `${row.label}: ${amount(row.value.toString())}`).join('; ')}>{segments.map(row => <span key={row.label} style={{width: `${sponsorChartPercent(row.value, total)}%`, background: row.color}}/>)}</div>
    <dl className={d.legend}>{segments.map(row => <div key={row.label}><dt><i className={d.dot} style={{background: row.color}}/>{row.label}</dt><dd>{amount(row.value.toString())}</dd><dd className={d.percent}>{sponsorChartPercent(row.value, total)}%</dd></div>)}</dl>
    <details className={d.details}><summary>{t("Reward pots & verification", "Fondovi nagrada i provjera")}</summary>
    <p className={s.verifiedAt}>{t("Verified at", "Provjereno")} {new Date(Number(observation.blockTimestamp)*1000).toLocaleString(hr?"hr-HR":"en-GB")} · {t("Finalized block", "Finalizirani blok")} {observation.blockNumber}</p>
    {observation.pots.map(pot => <div className={d.potDetail} key={pot.slot}><div className={d.potHeading}><strong>{title(pot.slot)}</strong>{observation.pots.length>1?<span>{status(pot)}</span>:null}<p>{pot.state>=4?t("RacesOn team · Review settlement and any returned funds.","RacesOn tim · Provjerite podmirenje i vraćena sredstva."):pot.paused?t("RacesOn team · Review the pause before claims can continue.","RacesOn tim · Potrebna je provjera pauze prije nastavka preuzimanja."):pot.state===3&&BigInt(pot.claimDeadline)>BigInt(observation.blockTimestamp)?t("Athletes & clubs · Review and claim your own rewards. Opening claims does not confirm payment.","Sportaši i klubovi · Pregledajte i preuzmite svoje nagrade. Otvoreno preuzimanje ne potvrđuje isplatu."):[4,5].includes(pot.state)||pot.state===3?t("RacesOn team · Review settlement and any returned funds.","RacesOn tim · Provjerite podmirenje i vraćena sredstva."):pot.state===2?t("Controller · Complete the remaining steps to open claims.","Kontrolor · Dovršite preostale korake za otvaranje preuzimanja."):t("RacesOn team · Review official results and approve awards.","RacesOn tim · Pregledajte službene rezultate i odobrite nagrade.")}</p></div><details className={s.details}>
      <summary>{t("Amounts & contract", "Iznosi i ugovor")} · {title(pot.slot)}</summary>
      <dl className={s.facts}>
        <div><dt>{t("Award entries", "Zapisi nagrada")}</dt><dd>{pot.entitlementCount}</dd></div>
        <div><dt>{t("Allocated", "Raspodijeljeno")}</dt><dd>{amount(pot.allocatedWei)}</dd></div>
        <div><dt>{t("Paid", "Isplaćeno")}</dt><dd>{amount(pot.paidWei)}</dd></div>
        <div><dt>{t("Held in contract", "U ugovoru")}</dt><dd>{amount(pot.remainingWei)}</dd></div>
        <div><dt>{t("Returned", "Vraćeno")}</dt><dd>{amount(pot.returnedWei)}</dd></div>
      </dl>
      <RewardExplorerLink chainId={plan.chainId} kind="address" value={pot.address}/>
    </details></div>)}
    </details>
  </section>;
}
