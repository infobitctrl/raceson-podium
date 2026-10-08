import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {Pencil,X,BadgeCheck} from 'lucide-react';
import {useAuth} from '@/lib/auth';
import {ApiError} from '@/lib/api';
import {useRewardSessionEpoch} from '../model/useRewardSessionEpoch';
import {sponsorWebsiteHref,type CampaignBranding} from '@raceson/domain/rewards/campaign-branding';
import {readCampaignBranding,saveCampaignBranding} from '../data/campaignBranding';
import s from './CampaignSponsor.module.css';
import SponsorPromotionFields from './SponsorPromotionFields';
type BrandingContext={items:CampaignBranding[];owned:Set<string>;loading:boolean;failed:boolean;reload:()=>void;update:(record:CampaignBranding)=>void};
const Context=createContext<BrandingContext|null>(null);
export function CampaignSponsorProvider({children}:{children:ReactNode}){
 const auth=useAuth(),identity=auth.user?.id??'',epoch=useRewardSessionEpoch(auth.session),key=`${identity}:${epoch}`;
 const [value,setValue]=useState<{key:string;items:CampaignBranding[];owned:Set<string>}>({key:'',items:[],owned:new Set()}),[attempt,setAttempt]=useState(0),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false);
 useEffect(()=>{let active=true;setLoading(true);setFailed(false);
  void Promise.allSettled([readCampaignBranding(),identity?readCampaignBranding(true):Promise.resolve([])]).then(([publicResult,ownerResult])=>{
   if(!active)return;
   const published=publicResult.status==='fulfilled'?publicResult.value:[],mine=ownerResult.status==='fulfilled'?ownerResult.value:[];
   setValue({key,items:[...published.filter(p=>!mine.some(m=>m.id===p.id)),...mine],owned:new Set(mine.map(m=>m.id))});
   setFailed(publicResult.status==='rejected'||ownerResult.status==='rejected');
   setLoading(false);
  });
  return()=>{active=false;};
 },[key,identity,attempt]);
 const current=value.key===key;
 return <Context.Provider key={key} value={{items:current?value.items:[],owned:current?value.owned:new Set(),loading:loading||!current&&!failed,failed,reload:()=>setAttempt(n=>n+1),update:record=>setValue(old=>({...old,items:[...old.items.filter(i=>i.id!==record.id),record]}))}}>{children}</Context.Provider>;
}
/** Read-only branding received through the authorized review endpoint. */
export function CampaignSponsorRecords({children,records}:{children:ReactNode;records:CampaignBranding[]}){return <Context.Provider value={{items:records,owned:new Set(),loading:false,failed:false,reload:()=>{},update:()=>{}}}>{children}</Context.Provider>;}
function Logo({name,logo}:{name:string;logo:string|null}){
 return <span className={s.logo}>{logo?<img src={logo} alt=""/>:<span aria-hidden="true">{name.split(/\s+/).filter(Boolean).slice(0,2).map(p=>Array.from(p)[0]).join('').toUpperCase()}</span>}</span>;
}
export function CampaignSponsor({id,hr=false,compact=false,backing,fundingVerified=false}:{id:string;hr?:boolean;compact?:boolean;backing?:string;fundingVerified?:boolean}){
 const context=useContext(Context);
 if(!context)return <CampaignSponsorProvider><CampaignSponsor id={id} hr={hr} compact={compact} backing={backing} fundingVerified={fundingVerified}/></CampaignSponsorProvider>;
 return <SponsorDetails key={`${id}:${context.owned.has(id)}`} id={id} hr={hr} context={context} compact={compact} backing={backing} fundingVerified={fundingVerified}/>;
}
function SponsorDetails({id,hr,context,compact,backing,fundingVerified}:{id:string;hr:boolean;context:BrandingContext;compact:boolean;backing?:string;fundingVerified:boolean}){
 const t=(en:string,local:string)=>hr?local:en,record=context.items.find(i=>i.id===id),owned=context.owned.has(id);
 const [open,setOpen]=useState(false),[name,setName]=useState(''),[logo,setLogo]=useState<string|null>(null),[website,setWebsite]=useState<string|null>(null),[promotion,setPromotion]=useState<string|null>(null),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const populate=()=>{setName(record?.name??'');setLogo(record?.logo??null);setWebsite(record?.website??null);setPromotion(record?.promotion??null);setRevision(record?.revision??0);setError('');setSaved(false);};
 const close=()=>{setReading(false);setOpen(false);};
 const unavailable=context.failed&&!record;
 if(context.loading&&!record&&!backing&&!compact)return <div className={s.row} role="status">{t('Loading sponsor…','Učitavanje sponzora…')}</div>;
 const websiteHref=sponsorWebsiteHref(record?.website);
 const display=record?.name??t('Sponsor','Sponzor');
 if(compact)return <span className={s.compact}><Logo name={display} logo={record?.logo??null}/><strong>{record?.name??t('Campaign sponsor','Sponzor kampanje')}</strong></span>;
 return <div className={`${s.block} ${backing?s.featured:''}`} data-unavailable={unavailable}><div className={s.row}><Logo name={display} logo={record?.logo??null}/><span className={s.identity}><small>{t(backing?'Sponsor':'Sponsored by','Sponzor')}</small><strong>{record?.name??t('Campaign sponsor','Sponzor kampanje')}</strong>{fundingVerified&&record?<span className={s.verified} title={t('Sponsor contribution confirmed on chain','Uplata sponzora potvrđena na lancu')}><BadgeCheck size={14}/>{t('Funding verified','Uplata provjerena')}</span>:null}{backing?<span className={s.backing}>{t('Backing','Podržava')} <b>{backing}</b></span>:null}</span>{owned?<Dialog.Root open={open} onOpenChange={v=>{if(busy)return;if(v){populate();setOpen(true);}else close();}}><Dialog.Trigger className={s.edit} aria-label={`${t('Edit sponsor','Uredi sponzora')}: ${record?.name??id}`}><Pencil size={14}/>{t('Edit sponsor','Uredi sponzora')}</Dialog.Trigger><Dialog.Portal><Dialog.Overlay className={s.overlay}/><Dialog.Content className={s.dialog} onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onPointerDownOutside={e=>{if(busy)e.preventDefault();}}><Dialog.Title>{t('Sponsor details','Podaci sponzora')}</Dialog.Title><Dialog.Description>{t('Shown publicly on this campaign.','Javno prikazano na ovoj kampanji.')}</Dialog.Description><Dialog.Close className={s.close} disabled={busy} aria-label={t('Close','Zatvori')}><X size={20}/></Dialog.Close><form onSubmit={e=>{e.preventDefault();if(reading||busy)return;setBusy(true);setError('');void saveCampaignBranding(id,{name,logo,website,promotion,expectedRevision:revision}).then(next=>{context.update(next);setSaved(true);close();}).catch(e=>{setError(e instanceof ApiError&&e.status===409?t('Details changed in another window. Close and reopen this editor to load the latest version.','Podaci su izmijenjeni u drugom prozoru. Zatvorite i ponovno otvorite uređivač za najnoviju verziju.'):t('Could not save. Your changes are still here; try again.','Spremanje nije uspjelo. Izmjene su sačuvane; pokušajte ponovno.'));if(e instanceof ApiError&&e.status===409)context.reload();}).finally(()=>setBusy(false));}}>
 <SponsorPromotionFields value={{name,logo,website,promotion}} onChange={value=>{setName(value.name);setLogo(value.logo);setWebsite(value.website??null);setPromotion(value.promotion??null);}} disabled={busy} hr={hr} onPreparing={setReading}/>
 {error?<p role="alert" className={s.error}>{error}</p>:null}<div className={s.actions}><button type="button" disabled={busy} onClick={close}>{t('Cancel','Odustani')}</button><button className={s.save} type="submit" disabled={busy||reading||!name.trim()}>{busy?t('Saving…','Spremanje…'):reading?t('Preparing logo…','Priprema logotipa…'):t('Save sponsor','Spremi sponzora')}</button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>:null}</div>{websiteHref?<a className={s.website} href={websiteHref} target="_blank" rel="noopener noreferrer">{t('Visit sponsor website','Posjeti web-stranicu sponzora')}</a>:record?.website?<span className={s.website}>{record.website}</span>:null}{record?.promotion?<p className={s.promotion}>{record.promotion}</p>:null}{unavailable?<p className={s.unavailable} role="status">{t('Sponsor details are temporarily unavailable.','Podaci sponzora trenutačno nisu dostupni.')} <button onClick={context.reload}>{t('Retry sponsor details','Ponovi provjeru sponzora')}</button></p>:null}{saved?<small role="status">{t('Sponsor details saved','Podaci sponzora su spremljeni')}</small>:null}</div>;
}
