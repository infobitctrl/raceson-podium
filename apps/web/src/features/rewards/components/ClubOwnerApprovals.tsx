import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {clubOwnerAwards,type ClubOwnerAward} from '../data/clubOwnerApprovals';
const DirectClubClaim=lazy(()=>import('./DirectClubClaims').then(module=>({default:module.DirectClubClaim})));
import RewardClaimDialog from './RewardClaimDialog';
import {setupAmount} from '../model/setupAmount';
import {Button} from '@/components/ui/button';
import ClubMultisigStatus from './ClubMultisigStatus';
export default function ClubOwnerApprovals({hr,clubId,onAccessError}:{hr:boolean;clubId?:string;onAccessError?:(e:unknown)=>void}){
 const [items,setItems]=useState<ClubOwnerAward[]>([]),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<ClubOwnerAward|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(false);const epoch=useRef(0),access=useRef(onAccessError);access.current=onAccessError;
 const load=useCallback(async(after:string|null=null)=>{const ticket=++epoch.current;setBusy(true);setError(false);
  try{const page=await clubOwnerAwards(after);if(ticket!==epoch.current)return;setItems(previous=>after?[...previous,...page.items]:page.items);setCursor(page.nextCursor);}
  catch(e){if(ticket!==epoch.current)return;setError(true);setItems([]);setSelected(null);setCursor(null);if(e&&typeof e==='object'&&'status'in e&&[401,403].includes(Number(e.status)))access.current?.(e);}
  finally{if(ticket===epoch.current)setBusy(false);}
 },[]);
 const cancel=useCallback(()=>{epoch.current++;},[]);
 useEffect(()=>{void load();return cancel;},[load,cancel]);
 const creation=useMemo(()=>selected?{creationId:selected.creationId,safeAddress:selected.safeAddress}:undefined,[selected]);
 const visibleItems=clubId?items.filter(item=>item.award.clubId===clubId):items;
 const t=(en:string,local:string)=>hr?local:en;
 return <section className="space-y-3 rounded-xl border p-4" aria-label={t('Club treasury approvals','Odobrenja klupske riznice')}>
  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('Club treasury approvals','Odobrenja klupske riznice')}</h2><Button variant="outline" size="sm" disabled={busy} onClick={()=>void load()}>{t('Refresh approvals','Osvježi odobrenja')}</Button></div>
  <p className="text-sm text-muted-foreground">{t('Club rewards for treasuries where you are a selected owner. Two owners approve each action from their own accounts.','Klupske nagrade za riznice u kojima ste odabrani vlasnik. Dva vlasnika odobravaju svaku radnju iz vlastitih računa.')}</p>
  {busy?<p role="status">{t('Loading approvals…','Učitavanje odobrenja…')}</p>:null}
  {error?<p role="alert">{t('Approvals could not be verified. Refresh to retry.','Odobrenja nije moguće provjeriti. Osvježite za ponovni pokušaj.')}</p>:null}
  {!busy&&!error&&!visibleItems.length?<p className="text-sm text-muted-foreground">{t('No club rewards awaiting your treasury approval.','Nema klupskih nagrada koje čekaju vaše odobrenje.')}</p>:null}
  <ul className="space-y-2">{visibleItems.map(item=><li key={item.cursor} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3"><div><strong>{item.clubName}</strong><p className="text-sm">{setupAmount(BigInt(item.award.amountWei),hr)} test MON · {item.award.slot===0?t('League','Liga'):`${t('Round','Kolo')} ${item.award.slot}`}</p>{!busy?<ClubMultisigStatus item={item} hr={hr} onAccessError={onAccessError}/>:null}</div><Button variant="outline" onClick={()=>setSelected(item)}>{item.award.directClaim?.paid?t('View payment','Pregledaj isplatu'):t('Review club reward','Pregledaj klupsku nagradu')}</Button></li>)}</ul>
  {cursor?<Button variant="outline" disabled={busy} onClick={()=>void load(cursor)}>{t('Load more approvals','Učitaj još odobrenja')}</Button>:null}
  {selected&&creation?<RewardClaimDialog club hr={hr} onClose={()=>{setSelected(null);void load();}}>{onBusy=><Suspense fallback={<p role="status">{t('Loading approval…','Učitavanje odobrenja…')}</p>}><DirectClubClaim key={selected.cursor} award={selected.award} fixedCreation={creation} hr={hr} onBusy={onBusy} onAccessError={onAccessError}/></Suspense>}</RewardClaimDialog>:null}
 </section>;
}
