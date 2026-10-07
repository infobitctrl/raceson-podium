import {useEffect,useRef,useState} from 'react';
import {decodeBrandingChange,type SponsorPromotion,type CampaignBranding} from '@raceson/domain/rewards/campaign-branding';
import {readCampaignBranding,saveCampaignBranding} from './campaignBranding';
const empty:SponsorPromotion={name:'',logo:null,website:null,promotion:null};
const fields=(record:CampaignBranding):SponsorPromotion=>({name:record.name??'',logo:record.logo,website:record.website??null,promotion:record.promotion??null});
const same=(a:SponsorPromotion,b:SponsorPromotion)=>a.name===b.name&&a.logo===b.logo&&(a.website??null)===(b.website??null)&&(a.promotion??null)===(b.promotion??null);
export function useSponsorPromotion(id:string|undefined){
 const [value,setValue]=useState<SponsorPromotion>(empty),[saved,setSaved]=useState<SponsorPromotion>(empty),[revision,setRevision]=useState(0),[loading,setLoading]=useState(Boolean(id)),[failed,setFailed]=useState(false),[reading,setReading]=useState(false),[attempt,setAttempt]=useState(0);
 const alive=useRef(true),loaded=useRef<string|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!id||loaded.current===id)return;let current=true;setLoading(true);setFailed(false);void readCampaignBranding(true).then(rows=>{if(!current)return;const record=rows.find(row=>row.id===id);if(!record)throw Error('branding_unavailable');const next=fields(record);setValue(next);setSaved(next);setRevision(record.revision);loaded.current=id;}).catch(()=>{if(current)setFailed(true);}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[id,attempt]);
 const dirty=!same(value,saved),present=Boolean(value.name.trim()||value.logo||value.website||value.promotion);
 let valid=true;try{if(present||dirty)decodeBrandingChange({...value,expectedRevision:revision});}catch{valid=false;}
 async function persist(setupId:string){
  if(loading||failed||reading||!valid)throw Error('sponsor_details_required');
  if(!dirty)return;
  const change=decodeBrandingChange({...value,expectedRevision:revision});
  let record:CampaignBranding;
  try{record=await saveCampaignBranding(setupId,change);}catch(error){
   // Recover a lost response only when the exact presentation revision is visible.
   const confirmed=await readCampaignBranding(true).then(rows=>rows.find(row=>row.id===setupId)).catch(()=>null);
   if(!confirmed||confirmed.revision!==revision+1||!same(fields(confirmed),change))throw error;
   record=confirmed;
  }
  if(!alive.current)throw Error('retired_session');
  loaded.current=setupId;setSaved(fields(record));setValue(fields(record));setRevision(record.revision);
 }
 return {value,setValue,dirty,present,valid,loading,failed,reading,setReading,persist,retry:()=>{loaded.current=null;setAttempt(n=>n+1);}};
}
