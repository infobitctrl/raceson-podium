import {useEffect,useRef,useState} from "react";
import {Link,useSearchParams} from "react-router-dom";
import {useAuth} from "@/lib/auth";
import {useI18n} from "@/shared/i18n/I18nContext";
import {ApiError} from "@/lib/api";
import {decodeTestProgrammeConfiguration,testProgrammeId,type SavedTestProgramme as Record,type TestProgrammeConfiguration} from "@raceson/domain/rewards/test-programme";
import {readTestProgramme,saveTestProgramme} from "../data/testProgrammes";
import {useRewardSessionEpoch} from "../model/useRewardSessionEpoch";
import TestRewardProgramme from "./TestRewardProgramme";
import styles from "../components/RewardWorkspace.module.css";

function Editor({id}:{id:string|null}){
 const {locale}=useI18n(),hr=locale==="hr",[,setSearch]=useSearchParams();
 const [record,setRecord]=useState<Record|null>(null),[loading,setLoading]=useState(Boolean(id)),[loadFailed,setLoadFailed]=useState(false),[retry,setRetry]=useState(0);
 const [busy,setBusy]=useState(false),[outcome,setOutcome]=useState<"unknown"|"conflict"|"failed"|null>(null);
 const [newId]=useState(()=>crypto.randomUUID());const active=useRef(true);
 const request=useRef<{requestId:string;expectedRevision:number;configuration:TestProgrammeConfiguration}|null>(null);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{if(!id)return;let current=true;setLoading(true);setLoadFailed(false);
  void readTestProgramme(id).then(value=>{if(current)setRecord(value);}).catch(()=>{if(current)setLoadFailed(true);}).finally(()=>{if(current)setLoading(false);});
  return()=>{current=false;};
 },[id,retry]);
 async function save(configuration:TestProgrammeConfiguration){
  if(busy)return;
  try{configuration=decodeTestProgrammeConfiguration(configuration);}catch{setOutcome("failed");return;}
  const fixed=request.current??{requestId:crypto.randomUUID(),expectedRevision:record?.revision??0,configuration};
  request.current=fixed;setBusy(true);setOutcome(null);
  try{
   const value=await saveTestProgramme(id??newId,fixed);if(!active.current)return;
   setRecord(value);request.current=null;
   if(!id)setSearch({test:value.id},{replace:true});
  }catch(error){if(!active.current)return;
   if(error instanceof ApiError && error.code==="reward_test_limit"){request.current=null;setOutcome("failed");}
   else if(error instanceof ApiError && error.status===409)setOutcome("conflict");
   else if(error instanceof ApiError && [400,401,403,404].includes(error.status)){request.current=null;setOutcome("failed");}
   else setOutcome("unknown");
  }finally{if(active.current)setBusy(false);}
 }
 async function inspect(){
  setBusy(true);
  try{const value=await readTestProgramme(id??newId);if(!active.current)return;request.current=null;setOutcome(null);
   if(!id)setSearch({test:value.id},{replace:true});else {setRecord(value);setRetry(n=>n+1);}
  }catch{if(active.current)setOutcome("unknown");}finally{if(active.current)setBusy(false);}
 }
 if(loading)return <p role="status" className="p-6">{hr?"Učitavanje testa…":"Loading test programme…"}</p>;
 if(loadFailed)return <section className={styles.page}><h1>{hr?"Test nije dostupan":"Test programme unavailable"}</h1><p role="alert">{hr?"Test nije pronađen ili ga ne možete otvoriti.":"The test could not be found or opened for this account."}</p><button onClick={()=>setRetry(n=>n+1)} className="underline">{hr?"Pokušaj ponovno":"Try again"}</button> · <Link to="/rewards/manage">{hr?"Moji programi":"My programmes"}</Link></section>;
 return <TestRewardProgramme key={`${id??newId}:${retry}`} initial={record?.configuration} saved={record} locked={busy||outcome==="unknown"||outcome==="conflict"}
  saveDisabled={busy||outcome==="conflict"} onSave={save} retrySave={outcome==="unknown"}
  notice={outcome?<div role="alert" className="my-4 rounded border p-4 text-sm"><p>{outcome==="unknown"?(hr?"Spremanje još nije potvrđeno. Ponovite isto spremanje ili provjerite spremljenu verziju.":"The save is not confirmed. Retry the same save or check the saved version."):outcome==="conflict"?(hr?"Spremljena verzija se promijenila. Učitajte je prije nastavka; nespremljene izmjene bit će zamijenjene.":"The saved version changed. Reload it to continue; this replaces your unsaved edits."):(hr?"Test nije spremljen. Provjerite postavke i prijavu.":"The test was not saved. Check your settings and sign-in.")}</p>
   {outcome!=="failed"?<button disabled={busy} className="mt-2 underline" onClick={()=>void inspect()}>{outcome==="conflict"?(hr?"Učitaj spremljenu verziju":"Reload saved version"):(hr?"Provjeri spremljenu verziju":"Check saved version")}</button>:null}</div>:null}/>
}
export default function SavedTestProgramme(){
 const auth=useAuth(),epoch=useRewardSessionEpoch(auth.session),[search]=useSearchParams(),{locale}=useI18n(),hr=locale==="hr";
 const id=search.get("test");
 if(auth.isLoading)return <p role="status" className="p-6">{hr?"Učitavanje…":"Loading…"}</p>;
 if(!auth.user||!auth.session||auth.account?.userId!==auth.user.id)return <TestRewardProgramme notice={<p className="my-4 text-sm"><Link className="underline" to={`/auth?next=${encodeURIComponent(`/rewards/test${id?`?test=${id}`:""}`)}`}>{hr?"Prijavite se za spremanje i otvaranje svojih testova.":"Sign in to save and reopen your tests."}</Link></p>}/>;
 if(id&&!testProgrammeId(id))return <p role="alert">{hr?"Neispravna poveznica testa.":"Invalid test programme link."}</p>;
 return <Editor key={`${auth.user.id}:${epoch}:${id??"new"}`} id={id}/>;
}
