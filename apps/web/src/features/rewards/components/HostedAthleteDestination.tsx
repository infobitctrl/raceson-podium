import {useCallback,useEffect,useRef,useState} from 'react';
import AthleteProfileWallet from './AthleteProfileWallet';
import {getOwnRewardDestinations} from '../data/athleteDestinations';
import type {RewardDestination} from '../model/athleteDestinations';

/** Remounted by verified account/session epoch. A failed refresh retires all
 * old choices; incomplete pagination cannot authorize a replacement. */
export default function HostedAthleteDestination({profileId,hr}:{profileId:string;hr:boolean}){
 const [data,setData]=useState<{items:RewardDestination[];cursor:string|null}|null>(null);
 const [loading,setLoading]=useState(false),[failed,setFailed]=useState(false);
 const generation=useRef(0),flight=useRef(false);
 const load=useCallback(async(after:string|null=null)=>{
  if(flight.current)return;
  flight.current=true;const ticket=++generation.current;setLoading(true);setFailed(false);
  if(after===null)setData(null);
  try{
   const page=await getOwnRewardDestinations(after);
   if(generation.current!==ticket)return;
   setData(previous=>({items:after===null?page.items:[...(previous?.items??[]),...page.items],cursor:page.nextCursor}));
  }catch{if(generation.current===ticket){setData(null);setFailed(true);}}
  finally{if(generation.current===ticket){flight.current=false;setLoading(false);}}
 },[]);
 useEffect(()=>{const epoch=generation,pending=flight;void load();return()=>{epoch.current++;pending.current=false;};},[load]);
 return <>
  <p>{hr?'Odaberite odredište za svoj povezani sportski profil. Potpis dokazuje kontrolu novčanika; provjera identiteta i dobi te pristanak na pojedinu isplatu slijede zasebno.':'Choose a destination for your linked sporting profile. Your signature proves wallet control; identity and age review and consent to each payment remain separate.'}</p>
  <AthleteProfileWallet ready={!!data&&!loading} failed={failed} profiles={[profileId]} profileId={profileId} onProfile={()=>{}}
   destinations={data?.items??[]} complete={!!data&&data.cursor===null} refreshing={loading}
   onRefresh={()=>load()} onMore={()=>{if(data?.cursor)void load(data.cursor);}}/>
  {failed?<button type="button" disabled={loading} onClick={()=>void load()}>{hr?'Ponovno učitaj odredišta':'Reload destinations'}</button>:null}
 </>;
}
