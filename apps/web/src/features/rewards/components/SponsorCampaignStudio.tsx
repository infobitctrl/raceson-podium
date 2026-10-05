import {lazy,Suspense,useEffect,useState} from "react";
import {useAuth} from "@/lib/auth";
import {sponsorConfigurationSourcesReady} from "@raceson/domain/rewards/sponsor-launch";
import {addSponsorDraftCategory,sponsorDraftCategoryName,matchesSponsorDraftCategory,sponsorDraftCategories,type SponsorDraftCategory} from "../model/sponsorDraftCategories";
import {Link,useSearchParams} from "react-router-dom";
import {ArrowLeft,ArrowRight,LockKeyhole} from "lucide-react";
import {previewRewardSetup,updateSetupNode,type RewardDistributionSetup,type RewardSetupNode} from "@raceson/domain/rewards/distribution-setup";
import {type GuidedRewardGroup,type GuidedRewardType} from "@raceson/domain/rewards/guided-setup";
import {addGuidedGroup,removeGuidedGroup,guidedCategories,connectGuidedGroup,changeGuidedMethod} from "@raceson/domain/rewards/guided-setup-editor";
import type {RewardSourceCatalogueV2} from "@raceson/domain/rewards/source-mapping-v2";

import type {GuidedRewardSetupProps} from "./GuidedRewardSetup";
import {sponsorIntent,sponsorSelectedEventName,sponsorDemoEditions,sponsorDiscoveryLink} from "../model/sponsorOpportunities";
import {sponsorCatalogue} from "../model/sponsorCatalogue";
import {setupAmount} from "../model/setupAmount";
import {allocateAddedSponsorCategory,balanceSponsorCategories,normalizeSponsorCategories,setSponsorCategoryShare} from "../model/sponsorCategoryAllocation";
import {applySponsorRaceDistribution} from "../model/applySponsorRaceDistribution";
import SponsorRaceScope from "./SponsorRaceScope";
import SponsorBulkCategories from "./SponsorBulkCategories";
import {applySponsorCategorySettings} from "../model/applySponsorCategorySettings";
import {sponsorSetupComplete} from "../model/sponsorSetupComplete";
import SponsorFundingWorkspace from "./SponsorFundingWorkspace";
import {useSponsorSource} from "../model/useSponsorSource";
import SponsorSourceStatus from "./SponsorSourceStatus";
import SponsorPreparedCategoryPreview from "./SponsorPreparedCategoryPreview";
import s from "./SponsorStudio.module.css";
import exact from "./SponsorExact.module.css";
import SponsorBudgetSummary from "./SponsorBudgetSummary";
import SponsorInlineCategory from "./SponsorInlineCategory";
const Metrics=lazy(()=>import("./RewardLeagueMetrics"));

