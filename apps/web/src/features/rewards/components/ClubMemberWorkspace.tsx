import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {getRewardMemberClubs,type RewardMemberClub} from '../data/clubMemberships';
import ClubOwnerApprovals from './ClubOwnerApprovals';

/** Membership discovery is read-only. Signing still checks the selected owner
 * snapshot and current wallet on every request in DirectClubClaim. */
export default function ClubMemberWorkspace({hr,children}:{hr:boolean;children:ReactNode}){
 const [clubs,setClubs]=useState<RewardMemberClub[]>([]),[cursor,setCursor]=useState<string|null>(null);
 const [busy,setBusy]=useState(true),[error,setError]=useState(false);
 const [params,setParams]=useSearchParams(),epoch=useRef(0);
 const load=useCallback(async(after:string|null=null)=>{
  const ticket=++epoch.current;setBusy(true);setError(false);if(!after)setClubs([]);
  try{const page=await getRewardMemberClubs(after);if(ticket===epoch.current){setClubs(old=>after?[...old,...page.items]:page.items);setCursor(page.nextCursor);}}
  catch{if(ticket===epoch.current){setClubs([]);setCursor(null);setError(true);}}
  finally{if(ticket===epoch.current)setBusy(false);}
 },[]);
 const cancel=useCallback(()=>{epoch.current++;},[]);
 useEffect(()=>{void load();return cancel;},[load,cancel]);
 const t=(en:string,local:string)=>hr?local:en;
 const selected=clubs.find(c=>c.clubId===(params.get('club')??clubs[0]?.clubId));
 const loseAccess=()=>{epoch.current++;setClubs([]);setCursor(null);setError(true);setBusy(false);};
 return <div className="space-y-4">
  <Link className="text-primary underline" to="/athlete/rewards">{t('My athlete rewards','Moje osobne nagrade')}</Link>
  <section className="space-y-3 rounded-xl border bg-card p-4" aria-label={t('My clubs','Moji klubovi')}>
   <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('My clubs','Moji klubovi')}</h2><Button variant="outline" disabled={busy} onClick={()=>void load()}>{t('Refresh memberships','Osvježi članstva')}</Button></div>
   {busy?<p role="status">{t('Checking your club memberships…','Provjera vaših članstava…')}</p>:null}
   {error?<p role="alert">{t('Club memberships could not be verified. Refresh to retry.','Članstva nije moguće provjeriti. Osvježite za ponovni pokušaj.')}</p>:null}
   {!busy&&!error&&!clubs.length?<p>{t('No active club membership was found for this account. Your athlete rewards are still available.','Nema aktivnog članstva za ovaj račun. Vaše osobne nagrade i dalje su dostupne.')}</p>:null}
   {clubs.length>0?<><label className="block text-sm">{t('Your club','Vaš klub')}<select className="mt-1 block w-full rounded-md border bg-background p-2" value={selected?.clubId??''} onChange={e=>{const next=new URLSearchParams(params);next.set('club',e.target.value);setParams(next);}}><option value="" disabled>{t('Select a club','Odaberite klub')}</option>{clubs.map(c=><option key={c.clubId} value={c.clubId}>{c.name}</option>)}</select></label>
    {selected?<div><h3 className="font-semibold">{selected.name}</h3><p className="text-sm text-muted-foreground">{selected.canSign?t('Treasury signer · Review club rewards below and sign from your own account. Two selected owners must approve.','Potpisnik riznice · Pregledajte klupske nagrade i potpišite iz svog računa. Potrebna su dva odabrana vlasnika.'):t('Club member · Only the treasury’s selected owners can sign club reward requests.','Član kluba · Samo odabrani vlasnici riznice mogu potpisati zahtjeve za klupske nagrade.')}</p></div>:<p>{t('This club is not in your loaded memberships. Choose your club above or load more.','Ovaj klub nije u učitanim članstvima. Odaberite svoj klub ili učitajte više.')}</p>}</>:null}
   {cursor?<Button variant="outline" disabled={busy} onClick={()=>void load(cursor)}>{t('Load more clubs','Učitaj još klubova')}</Button>:null}
  </section>
  {!busy&&!error&&selected?.canSign?<ClubOwnerApprovals key={selected.clubId} clubId={selected.clubId} hr={hr} onAccessError={loseAccess}/>:null}
  {!busy&&!error&&clubs.some(c=>c.role==='manager')?children:null}
 </div>;
}
