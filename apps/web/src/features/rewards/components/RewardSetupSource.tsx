import {useEffect,useRef,useState} from "react";
import {useAuth} from "@/lib/auth";
import {listPlanningDrafts,readPlanningDraft} from "../data/planningDrafts";
import {readSourceMapping} from "../data/sourceMapping";
import {readPublishedPreview} from "../data/publishedPreview";
import {previewSetupSource} from "@raceson/domain/rewards/distribution-setup-results";
import type {RewardSetupNode,RewardSetupSource as Source} from "@raceson/domain/rewards/distribution-setup";
import type {SavedRewardPlanningDraft} from "@raceson/domain/rewards/programme-draft-v2";
import type {RewardMappingWorkspaceV2} from "@raceson/domain/rewards/source-mapping-v2";
import type {StoredRewardSnapshot} from "@raceson/domain/rewards/published-preview-v2";
import {rewardSetupCopy} from "../model/rewardSetupCopy";
import {setupAmount} from "../model/setupAmount";
import s from "./RewardSetup.module.css";
export default function RewardSetupSource({node,slots,onChange,hr,disabled}:{node:RewardSetupNode;slots:bigint[];onChange:(source:Source|null)=>void;hr:boolean;disabled:boolean}){
 const c=rewardSetupCopy(hr),auth=useAuth(),[programmes,setProgrammes]=useState<SavedRewardPlanningDraft[]>([]),[draft,setDraft]=useState(node.rule?.source?.draftId??""),[option,setOption]=useState(""),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const [loaded,setLoaded]=useState<{workspace:RewardMappingWorkspaceV2;snapshot:StoredRewardSnapshot|null}|null>(null),[retry,setRetry]=useState(0);
 const generation=useRef(0);
 useEffect(()=>{const counter=generation;const gen=++counter.current;if(!auth.account?.hasOrganizerAccess)return;setBusy(true);setFailed(false);
  void listPlanningDrafts().then(rows=>{if(generation.current===gen)setProgrammes(rows);}).catch(()=>{if(generation.current===gen)setFailed(true);}).finally(()=>{if(generation.current===gen)setBusy(false);});return()=>{counter.current++;};
 },[auth.account?.hasOrganizerAccess,retry]);
 async function load(){const record=programmes.find(p=>p.draftId===draft);if(!record)return;const gen=++generation.current;setLoaded(null);setBusy(true);setFailed(false);
  try{const fresh=await readPlanningDraft(record),workspace=await readSourceMapping(fresh),published=await readPublishedPreview(fresh,workspace);if(generation.current!==gen)return;
   setLoaded({workspace,snapshot:published?.snapshot??null});setOption(node.rule?.source?.draftId===draft?`${node.rule.source.roundId??"league"}|${node.rule.source.categoryId}`:"");
  }catch{if(generation.current===gen)setFailed(true);}finally{if(generation.current===gen)setBusy(false);}
 }
 const basis=node.rule?.basis,roundBasis=basis==="race_position"||basis==="club_points",target=basis==="club_points"?"club":"individual";
 const options=loaded?roundBasis?loaded.workspace.catalogue.rounds.flatMap(round=>loaded.workspace.catalogue.categories.filter(cat=>cat.target===target&&round.races.some(r=>r.competitionId===cat.competitionId)).map(cat=>({value:`${round.id}|${cat.id}`,label:`${round.name} · ${cat.competitionName} · ${cat.name}`}))):loaded.workspace.catalogue.categories.filter(cat=>cat.target===target).map(cat=>({value:`league|${cat.id}`,label:`${cat.competitionName} · ${cat.name}`})):[];
 const result=loaded&&node.rule?.source&&slots.length===node.rule.sharesBps.length?previewSetupSource(node,slots,loaded.workspace,loaded.snapshot):null;
 if(!auth.user||!auth.account?.hasOrganizerAccess)return <p className={s.small}>{c.sourceSignedOut}</p>;
 return <div className={s.source}><p className={s.small}>{c.sourceHelp}</p>
  <label className={s.field}>{c.programme}<select value={draft} disabled={disabled||busy} onChange={e=>{generation.current++;setDraft(e.target.value);setLoaded(null);setOption("");setFailed(false);}}><option value="">{c.choose}</option>{programmes.map(p=><option value={p.draftId} key={p.draftId}>{p.organizationName} · {p.seasonName}</option>)}</select></label>
  <button className={s.button} disabled={!draft||busy||disabled} onClick={()=>void load()}>{busy?c.loading:c.inspect}</button>
  {failed?<p className={s.notice} role="alert">{c.sourceFailed} <button className={s.button} onClick={()=>{setLoaded(null);setRetry(n=>n+1);}}>{c.retry}</button></p>:null}
  {!busy&&!failed&&!programmes.length?<p className={s.small}>{c.sourceEmpty}</p>:null}
  {loaded?<><label className={s.field}>{hr?"Utrka i kategorija":"Race and category"}<select value={option} disabled={disabled} onChange={e=>setOption(e.target.value)}><option value="">{c.choose}</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label><button className={s.button} disabled={!options.some(o=>o.value===option)||disabled} onClick={()=>{const [round,categoryId]=option.split("|");onChange({draftId:draft,roundId:round==="league"?null:round,categoryId,catalogueHash:loaded.workspace.catalogueHash});}}>{c.connect}</button></>:null}
  {node.rule?.source?<><p className={s.success}>{c.connected}</p><button className={s.button} disabled={disabled} onClick={()=>onChange(null)}>{c.disconnect}</button></>:<p className={s.small}>{c.unconnected}</p>}
  {result?<div><h3>{c.resultPreview}</h3>{result.reason?<p className={s.notice}>{result.reason==="source_changed"?c.sourceChanged:result.reason==="review_required"?c.sourceReview:result.reason==="ambiguous_results"?c.sourceAmbiguous:c.held}</p>:result.awards.length?<div className={s.tableWrap}><table className={s.table}><thead><tr><th>{c.rank}</th><th>{c.recipient}</th><th>{c.amount}</th></tr></thead><tbody>{result.awards.map(row=><tr key={row.beneficiaryId}><td>{row.place}</td><td>{row.name??row.beneficiaryId}</td><td title={`${row.amountWei} wei`}>{setupAmount(row.amountWei,hr)}</td></tr>)}</tbody></table></div>:<p className={s.small}>{c.noRecipients}</p>}<p className={s.small}>{c.remaining}: {setupAmount(result.unusedWei,hr)} test MON</p><p className={s.small}>{c.sourceSnapshot}</p></div>:null}
 </div>;
}