type Category=RewardSourceCatalogueV2["categories"][number];
export default function SponsorCampaignStudio(props:GuidedRewardSetupProps){
 const auth=useAuth();
 const {configuration:c,hr,selection,onChange}=props,meta=c.guided!,t=(en:string,local:string)=>hr?local:en;
 const [search]=useSearchParams(),intent=sponsorIntent(search.get("opportunity"),hr);
 const [activeRound,setActiveRound]=useState(Number(search.get("round"))>=1&&Number(search.get("round"))<=5?Number(search.get("round")):intent?.round||1);
 const roundQuery=search.get("round");
 useEffect(()=>{const round=Number(roundQuery);if(round>=1&&round<=5)setActiveRound(round);},[roundQuery]);
 const [bulkEditing,setBulkEditing]=useState(false);
 const [error,setError]=useState(""),[reviewUnsaved,setReviewUnsaved]=useState(false);
 const disabled=props.disabled||reviewUnsaved||Boolean(props.sourceLocked);
 const resolvedSource=useSponsorSource(c,search,{enabled:!props.copySource,setupId:props.setupId,locked:disabled||Boolean(props.sourceLocked)||Boolean(props.copySource),onChange});
 const sourceState=props.copySource?{...resolvedSource,source:null,status:"ready" as const,selected:true,selectedRaceId:null}:resolvedSource;
 const selectedEdition=c.sponsorSelection?.eventEditionId??search.get("eventEditionId");
 const raceSlot=props.copySource?props.copySource.slot:selectedEdition?(sourceState.source?.selectedSlot||sponsorDemoEditions.indexOf(selectedEdition as typeof sponsorDemoEditions[number])+1||intent?.round||0):intent?.round||0;
 const step=props.step===2?1:props.step===4&&raceSlot?3:Math.min(5,props.step),order=raceSlot?[1,3,5]:[1,4,5],index=step===3||step===4?1:order.indexOf(step);
 const reviewIndex=order.length-1;
 useEffect(()=>{const slot=sourceState.source?.selectedSlot;if(slot){setActiveRound(slot);}},[sourceState.source?.selectedSlot]);
 const unbound=!props.copySource&&!c.context&&!sourceState.selected;
 const fullCatalogue=sourceState.source?.catalogue??(!sourceState.selected&&selection&&selection.record.draftId===c.context?.draftId&&selection.workspace.catalogueHash===c.context.catalogueHash?selection.workspace.catalogue:null);
 const selectedTrack=sourceState.selectedRaceId?fullCatalogue?.rounds.flatMap(r=>r.races).find(r=>r.id===sourceState.selectedRaceId):null;
 const catalogue=sourceState.selectedRaceId&&fullCatalogue?{...fullCatalogue,categories:fullCatalogue.categories.filter(cat=>cat.competitionId===selectedTrack?.competitionId&&cat.target==="individual")}:fullCatalogue;
 const pot=meta.pots.find(p=>p.slot===(step===3?raceSlot||activeRound:0))!,potNode=c.root.children.find(n=>n.id===pot.nodeId)!;
 const [,setPreviewChoice]=useState<{name:string;type:GuidedRewardType;category:Category|null;draft?:SponsorDraftCategory}|null>(null);
 let preview:ReturnType<typeof previewRewardSetup>|null=null;try{preview=previewRewardSetup(c);}catch{/* Keep invalid input editable; never display it as an allocation. */}
 const allocationComplete=sponsorSetupComplete(c),amount=(id:string)=>setupAmount(preview?.rows.find(row=>row.id===id)?.amountWei??null,hr);
 const scopeConflict=Boolean(raceSlot&&c.root.children.some(p=>p.shareBps>0&&(meta.pots.find(m=>m.nodeId===p.id)?.slot!==raceSlot||sourceState.selectedRaceId&&p.children.some(g=>g.shareBps>0&&!catalogue?.categories.some(cat=>cat.id===g.rule?.source?.categoryId)))));
 const launchReady=!scopeConflict&&Boolean(preview)&&(props.copySource||sourceState.status==="ready"&&sponsorConfigurationSourcesReady(c));
 const categories=catalogue?guidedCategories(catalogue,pot.roundId,"athlete_standings"):[];
 const clubs=catalogue?guidedCategories(catalogue,pot.roundId,"club_standings"):[];
 const sum=(node:RewardSetupNode)=>node.children.reduce((sum,n)=>sum+n.shareBps,0);
 const go=(next:number,round?:number)=>{if(!reviewUnsaved){setPreviewChoice(null);props.onStep(next,round);}};
 const safely=(action:()=>RewardDistributionSetup)=>{if(disabled)return false;try{props.onChange(props.copySource?action():normalizeSponsorCategories(action()));setError("");return true;}catch{setError(t("Check the current budget and category settings.","Provjerite fond i postavke kategorije."));return false;}};
 const editNode=(id:string,update:(node:RewardSetupNode)=>RewardSetupNode)=>safely(()=>({...c,root:updateSetupNode(c.root,id,update)}));
 useEffect(()=>{
  if(disabled||props.copySource)return;
  try{const next=normalizeSponsorCategories(c);if(next!==c)onChange(next);}
  catch{setError(hr?"Otključajte kategoriju kako bi zbroj spremljenog fonda bio 100%.":"Unlock a category to balance this saved pot to 100%.");}
 },[c,disabled,onChange,hr]);
 const visible=(n:RewardSetupNode)=>!props.copySource?.visibleGroups||props.copySource.visibleGroups.has(n.id);
 const changeShare=(id:string,value:number)=>editNode(potNode.id,n=>{const eligible=n.children.filter(visible);const adjusted=props.copySource&&value===0&&eligible.filter(n=>n.shareBps>0).length<=1?eligible.map(n=>n.id===id?{...n,shareBps:0}:n):setSponsorCategoryShare(eligible,id,value);return {...n,children:n.children.map(child=>adjusted.find(a=>a.id===child.id)??child)};});
 function removeCategory(id:string){
  if(props.copySource){const node=potNode.children.find(n=>n.id===id);changeShare(id,node?.shareBps?0:Math.floor(10000/(potNode.children.filter(n=>visible(n)&&n.shareBps>0).length+1)));return;}
  if(potNode.children.find(n=>n.id===id)?.locked){setError(t("Unlock this category before removing it.","Otključajte kategoriju prije uklanjanja."));return;}
  try{const next=normalizeSponsorCategories(removeGuidedGroup(c,id));safely(()=>next);}
  catch{setError(t("Unlock another category before removing this one, so the pot can stay at 100%.","Otključajte još jednu kategoriju prije uklanjanja kako bi fond ostao na 100%."));}
 }
 const editGroup=(id:string,patch:Partial<GuidedRewardGroup>)=>safely(()=>({...c,guided:{...meta,groups:meta.groups.map(g=>g.nodeId===id?{...g,...patch}:g)}}));
 function choose(type:GuidedRewardType,category:Category|null){
  setPreviewChoice(null);
  const existing=potNode.children.find(n=>category?n.rule?.source?.categoryId===category.id:meta.groups.some(g=>g.nodeId===n.id&&g.type===type));
  if(existing){removeCategory(existing.id);return;}
  safely(()=>{const next=allocateAddedSponsorCategory(addGuidedGroup(c,pot.nodeId,type,()=>crypto.randomUUID(),category,hr),pot.nodeId);return next;});
 }
 function chooseDraft(category:SponsorDraftCategory){
  setPreviewChoice(null);
  const existing=potNode.children.find(n=>matchesSponsorDraftCategory(n,category));
  if(existing){removeCategory(existing.id);return;}
  safely(()=>{const next=allocateAddedSponsorCategory(addSponsorDraftCategory(c,pot.nodeId,category,()=>crypto.randomUUID(),hr),pot.nodeId);return next;});
 }
 function navigatePot(target:"pot"|"rounds"|number){
  if(reviewUnsaved)return;
  setPreviewChoice(null);
  if(target==="pot"){go(1);return;}
  if(target==="rounds"){go(1);document.getElementById("funding-inspector")?.scrollIntoView?.({block:"start"});return;}
  setActiveRound(target||1);go(target?3:4,target||undefined);
 }
 const allocatedPots=meta.pots.filter(p=>c.root.children.some(n=>n.id===p.nodeId&&n.shareBps>0));
 const selectedName=sponsorSelectedEventName(c.sponsorSelection);
 const sourceName=props.copySource?.name??selectedTrack?.name??sourceState.source?.catalogue.rounds.find(r=>r.id===sourceState.source?.selectedRoundId)?.name??selectedName??c.context?.eventName??sourceState.source?.context.eventName??t("Šibenik Trail League","Šibenska Trail Liga");
 const potName=(node:RewardSetupNode)=>raceSlot&&meta.pots.some(p=>p.nodeId===node.id&&p.slot===raceSlot)?sourceName:node.name;
 const detailEvent=sponsorCatalogue.find(item=>sourceState.selectedRaceId?item.raceId===sourceState.selectedRaceId:item.parent===`round-${raceSlot}`&&item.kind==='race');
 const detailQuery=new URLSearchParams(sponsorDiscoveryLink(props.setupId).split('?')[1]??'');detailQuery.set('event',detailEvent?.id??'league');
 const detailHref=`/rewards/events?${detailQuery}`;
 const isSitrail=!c.context||/šib|siben|šitrail|sitrail/i.test(sourceName);
 const organization=props.copySource?"":selection?.record.organizationName??(isSitrail?"BK Faust Vrančić":"");
 const editor=(node:RewardSetupNode)=>{const group=meta.groups.find(g=>g.nodeId===node.id);return group?<SponsorInlineCategory fixedStructure={Boolean(props.copySource)} key={node.id} node={node} group={group} configuration={c} catalogue={catalogue} roundId={pot.roundId} row={preview?.rows.find(r=>r.id===node.id)} hr={hr} disabled={disabled} onNode={update=>{const next=update(node);if(next.shareBps!==node.shareBps)changeShare(node.id,next.shareBps);else editNode(node.id,()=>next);}} onGroup={patch=>editGroup(node.id,patch)} onMethod={method=>safely(()=>changeGuidedMethod(c,node.id,method))} onConnect={id=>{if(catalogue)safely(()=>connectGuidedGroup(c,node.id,id,catalogue));}} onRemove={()=>removeCategory(node.id)}/>:null;};
 const available=props.copySource?[]:[...categories.map(category=>({name:`${category.competitionName} · ${category.name}`,type:'athlete_standings' as GuidedRewardType,category})),...(!sourceState.selectedRaceId?clubs.map(category=>({name:category.name,type:'club_standings' as GuidedRewardType,category})):[]),...(unbound?[{name:t("Club standings","Klupski poredak"),type:"club_standings" as GuidedRewardType,category:null}]:[]),...(pot.slot===0?[{name:t('Completed rounds','Završena kola'),type:'athlete_finishes' as GuidedRewardType,category:null},{name:t('Athlete kilometres','Kilometri sportaša'),type:'athlete_metres' as GuidedRewardType,category:null},{name:t('Club kilometres','Klupski kilometri'),type:'club_metres' as GuidedRewardType,category:null}]:[])];
 return <article className={exact.studio}>
  <header className={exact.header}><p>{t('Sponsor setup','Postavljanje sponzorstva')}</p><h1>{t('Set up your rewards','Postavite svoje nagrade')}</h1></header>
  <div className={exact.event}><div><h2>{sourceName}</h2><p>{organization?`${organization} · `:''}{raceSlot?t('Race sponsorship','Sponzorstvo utrke'):`${meta.pots.filter(p=>p.slot>0).length} ${t('rounds','kola')}`}</p></div><Link to={detailHref}>{t('Event details','Detalji događaja')}</Link></div>
  <nav className={exact.steps} aria-label={t('Campaign sections','Odjeljci kampanje')}>{[t('Budget & terms','Fond i uvjeti'),t('Reward rules','Pravila nagrada'),t('Review','Pregled')].map((label,i)=><button key={label} aria-current={index===i?'step':undefined} data-complete={index>i} disabled={reviewUnsaved} onClick={()=>i===1?navigatePot(raceSlot||0):go(i===0?1:5)}><span>{index>i?'✓':i+1}</span>{label}</button>)}</nav>
  {props.sourceLocked?<section className={s.savedRules}><LockKeyhole size={19}/><div><strong>{t('Viewing saved rules','Pregled spremljenih pravila')} · {t('Revision','Verzija')} {props.revision}</strong><p>{t('Saved terms stay fixed. Continue to your campaign for creation and funding.','Spremljeni uvjeti ostaju fiksni. Nastavite na kampanju za izradu i uplatu.')}</p></div></section>:null}
  {!props.copySource&&sourceState.status!=='ready'?<SponsorSourceStatus state={sourceState} hr={hr} readOnly={Boolean(props.sourceLocked)}/>:null}
  {scopeConflict?<p role="alert" className={s.notice}>{t('This draft includes rewards outside the selected race. Update the event selection before finishing.','Nacrt uključuje nagrade izvan odabrane utrke. Ažurirajte odabir događaja prije dovršetka.')}</p>:null}
  {props.error}{error?<p role="alert" className={s.notice}>{error}</p>:null}{reviewUnsaved?<p role="status" className={s.notice}>{t('Save or discard the contribution review before leaving this step.','Spremite ili odbacite provjeru doprinosa prije napuštanja koraka.')}</p>:null}
  <div className={exact.layout}><div className={exact.main}>
  {step===1?<><SponsorFundingWorkspace configuration={c} onChange={props.onChange} hr={hr} disabled={disabled} readOnly={Boolean(props.sourceLocked)} stage="pot" raceSlot={raceSlot||undefined} onNavigate={navigatePot}/>{!props.copySource&&auth.account?.hasOrganizerAccess&&catalogue&&selection?<details className={exact.advanced}><summary>{t('Review results','Pregled rezultata')}</summary><Suspense fallback={<p>{t('Loading…','Učitavanje…')}</p>}><Metrics selection={selection} hr={hr} onReviewUnsavedChange={setReviewUnsaved}/></Suspense></details>:null}</>:null}
  {step===3||step===4?<>{!raceSlot?<label className={exact.potSelect}>{t('Editing rules for','Uređivanje pravila za')}<select aria-label={t('Reward pot','Fond nagrada')} value={pot.slot} disabled={reviewUnsaved} onChange={e=>navigatePot(Number(e.target.value))}>{allocatedPots.map(p=><option value={p.slot} key={p.nodeId}>{c.root.children.find(n=>n.id===p.nodeId)!.name}</option>)}{!allocatedPots.some(p=>p.nodeId===pot.nodeId)?<option value={pot.slot}>{potNode.name}</option>:null}</select></label>:null}<div className={exact.potBanner}><strong>{potName(potNode)}</strong><strong>{amount(potNode.id)} <small>test MON</small></strong></div>
   {potNode.children.filter(visible).map(editor)}
   {!props.sourceLocked?available.filter(option=>!potNode.children.some(n=>option.category?n.rule?.source?.categoryId===option.category.id:meta.groups.some(g=>g.nodeId===n.id&&g.type===option.type))).map(option=><section className={exact.category} key={option.category?.id??option.type}><label className={exact.categoryHeader}><input type="checkbox" checked={false} disabled={disabled||Boolean(option.category&&pot.slot>0&&!pot.roundId)} onChange={()=>choose(option.type,option.category)}/>{option.name}<small>{option.type.startsWith('club')?t('Club','Klub'):t('Individual','Pojedinac')}</small></label></section>):null}
   {!props.sourceLocked&&unbound?<details className={exact.advanced}><summary>{t('Draft reward categories','Nacrt kategorija nagrada')}</summary>{sponsorDraftCategories.filter(cat=>!potNode.children.some(n=>matchesSponsorDraftCategory(n,cat))).map(cat=><label className={exact.categoryHeader} key={cat.key}><input type="checkbox" checked={false} disabled={disabled} onChange={()=>chooseDraft(cat)}/>{sponsorDraftCategoryName(cat,hr)}</label>)}</details>:null}
   {!potNode.children.length&&!available.length?<SponsorPreparedCategoryPreview selection={c.sponsorSelection} status={sourceState.status} hr={hr}/>:null}
   <div className={exact.balance} data-complete={sum(potNode)===10000}><strong>{t('Categories total','Ukupno kategorije')} {sum(potNode)/100}%</strong><button className={exact.outline} disabled={disabled||!potNode.children.length} onClick={()=>editNode(potNode.id,n=>({...n,children:n.children.map(child=>balanceSponsorCategories(n.children.filter(visible),true).find(a=>a.id===child.id)??child)}))}>{t('Balance shares','Uskladi udjele')}</button></div>
   {!props.copySource&&!props.sourceLocked?<details className={exact.advanced}><summary>{raceSlot?t('Apply rules to more categories','Primijeni pravila na više kategorija'):t('Apply rules to more categories or rounds','Primijeni pravila na više kategorija ili kola')}</summary><button className={s.secondary} disabled={disabled||!potNode.children.length} onClick={()=>setBulkEditing(!bulkEditing)}>{t('Set up multiple categories','Postavi više kategorija')}</button>{bulkEditing?<SponsorBulkCategories key={potNode.id} configuration={c} pot={potNode} catalogue={catalogue} hr={hr} disabled={disabled} onClose={()=>setBulkEditing(false)} onApply={(ids,settings)=>safely(()=>applySponsorCategorySettings(c,potNode.id,ids,settings))}/>:null}{step===3&&!raceSlot?<SponsorRaceScope configuration={c} sourceId={potNode.id} hr={hr} disabled={disabled} onApply={ids=>safely(()=>applySponsorRaceDistribution(c,potNode.id,ids,catalogue,()=>crypto.randomUUID()))}/>:null}</details>:null}
  </>:null}
  {step===5?<section className={s.review}><h2>{t('Review your campaign','Pregledajte kampanju')}</h2><p className={exact.hint}>{t('Check your prize pool, rules and terms before saving.','Provjerite fond, pravila i uvjete prije spremanja.')}</p><div className={s.reviewPots}>{c.root.children.filter(n=>n.shareBps>0).map(n=>{const slot=meta.pots.find(p=>p.nodeId===n.id)!.slot;return <section className={s.reviewPot} key={n.id}><div><h2>{potName(n)}</h2><strong>{amount(n.id)} <small>test MON</small></strong><button className={exact.outline} onClick={()=>navigatePot(slot)}>{props.sourceLocked?t('View','Pregledaj'):t('Edit','Uredi')}</button></div>{n.children.map(child=>{const row=preview?.rows.find(r=>r.id===child.id);return <section className={s.reviewCategory} key={child.id}><div className={s.reviewRow}><strong>{child.name}</strong><span>{child.shareBps/100}% · {amount(child.id)} test MON</span></div>{child.rule?.sharesBps.length?<div className={s.reviewPrizes}><table><caption>{t('Planned prizes by place','Planirane nagrade po mjestu')}</caption><thead><tr><th>{t('Place','Mjesto')}</th><th>%</th><th>test MON</th></tr></thead><tbody>{child.rule.sharesBps.map((share,i)=><tr key={i}><td>#{i+1}</td><td>{share/100}%</td><td>{setupAmount(row?.slots[i]??null,hr)}</td></tr>)}</tbody></table></div>:<p className={exact.hint}>{t('Shared by verified contribution.','Dijeli se prema potvrđenom doprinosu.')}</p>}</section>;})}{!n.children.length?<p>{t('Choose categories','Odaberite kategorije')}</p>:null}</section>;})}</div><p className={s.reviewTerms}>{t('Claim window','Rok preuzimanja')}: {c.policy?.claimWindowDays} {t('days after claims open','dana nakon otvaranja preuzimanja')} <button onClick={()=>go(1)}>{props.sourceLocked?t('View terms','Pregledaj uvjete'):t('Edit terms','Uredi uvjete')}</button></p>{!allocationComplete?<p role="alert" className={s.notice}>{t('Allocate each funded pot and its prizes to 100% before completing setup.','Prije dovršetka rasporedite svaki financirani fond i njegove nagrade do 100%.')}</p>:null}{props.isSaved&&!launchReady?<p role="status">{t('Draft saved. Connect the official event and reward categories before launch.','Nacrt spremljen. Povežite službeni događaj i kategorije prije pokretanja.')}</p>:null}</section>:null}
  <footer className={s.footer}><div>{index===0?<Link to="/rewards/events" aria-disabled={reviewUnsaved} onClick={e=>{if(reviewUnsaved)e.preventDefault();}}><ArrowLeft size={16}/>{t('Back','Natrag')}</Link>:<button disabled={reviewUnsaved} onClick={()=>index===2?navigatePot(raceSlot||0):go(1)}><ArrowLeft size={16}/>{t('Back','Natrag')}</button>}</div><div>{!props.sourceLocked&&(index<reviewIndex||!props.canSave||!launchReady||props.disabled&&!props.busy)?<fieldset disabled={reviewUnsaved}>{props.saveAction}</fieldset>:null}{index===reviewIndex&&props.sourceLocked&&props.launchHref?<Link className={s.primary} to={props.launchHref}>{t('Go to campaign','Otvori kampanju')}</Link>:null}{index===reviewIndex&&!props.sourceLocked?<button className={s.primary} disabled={!props.canSave||disabled||!allocationComplete||scopeConflict||sourceState.selected&&!launchReady} onClick={props.onFinish}>{props.busy?t('Saving…','Spremanje…'):props.copySource?t('Save & preview allocations','Spremi i pregledaj raspodjelu'):t('Save rules and continue','Spremi pravila i nastavi')}</button>:null}{index<reviewIndex?<button className={s.primary} disabled={reviewUnsaved||!props.sourceLocked&&!preview} onClick={()=>index===0?navigatePot(raceSlot||0):go(5)}>{t('Continue','Nastavi')}<ArrowRight size={16}/></button>:null}</div></footer>
  </div><SponsorBudgetSummary configuration={c} selectedRace={raceSlot?{slot:raceSlot,name:sourceName}:undefined} hr={hr} status={props.saveStatus} saved={props.isSaved}/></div>
 </article>;
}
