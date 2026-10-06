import {useEffect,useState} from 'react';
import {formatUnits} from 'viem';
import {readHostedReviewSources} from '../data/hostedReviewSources';
import HostedReviewWorkspace from './HostedReviewWorkspace';
import {setupAmount} from '../model/setupAmount';
import p from '../components/Podium.module.css';
import s from './RewardReviewQueue.module.css';
type Queue=Awaited<ReturnType<typeof readHostedReviewSources>>;
export default function HostedReviewQueue({hr,requestedCampaign=null,requestedSlot=null}:{hr:boolean;requestedCampaign?:string|null;requestedSlot?:number|null}){
 const [data,setData]=useState<Queue|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0),[selected,setSelected]=useState('');
 useEffect(()=>{let current=true;setData(null);setError(false);setSelected('');void readHostedReviewSources().then(v=>{if(current)setData(v);}).catch(()=>{if(current)setError(true);});return()=>{current=false;};},[retry,requestedCampaign,requestedSlot]);
 if(error)return <section className={p.empty}><p role="alert">{hr?'Izvori za pregled nisu potvrđeni. Osvježite pristup i verzije kampanja.':'Review sources could not be verified. Reload to check current access and campaign versions.'}</p><button className={p.secondary} onClick={()=>setRetry(n=>n+1)}>{hr?'Pokušaj ponovno':'Retry'}</button></section>;
 if(!data)return <p role="status">{hr?'Provjera kampanja…':'Checking campaigns…'}</p>;
 const chosen=data.items.find(i=>i.id===(selected||requestedCampaign));
 if(chosen)return <HostedReviewWorkspace key={chosen.id+':'+chosen.launchId} campaign={{id:chosen.id,name:chosen.name,revision:chosen.revision}} hr={hr} requestedSlot={chosen.id===requestedCampaign?requestedSlot:null} onBack={()=>setSelected('queue')}/>;
 return <><header className={p.heading}><div><span className={p.eyebrow}>{hr?'Pregled':'Review'}</span><h1>{hr?'Red za pregled nagrada':'Award review queue'}</h1><p>{hr?'Pregledajte rezultate, nagrade i uplatu sponzoriranih događaja.':'Review results, awards and funding for sponsored events.'}</p></div></header><div className={s.queue}>{data.items.map(item=><div key={item.id} className={s.row}>
  <div><button className={s.title} onClick={()=>setSelected(item.id)}>{item.name}</button><p>{item.pools.map(p=>p.name).join(' · ')}</p></div>
  <strong title={`${formatUnits(BigInt(item.budgetWei),18)} test MON`}>{setupAmount(BigInt(item.budgetWei),hr)} <small>test MON</small></strong>
  <span className={p.badge}>{item.executionState==='awaiting_contract'?(hr?'Čeka izradu ugovora':'Awaiting contract'):item.executionState==='awaiting_funding'?(hr?'Čeka uplatu':'Awaiting funding'):(hr?'Uplatu treba provjeriti':'Funding needs confirmation')}</span>
 </div>)}{!data.items.length?<p className={p.empty}>{hr?'Sponzor još nije nastavio s financiranjem spremljenih pravila.':'No sponsor has continued to funding with saved rules yet.'}</p>:null}</div>
 {requestedCampaign&&!chosen&&!selected?<p role="status">{hr?'Odabrana kampanja nije dostupna za pregled.':'The requested campaign is not available for review.'}</p>:null}

 </>;
}
