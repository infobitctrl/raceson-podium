import {useEffect,useRef,useState} from 'react';
import {Link,useSearchParams,useParams,useNavigate} from 'react-router-dom';
import {apiRequest,ApiError} from '@/lib/api';
import {useAuth} from '@/lib/auth';
import {useI18n} from '@/shared/i18n/I18nContext';
import {decodeRewardSetup,type RewardDistributionSetup,type SavedRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import {useSponsorCatalogue} from '../data/copyCatalogue';
import {readRewardSetup,saveRewardSetup} from '../data/distributionSetups';
import {useRewardSessionEpoch} from '../model/useRewardSessionEpoch';
import SponsorCampaignStudio from '../components/SponsorCampaignStudio';
import s from '../components/Podium.module.css';

function Editor(){
 const {locale}=useI18n(),hr=locale==='hr';
 const [search,setSearch]=useSearchParams(),params=useParams(),navigate=useNavigate(),id=search.get('setup')??params.id;
 const {copy,error:catalogueError,loading:catalogueLoading}=useSponsorCatalogue();
 const [draft,setDraft]=useState<{id:string;configuration:RewardDistributionSetup}|null>(null),[saved,setSaved]=useState<SavedRewardSetup|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0),[conflict,setConflict]=useState(false);
 const [step,setStep]=useState(id?5:1),pending=useRef<{requestId:string;expectedRevision:number;configuration:RewardDistributionSetup}|null>(null);
 const alive=useRef(true),lock=useRef(false),resumeFunding=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  if(!copy)return;
  let current=true;setError('');setBusy(true);
  void (async()=>{
   if(id){const record=await readRewardSetup(id);return {record,value:record};}
   const result=await apiRequest<{id:string;configuration:unknown}>({path:'/v1/rewards/demo-copy/sponsor-source',cache:'no-store'});
   const config=decodeRewardSetup(result.configuration),edition=search.get('eventEditionId'),race=search.get('raceId');
   if(search.get('sourceLeagueId')!==copy.sourceLeagueId||search.get('sourceSeasonId')!==copy.sourceSeasonId)throw Error('selection');
   const round=edition?copy.rounds.find(r=>r.eventEditionId===edition):undefined,track=race?round?.tracks.find(t=>t.raceId===race):undefined;
   if(edition&&!round||race&&!track)throw Error('selection');
   config.sponsorSelection={sourceLeagueId:copy.sourceLeagueId,sourceSeasonId:copy.sourceSeasonId,eventEditionId:edition,...(race?{raceId:race}:{})};
   config.name=track?.name??round?.name??copy.name;config.budgetMon='';
   if(round)config.root.children=config.root.children.map((n,i)=>({...n,shareBps:i===round.slot?10000:0}));
   return {record:null,value:{id:result.id,configuration:config}};
  })().then(({record,value})=>{if(current){setDraft(value);setSaved(record);pending.current=null;resumeFunding.current=false;setConflict(false);}}).catch(()=>{if(current)setError('The selected campaign could not be opened. Use the sponsor account and an event from this catalogue.');}).finally(()=>{if(current)setBusy(false);});
  return()=>{current=false;};
 // Query changes between editor steps do not reload an unsaved campaign.
 },[id,copy?.sourceSeasonId,reload]);
 const dirty=!!draft&&JSON.stringify(draft.configuration)!==JSON.stringify(saved?.configuration);
 useEffect(()=>{if(!dirty)return;const leave=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty]);
 async function save(continueToFunding=false){
  if(!draft||lock.current||conflict)return;
  if(continueToFunding&&saved&&!dirty){navigate(`/rewards/campaigns/${saved.id}`,{replace:true});return;}
  if(!pending.current)resumeFunding.current=continueToFunding;
  try{pending.current??={requestId:crypto.randomUUID(),expectedRevision:saved?.revision??0,configuration:decodeRewardSetup(draft.configuration)};}catch{setError('Check the budget and reward shares.');return;}
  lock.current=true;setBusy(true);setError('');
  try{const record=await saveRewardSetup(draft.id,pending.current);if(alive.current){pending.current=null;setSaved(record);setDraft(record);if(continueToFunding||resumeFunding.current)navigate(`/rewards/campaigns/${record.id}`,{replace:true});else{setStep(5);setSearch({setup:record.id},{replace:true});}}}
  catch(e){if(alive.current){if(e instanceof ApiError&&[400,401,403,404,409].includes(e.status)){pending.current=null;resumeFunding.current=false;if(e.status===409)setConflict(true);setError(e.status===409?'This campaign changed. Reopen the saved revision.':'The campaign could not be saved. Check your sponsor session and reward settings.');}else setError('Save is not confirmed. Retry the same save before editing.');}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 if(!draft||!copy)return <article className={s.page}><h1>Set up your rewards</h1><p role={error||catalogueError?'alert':'status'}>{error|| (catalogueError?'The verified event catalogue could not be loaded.':busy||catalogueLoading?'Loading campaign…':'Opening event…')}</p>{error||catalogueError?<button onClick={()=>setReload(n=>n+1)}>Try again</button>:null}</article>;
 const c=draft.configuration,round=copy.rounds.find(r=>r.eventEditionId===c.sponsorSelection?.eventEditionId),track=round?.tracks.find(t=>t.raceId===c.sponsorSelection?.raceId);
 const sorted=[...copy.categories].sort((a,b)=>a.competitionId.localeCompare(b.competitionId)||a.id.localeCompare(b.id));
 const selectedPot=c.root.children.find(p=>c.guided?.pots.some(g=>g.nodeId===p.id&&g.slot===round?.slot));
 // The frozen copy template orders fixed category nodes by competition UUID, then classification UUID.
 const tracks=(track?[track]:round?.tracks??[]).map(t=>({id:t.raceId,name:t.name,categoryIds:sorted.filter(cat=>cat.competitionId===t.competitionId).map(cat=>cat.id),nodeIds:selectedPot?.children.filter((_n,i)=>sorted[i]?.competitionId===t.competitionId).map(n=>n.id)??[]}));
 const visibleGroups=track?new Set(c.root.children.flatMap(p=>p.children.filter((_n,i)=>sorted[i]?.competitionId===track.competitionId).map(n=>n.id))):undefined;
 return <><SponsorCampaignStudio campaign configuration={c} copySource={{name:track?.name??round?.name??copy.name,slot:round?.slot??0,visibleGroups,tracks}} setupId={saved?.id}
  onChange={configuration=>{if(!busy&&!pending.current&&!conflict){setDraft({...draft,configuration});setError('');}}} step={step} onStep={setStep} disabled={busy||!!pending.current||conflict} hr={hr} selection={null} initialProgramme={null} onLoaded={()=>{}}
  busy={busy} canSave={true} isSaved={!!saved&&!dirty} revision={saved?.revision??null} saveStatus={saved&&!dirty?`Saved · revision ${saved.revision}`:'Unsaved changes'} onFinish={()=>void save(true)}
  error={error?<p role="alert">{error}{conflict?<button onClick={()=>setReload(n=>n+1)}>Reopen saved revision</button>:null}</p>:null}
  saveAction={<button className={s.primary} disabled={busy||conflict||!dirty} onClick={()=>void save()}>{pending.current?'Retry save':'Save campaign'}</button>}/>
  </>;
}
export default function CopySponsorCampaign(){
 const auth=useAuth(),epoch=useRewardSessionEpoch(auth.session),[search]=useSearchParams();
 if(auth.isLoading)return <p role="status">Loading account…</p>;
 if(!auth.user||!auth.session||auth.account?.userId!==auth.user.id)return <article className={s.page}><h1>Set up your rewards</h1><p>Sign in with the demo sponsor account to configure prizes for the selected event.</p><Link className={s.primary} to={`/auth?next=${encodeURIComponent(`/rewards/create?${search}`)}`}>Sign in</Link></article>;
 return <Editor key={`${auth.user.id}:${epoch}`}/>;
}
