import OfficialSourceLinks from '../components/OfficialSourceLinks';
import type {RewardSponsorSelection} from '@raceson/domain/rewards/distribution-setup';
import type {ReactNode} from "react";
import {useSponsorCatalogue} from "../data/copyCatalogue";
import {usePublicDirectory} from "../data/publicDirectory";
import {Link,useSearchParams} from "react-router-dom";
import {ArrowRight,ArrowLeft,Search,Mountain,CalendarDays,X,LayoutGrid,List,Handshake} from "lucide-react";
import {useI18n} from "@/shared/i18n/I18nContext";
import {sponsorLink} from "../model/sponsorOpportunities";
import {countEventSponsorships,sponsorArtwork,type SponsorCatalogueItem} from "../model/sponsorCatalogue";
import {sponsorPreparedSource} from "../model/sponsorPreparedSource";
import s from "./SponsorDiscovery.module.css";

export default function SponsorDiscovery(){
 const {locale}=useI18n(),hr=locale==="hr",t=(en:string,local:string)=>hr?local:en;
 const {items:sponsorCatalogue,league:sponsorLeague,copy,loading,error,retry}=useSponsorCatalogue();
 const directory=usePublicDirectory();
 const races=sponsorCatalogue.filter(item=>item.kind==="race");
 const [search,setSearch]=useSearchParams(),link=(target="league",raceId?:string)=>{if(!copy)return sponsorLink(target,search.get("setup"),raceId);const q=new URLSearchParams({sourceLeagueId:copy.sourceLeagueId,sourceSeasonId:copy.sourceSeasonId,opportunity:target});const r=copy.rounds.find(r=>`round-${r.slot}`===target);if(r)q.set("eventEditionId",r.eventEditionId);if(raceId&&r?.tracks.some(t=>t.raceId===raceId))q.set("raceId",raceId);if(search.get("setup"))q.set("setup",search.get("setup")!);return `/rewards/create?${q}`;};
 const kind=["league","race"].includes(search.get("kind")??"")?search.get("kind"):"all",query=search.get("q")??"",period=search.get("period")??"all",sort=search.get("sort")??"date",view=search.get("view")??"grid";
 const change=(key:string,value:string)=>setSearch(p=>{const next=new URLSearchParams(p);next.set(key,value);return next;},{replace:true});
 const setKind=(value:string)=>change("kind",value),setQuery=(value:string)=>change("q",value);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zagreb',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const selected=races.find(item=>item.id===search.get('event'))??null;
 const openDetails=(id:string)=>setSearch(p=>{const n=new URLSearchParams(p);n.set('event',id);return n;});
 const closeDetails=()=>setSearch(p=>{const n=new URLSearchParams(p);n.delete('event');return n;});
 const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const matches=(value:string)=>normalize(value).includes(normalize(query.trim()));
 const finalRaceDate=sponsorCatalogue.filter(item=>item.kind==="race").reduce((latest,item)=>item.date>latest?item.date:latest,"");
 const matchesPeriod=(date:string)=>period==="all"||(period==="upcoming"?date>=today:date<today);
 const eventDate=(date:string)=>new Intl.DateTimeFormat(hr?"hr-HR":"en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`));
 const finalRaceLabel=finalRaceDate?eventDate(finalRaceDate):"";
 const league=(kind==="all"||kind==="league")&&matches(`${sponsorLeague.name} Šibenska Liga`)&&matchesPeriod(finalRaceDate);
 const items=races.filter(item=>(kind==="all"||kind===item.kind)&&matches(`${item.name} ${item.parentName}`)&&matchesPeriod(item.date)).sort((a,b)=>sort==="name"?a.name.localeCompare(b.name):sort==="date-desc"?b.date.localeCompare(a.date)||a.name.localeCompare(b.name):a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
 const resultCount=items.length+Number(league);
 const sponsorshipPill=(eventEditionId:string|null)=>{
  const unavailable=directory.isError||directory.data?.refreshStatus==="failed";
  const count=directory.data&&!unavailable?countEventSponsorships(directory.data.items,{sourceLeagueId:copy?.sourceLeagueId??sponsorLeague.sourceLeagueId,sourceSeasonId:copy?.sourceSeasonId??sponsorLeague.sourceSeasonId,eventEditionId}):null;
  const label=count===null?(unavailable?t("Sponsorships unavailable","Sponzorstva nisu dostupna"):t("Checking sponsorships…","Provjera sponzorstava…")):t(`${count} ${count===1?"sponsorship":"sponsorships"}`,`${count} ${count%10===1&&count%100!==11?"sponzorstvo":count%10>=2&&count%10<=4&&(count%100<12||count%100>14)?"sponzorstva":"sponzorstava"}`);
  return <span className={s.sponsorshipPill} title={t("Published sponsorship campaigns for this event. Private drafts are excluded.","Objavljene sponzorske kampanje za ovaj događaj. Privatni nacrti nisu uključeni.")}><Handshake size={14} aria-hidden="true"/>{label}</span>;
 };
 const leagueSelection={sourceLeagueId:sponsorLeague.sourceLeagueId,sourceSeasonId:sponsorLeague.sourceSeasonId,eventEditionId:null};
 const categoryCount=(count:number)=>t(`${count} official reward categories`,`${count} službenih kategorija nagrada`);
 const categoryNames=(item:SponsorCatalogueItem)=>item.categories.map(c=>`${c.competitionName} · ${c.name}`);
 if(loading||error)return <article className={s.page}><h1>{t("Find an event to sponsor","Pronađite događaj za sponzorstvo")}</h1><p role={error?"alert":"status"}>{error?t("The verified event catalogue could not be loaded.","Nije moguće učitati provjereni katalog događaja."):t("Loading completed events…","Učitavanje završenih događaja…")}</p>{error?<button onClick={()=>void retry()}>{t("Try again","Pokušaj ponovno")}</button>:null}</article>;
 if(search.get('event')==='league')return <article className={s.page} aria-label={t('Event details','Detalji događaja')}><button className={s.back} onClick={closeDetails}><ArrowLeft size={16}/>{t('Back to events','Natrag na događaje')}</button><header className={`${s.detailHeading} ${s.detailHero}`} style={{backgroundImage:`linear-gradient(0deg,#171c1ddb,#171c1d10),url(${sponsorArtwork.league})`}}><span className={s.eyebrow}>{t('Trail running league','Trail liga')}</span><h1>{sponsorLeague.name}</h1><p>{sponsorLeague.roundCount} {t('rounds','kola')} · {sponsorLeague.trackCount} {t('routes','ruta')}</p></header><OfficialSourceLinks selection={leagueSelection} hr={hr}/><div className={s.detailLayout}><section><h2>{t('Competition structure','Struktura natjecanja')}</h2>{sponsorCatalogue.filter(item=>item.kind==='race').map(item=><details className={s.structure} key={item.id}><summary><span>{item.name}<small>{eventDate(item.date)} · {item.detail}</small></span></summary><OfficialSourceLinks selection={item} hr={hr}/><ul>{categoryNames(item).map(name=><li key={name}>{name}</li>)}</ul><button className={s.back} onClick={()=>openDetails(item.id)}>{t('Event details','Detalji događaja')}<ArrowRight size={14}/></button></details>)}</section><aside className={s.sponsorAside}><h2>{t('Fund prizes for this league','Financirajte nagrade ove lige')}</h2><p>{t('Existing rounds and official classifications stay connected throughout setup.','Postojeća kola i službene klasifikacije ostaju povezani tijekom postavljanja.')}</p><Link className={s.primary} to={link()}>{t('Sponsor event','Sponzoriraj događaj')}<ArrowRight size={18}/></Link></aside></div></article>;
 if(selected)return <article className={s.page} aria-label={t('Event details','Detalji događaja')}><button className={s.back} onClick={closeDetails}><ArrowLeft size={16}/>{t('Back to events','Natrag na događaje')}</button><header className={`${s.detailHeading} ${s.detailHero}`} style={{backgroundImage:`linear-gradient(0deg,#171c1ddb,#171c1d10),url(${selected.image})`}}><span className={s.eyebrow}>{selected.kind==='track'?t('Trail route','Trail ruta'):t('Trail running','Trail trčanje')}</span><h1>{selected.name}</h1><p><CalendarDays size={16}/><time dateTime={selected.date}>{eventDate(selected.date)}</time><Mountain size={16}/>{selected.detail||selected.parentName}</p></header><OfficialSourceLinks selection={selected} hr={hr}/><div className={s.detailLayout}><section><h2>{t('Competition structure','Struktura natjecanja')}</h2><p className={s.description}>{selected.kind==='track'?selected.parentName:sponsorLeague.name} · {t('Provided by RacesOn. Sponsors choose the prizes for existing classifications.','Podatke pruža RacesOn. Sponzori odabiru nagrade za postojeće klasifikacije.')}</p><div className={s.structure}><h3>{selected.name}<small>{categoryCount(selected.categories.length)}</small></h3><ul aria-label={t('Official reward categories','Službene kategorije nagrada')}>{categoryNames(selected).map(name=><li key={name}>{name}</li>)}</ul></div></section><aside className={s.sponsorAside}><h2>{t('Fund prizes for this event','Financirajte nagrade ovog događaja')}</h2><p>{t('Your selected event stays with you through the whole setup.','Odabrani događaj prati vas kroz cijelo postavljanje.')}</p><Link className={s.primary} to={link(selected.parent,selected.raceId)}>{t('Sponsor event','Sponzoriraj događaj')}<ArrowRight size={18}/></Link><p className={s.description}>{t('Official results come from RacesOn. Your campaign determines the budget and reward ratios.','Službeni rezultati dolaze iz RacesOn. Vaša kampanja određuje fond i omjere nagrada.')}</p></aside></div></article>;
 return <article className={s.page}>
  <header className={s.heading}><div><span className={s.eyebrow}>{t("Events","Događaji")}</span><h1>{t("Find an event to sponsor","Pronađite događaj za sponzorstvo")}</h1><p className={s.description}>{t("Events, races and results come from RacesOn. You choose the prizes.","Događaji, utrke i rezultati dolaze iz RacesOn. Vi birate nagrade.")}</p></div></header><div className={s.directoryToolbar}><div className={s.searchBand}><label className={s.search}><Search size={21}/><input aria-label={t("Search leagues or races","Pretraži lige ili utrke")} placeholder={t("Search leagues or races…","Pretraži lige ili utrke…")} value={query} onChange={e=>setQuery(e.target.value)}/>{query?<button aria-label={t("Clear search","Očisti pretragu")} onClick={()=>setQuery("")}><X size={18}/></button>:null}</label></div>
  <div className={s.filters}><div className={s.tabs} role="group" aria-label={t("Sponsorship opportunities","Sponzorske prilike")}>{[["all",t("All","Sve")],["league",t("Leagues","Lige")],["race",t("Races","Utrke")]].map(([id,label])=><button key={id} aria-pressed={kind===id} onClick={()=>setKind(id)}>{label}</button>)}</div><span className={s.resultCount}>{resultCount} {t(resultCount===1?"result":"results",resultCount%10===1&&resultCount%100!==11?"rezultat":"rezultata")}</span></div>
  <details className={s.moreFilters}><summary>{t("More filters","Više filtara")}</summary><div className={s.directoryControls}><label>{t("When","Vrijeme")}<select aria-label={t("Event period","Razdoblje događaja")} value={period} onChange={e=>change("period",e.target.value)}><option value="all">{t("All dates","Svi datumi")}</option><option value="upcoming">{t("Upcoming & ongoing","Budući i u tijeku")}</option><option value="past">{t("Past events","Prošli događaji")}</option></select></label><label>{t("Sort","Poredaj")}<select aria-label={t("Sort events","Poredaj događaje")} value={sort} onChange={e=>change("sort",e.target.value)}><option value="date">{t("Date · earliest first","Datum · najraniji")}</option><option value="date-desc">{t("Date · latest first","Datum · najnoviji")}</option><option value="name">{t("Name A–Z","Naziv A–Ž")}</option></select></label><div><button aria-label={t("Grid view","Mrežni prikaz")} aria-pressed={view==='grid'} onClick={()=>change('view','grid')}><LayoutGrid size={18}/></button><button aria-label={t("List view","Prikaz popisa")} aria-pressed={view==='list'} onClick={()=>change('view','list')}><List size={18}/></button></div></div></details></div>
  <div className={`${s.eventGrid} ${view==='list'?s.eventList:''}`}>
   {league?<EventCard sourceSelection={leagueSelection} hr={hr} name={sponsorLeague.name} image={sponsorArtwork.league} logo={sponsorArtwork.logo} tag={t("League","Liga")} sponsorship={sponsorshipPill(null)} scope={t("5 races","5 utrka")} date={<><span>{t("Final race","Zadnja utrka")} · </span><time dateTime={finalRaceDate}>{finalRaceLabel}</time></>} categories={t("7 athlete categories · club standings","7 kategorija sportaša · klupski poredak")} onDetails={()=>openDetails("league")} sponsorHref={link()} viewLabel={t("View","Pregledaj")} detailsLabel={t("View details","Prikaži detalje")} sponsorLabel={t("Sponsor event","Sponzoriraj događaj")}/>:null}
   {items.map(item=><EventCard sourceSelection={item} hr={hr} key={item.id} name={item.name} image={item.image} tag={t("Race","Utrka")} sponsorship={sponsorshipPill(item.eventEditionId)} scope={item.detail||t("Distance not published","Udaljenost nije objavljena")} date={<time dateTime={item.date}>{eventDate(item.date)}</time>} categories={categoryCount(item.categories.length)} onDetails={()=>openDetails(item.id)} sponsorHref={link(item.parent,item.raceId)} viewLabel={t("View","Pregledaj")} detailsLabel={t("View details","Prikaži detalje")} sponsorLabel={t("Sponsor event","Sponzoriraj događaj")}/>)}
  </div>
  {!league&&!items.length?<div className={s.empty} role="status"><Search size={30}/><h2>{t("No matches","Nema rezultata")}</h2><button className={s.secondary} onClick={()=>setSearch(p=>{const n=new URLSearchParams(p);n.set("kind","all");n.delete("q");n.set("period","all");return n;},{replace:true})}>{t("Clear filters","Očisti filtre")}</button></div>:null}
  {copy?<p>{t("Isolated Šibenik Trail League copy · closed after five completed rounds.","Izdvojena kopija Šibenske trail lige · zatvorena nakon pet završenih kola.")} <Link to="/rewards/demo-copy">{t("Inspect results","Pregledaj rezultate")}</Link></p>:<details><summary>{t("About this prepared catalogue","O pripremljenom katalogu")}</summary><p>{t("Public RacesOn metadata captured on 24 September 2026. Four completed races and the scheduled Šubićevac race. This is a prepared selection, not a live calendar.","Javni RacesOn podaci preuzeti 24. rujna 2026. Četiri završene utrke i zakazana utrka Šubićevac. Ovo je pripremljeni izbor, a ne kalendar uživo.")}</p><ul>{sponsorPreparedSource.provenance.map(p=><li key={p.sha256}><time>{p.capturedAt}</time> · SHA-256 <code style={{overflowWrap:"anywhere"}}>{p.sha256}</code></li>)}</ul></details>}

 </article>;
}


function EventCard({sourceSelection,hr,name,image,logo,tag,sponsorship,scope,date,categories,onDetails,sponsorHref,viewLabel,detailsLabel,sponsorLabel}:{
 sourceSelection:RewardSponsorSelection;hr:boolean;name:string;image:string;logo?:string;tag:string;sponsorship:ReactNode;scope:ReactNode;date:ReactNode;categories:string;
 onDetails:()=>void;sponsorHref:string;viewLabel:string;detailsLabel:string;sponsorLabel:string;
}){
 return <section className={s.eventCard} aria-label={name}>
  <button className={s.eventImage} onClick={onDetails} aria-label={`${viewLabel} ${name}`}>
   <img src={image} alt="" loading="lazy"/>
   {logo?<img className={s.eventLogo} src={logo} alt=""/>:null}
   <span className={s.tag}>{tag}</span>
  </button>
  <div className={s.eventBody}>
   <h2>{name}</h2>
   {sponsorship}<OfficialSourceLinks selection={sourceSelection} hr={hr}/>
   <div className={s.eventInfo}>
    <p><Mountain size={18} aria-hidden="true"/><span>{scope}</span></p>
    <p><CalendarDays size={18} aria-hidden="true"/><span>{date}</span></p>
    <p className={s.eventCategories}>{categories}</p>
   </div>
   <div className={s.eventActions}>
    <button className={s.secondary} aria-label={`${detailsLabel}: ${name}`} onClick={onDetails}>{detailsLabel}</button>
    <Link className={s.primary} to={sponsorHref} aria-label={`${sponsorLabel}: ${name}`}>{sponsorLabel}<ArrowRight size={16} aria-hidden="true"/></Link>
   </div>
  </div>
 </section>;
}
