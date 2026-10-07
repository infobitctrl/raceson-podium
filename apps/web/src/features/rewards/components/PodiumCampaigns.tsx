import {CampaignSponsor,CampaignSponsorProvider} from './CampaignSponsor';
import OfficialSourceLinks from './OfficialSourceLinks';
import {useRef} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {ArrowRight,ArrowUpDown,CalendarDays,Layers,LayoutGrid,List,Search} from 'lucide-react';
import {campaignStatus,campaignSum,type DirectoryCampaign} from '@raceson/domain/rewards/public-directory';
import {campaignSource,selectCampaigns,statusLabel,type CampaignSort} from '../model/podiumDirectory';
import {setupAmount} from '../model/setupAmount';
import {useI18n} from '@/shared/i18n/I18nContext';
import s from './Podium.module.css';
import d from './CampaignDirectory.module.css';
function ObservationTime({item,hr}:{item:DirectoryCampaign;hr:boolean}){
 const date=new Date(Number(item.campaign.blockTimestamp)*1000);
 return <small className={s.observationTime}>{hr?'Stanje provjereno':'Status checked'} <time dateTime={date.toISOString()}>{date.toLocaleString(hr?'hr-HR':'en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</time></small>;
}
export function CampaignCard({item,hr}:{item:DirectoryCampaign;hr:boolean}){
 const c=item.campaign,source=campaignSource(item);
 return <article className={s.card}><div className={s.photo}><img src={source.image} alt="" loading="lazy"/><span className={s.badge} data-state={campaignStatus(item)}>{statusLabel(item,hr)}</span></div><div className={s.cardBody}><h3><Link to={`/rewards/campaigns/${c.id}/public`}>{c.name}</Link></h3><CampaignSponsor id={c.id} hr={hr}/><OfficialSourceLinks selection={item.selection} hr={hr}/><div className={s.metadata}>{source.date?<span><CalendarDays size={15}/>{new Date(`${source.date}T12:00:00`).toLocaleDateString(hr?'hr-HR':'en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>:null}<span><Layers size={15}/>{c.pots.length} {hr?(c.pots.length%10===1&&c.pots.length%100!==11?'fond':c.pots.length%10>=2&&c.pots.length%10<=4&&(c.pots.length%100<12||c.pots.length%100>14)?'fonda':'fondova'):c.pots.length===1?'prize pot':'prize pots'}</span></div><ObservationTime item={item} hr={hr}/><div className={s.cardFoot}><div><strong>{setupAmount(BigInt(c.budgetWei),hr)} test MON</strong><small>{hr?'Uplaćeno':'Funded'}</small></div><div><strong>{item.verified?`${setupAmount(campaignSum(c,'paidWei'),hr)} test MON`:'—'}</strong><small>{hr?'Isplaćeno':'Paid'}</small></div><Link className={s.primary} to={`/rewards/campaigns/${c.id}/public`}>{hr?'Otvori':'View campaign'}<ArrowRight size={15}/></Link></div></div></article>;
}
function CampaignDirectoryCard({item,hr}:{item:DirectoryCampaign;hr:boolean}){
 const c=item.campaign,source=campaignSource(item),url=`/rewards/campaigns/${c.id}/public`;
 const totals=[
  {label:hr?'Uplaćeno':'Funded',value:setupAmount(BigInt(c.budgetWei),hr)},
  {label:hr?'Isplaćeno':'Paid',value:item.verified?setupAmount(campaignSum(c,'paidWei'),hr):null},
  {label:hr?'Vraćeno':'Returned',value:item.verified?setupAmount(campaignSum(c,'returnedWei'),hr):null},
 ];
 return <article className={d.card}>
  <div className={d.media}><img src={source.image} alt="" loading="lazy"/><span data-state={campaignStatus(item)}>{statusLabel(item,hr)}</span></div>
  <div className={d.body}>
   <div className={d.identity}>
    <h3 className={d.title}><Link to={url}>{c.name}</Link></h3>
    {source.name&&source.name!==c.name?<p className={d.source}>{source.name}</p>:null}
    <OfficialSourceLinks selection={item.selection} hr={hr}/><div className={d.metadata}>
     {source.date?<span><CalendarDays size={14} aria-hidden="true"/>{new Date(`${source.date}T12:00:00`).toLocaleDateString(hr?'hr-HR':'en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>:null}
     <span><Layers size={14} aria-hidden="true"/>{hr?'Fondovi nagrada':'Prize pots'}: {c.pots.length}</span>
    </div>
   </div>
   <div className={d.sponsor}><CampaignSponsor id={c.id} hr={hr}/></div>
   <dl className={d.money}>{totals.map(({label,value})=><div key={label}><dt>{label}</dt><dd>{value??'—'}{value!==null?<small>test MON</small>:null}</dd></div>)}</dl>
   <div className={d.footer}><ObservationTime item={item} hr={hr}/><Link to={url}>{hr?'Pogledaj kampanju':'View campaign'}<ArrowRight size={16} aria-hidden="true"/></Link></div>
  </div>
 </article>;
}
export function CampaignTable({items,hr,sort,descending,onSort}:{items:DirectoryCampaign[];hr:boolean;sort:CampaignSort;descending:boolean;onSort:(key:CampaignSort)=>void}){
 const cols:[CampaignSort,string][]=[['name',hr?'Kampanja':'Campaign'],['funded',hr?'Uplaćeno':'Funded'],['paid',hr?'Isplaćeno':'Paid'],['returned',hr?'Vraćeno':'Returned'],['status',hr?'Stanje':'Status']];
 return <div className={s.scroll} role="region" aria-label={hr?'Tablica kampanja':'Campaign table'} tabIndex={0}><table className={s.table}><thead><tr>{cols.map(([key,label])=><th className={["funded","paid","returned"].includes(key)?s.number:undefined} key={key} scope="col" aria-sort={sort===key?(descending?'descending':'ascending'):'none'}><button onClick={()=>onSort(key)}>{label}<ArrowUpDown size={13}/></button></th>)}</tr></thead><tbody>{items.map(i=><tr key={i.campaign.id}><td><Link to={`/rewards/campaigns/${i.campaign.id}/public`}>{i.campaign.name}</Link><small>{campaignSource(i).name}</small><OfficialSourceLinks selection={i.selection} hr={hr}/><CampaignSponsor id={i.campaign.id} hr={hr}/></td><td className={s.number}>{setupAmount(BigInt(i.campaign.budgetWei),hr)} test MON</td>{(['paidWei','returnedWei'] as const).map(key=><td className={s.number} key={key}>{i.verified?`${setupAmount(campaignSum(i.campaign,key),hr)} test MON`:'—'}</td>)}<td><span className={s.badge} data-state={campaignStatus(i)}>{statusLabel(i,hr)}</span><ObservationTime item={i} hr={hr}/></td></tr>)}</tbody></table></div>;
}
function CampaignBrowser({items,compact=false,history=false,directory=false}:{items:DirectoryCampaign[];compact?:boolean;history?:boolean;directory?:boolean}){
 const {locale}=useI18n(),hr=locale==='hr',t=(en:string,local:string)=>hr?local:en;
 const searchInput=useRef<HTMLInputElement>(null),browserRegion=useRef<HTMLElement>(null);
 const [params,setParams]=useSearchParams(),prefix=history?'history-':'';
 const read=(key:string,fallback:string)=>params.get(prefix+key)??fallback;
 const status=history?'all':read('status','active')==='finished'?'finished':'active';
 const query=read('q',''),sort=read('sort','date') as CampaignSort,descending=read('order','desc')!=='asc',view=history?'list':read('view',directory?'grid':'list');
 const safeSort=(['name','funded','paid','returned','date','status','pots'].includes(sort)?sort:'date') as CampaignSort;
 const change=(changes:Record<string,string>)=>setParams(p=>{const next=new URLSearchParams(p);Object.entries(changes).forEach(([k,v])=>{if(v)next.set(prefix+k,v);else next.delete(prefix+k);});if(!('page' in changes))next.delete(prefix+'page');return next;},{replace:true});
 const hasQuery=query.trim().length>0;
 const clearSearch=()=>{change({q:''});(searchInput.current??browserRegion.current)?.focus();};
 const onSort=(key:CampaignSort)=>change({sort:key,order:safeSort===key?(descending?'asc':'desc'):key==='name'?'asc':'desc'});
 const incomplete=items.some(i=>!i.verified);
 const source=history?items.filter(i=>i.verified&&campaignSum(i.campaign,'paidWei')>0n):items;
 const rows=selectCampaigns(source,{status,query,sort:safeSort,descending}),size=compact?4:history?5:9;
 const pages=Math.max(1,Math.ceil(rows.length/size)),requested=Number(read('page','1')),page=Number.isSafeInteger(requested)?Math.max(1,Math.min(pages,requested)):1,visible=rows.slice((page-1)*size,page*size);
 return <section ref={browserRegion} tabIndex={-1} className={directory?d.browser:compact?s.compactBrowser:undefined} aria-label={history?t('Past distributions','Dosadašnje isplate'):t('Campaigns','Kampanje')}>
 {!history?<div className={`${s.directoryTools} ${directory?d.controls:''}`}><div className={s.toolbar}><div className={s.tabs} role="group" aria-label={t('Campaign status','Stanje kampanje')}>{[['active',t('Active','Aktivne')],['finished',t('Finished','Završene')]].map(([key,label])=><button key={key} aria-pressed={status===key} onClick={()=>change({status:key})}>{label}</button>)}</div><label className={s.search}><Search size={17}/><input ref={searchInput} aria-label={t('Search campaigns','Pretraži kampanje')} placeholder={t('Search campaigns…','Pretraži kampanje…')} value={query} onChange={e=>change({q:e.target.value})}/></label></div><div className={s.toolbar}><label className={s.sort}>{t('Sort','Poredaj')}<select aria-label={t('Sort campaigns','Poredaj kampanje')} value={`${safeSort}:${descending?'desc':'asc'}`} onChange={e=>{const [key,order]=e.target.value.split(':');change({sort:key,order});}}>{[['date:desc',t('Newest published','Najnovije objavljene')],['date:asc',t('Oldest published','Najstarije objavljene')],['name:asc',t('Name A–Z','Naziv A–Ž')],['name:desc',t('Name Z–A','Naziv Ž–A')],['funded:desc',t('Highest funding','Najveći fond')],['funded:asc',t('Lowest funding','Najmanji fond')],['paid:desc',t('Most paid','Najviše isplaćeno')],['paid:asc',t('Least paid','Najmanje isplaćeno')],['returned:desc',t('Most returned','Najviše vraćeno')],['returned:asc',t('Least returned','Najmanje vraćeno')],['status:asc',t('Status A–Z','Stanje A–Ž')],['status:desc',t('Status Z–A','Stanje Ž–A')]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><div className={s.view} role="group" aria-label={t('Campaign layout','Prikaz kampanja')}><button aria-label={t('Grid view','Mrežni prikaz')} aria-pressed={view!=='list'} onClick={()=>change({view:'grid'})}><LayoutGrid size={17}/></button><button aria-label={t('List view','Prikaz popisa')} aria-pressed={view==='list'} onClick={()=>change({view:'list'})}><List size={18}/></button></div></div></div>:null}
 {directory?<p className={d.results}>{hr?`Kampanje: ${rows.length}`:`${rows.length} ${rows.length===1?'campaign':'campaigns'}`}</p>:null}
 {incomplete?<p role="status" className={s.muted}>{t('Some campaign statuses could not be refreshed. Finished campaigns and payout history may be incomplete.','Dio stanja kampanja nije osvježen. Završene kampanje i povijest isplata možda nisu potpune.')}</p>:null}
 {!rows.length?<div className={s.empty}><h3>{hasQuery?(history?t('No matching distributions','Nema odgovarajućih isplata'):t('No matching campaigns','Nema odgovarajućih kampanja')):history&&incomplete?t('Payout history could not be verified','Povijest isplata nije provjerena'):history?t('No payouts yet','Još nema isplata'):query?t('No matching campaigns','Nema odgovarajućih kampanja'):status==='finished'?t('No finished campaigns yet','Još nema završenih kampanja'):t('No active campaigns','Nema aktivnih kampanja')}</h3><p>{hasQuery?t('Try a different name or clear your search to see this list again.','Pokušajte s drugim nazivom ili očistite pretragu za ponovni prikaz popisa.'):history&&incomplete?t('Refresh the campaign status to try again.','Osvježite stanje kampanja za ponovnu provjeru.'):history?t('No recipient payments are confirmed in the published campaigns yet.','U objavljenim kampanjama još nema potvrđenih isplata.'):status==='finished'?t('A campaign finishes once its prize pots are closed and funds are settled.','Kampanja završava kada su fondovi zatvoreni i sredstva podmirena.'):t('Choose an event and set the rewards you want to fund.','Odaberite događaj i nagrade koje želite financirati.')}</p>{hasQuery?<button className={s.secondary} onClick={clearSearch}>{t('Clear search','Očisti pretragu')}</button>:!history&&status==='finished'?<button className={s.secondary} onClick={()=>change({status:"active"})}>{t("View active campaigns","Prikaži aktivne kampanje")}</button>:!history?<Link className={s.secondary} to="/rewards/events">{t('Explore events','Istraži događaje')}<ArrowRight size={15}/></Link>:null}</div>:directory?<div className={d.cards} data-view={view==='list'?'list':'grid'}>{visible.map(item=><CampaignDirectoryCard key={item.campaign.id} item={item} hr={hr}/>)}</div>:compact&&view==='list'?<div className={s.campaignList}>{visible.map(item=><article className={s.campaignRow} aria-label={item.campaign.name} key={item.campaign.id}><img src={campaignSource(item).image} alt=""/><span><strong><Link to={`/rewards/campaigns/${item.campaign.id}/public`}>{item.campaign.name}</Link></strong><CampaignSponsor id={item.campaign.id} hr={hr}/><OfficialSourceLinks selection={item.selection} hr={hr}/><small>{item.campaign.pots.length} {item.campaign.pots.length===1?t('prize pot','fond nagrada'):t('prize pots','fondova nagrada')}</small><span className={s.badge} data-state={campaignStatus(item)}>{statusLabel(item,hr)}</span></span><span className={s.rowAmount}><strong>{setupAmount(BigInt(item.campaign.budgetWei),hr)}</strong><small>test MON · {t('funded','uplaćeno')}</small></span><Link aria-label={`${t('View campaign','Pogledaj kampanju')}: ${item.campaign.name}`} to={`/rewards/campaigns/${item.campaign.id}/public`}><ArrowRight size={16}/></Link></article>)}</div>:view==='list'?<CampaignTable items={visible} hr={hr} sort={safeSort} descending={descending} onSort={onSort}/>:<div className={`${s.grid} ${compact?s.compact:''}`}>{visible.map(item=><CampaignCard key={item.campaign.id} item={item} hr={hr}/>)}</div>}
 {pages>1?<nav className={s.pagination} aria-label={t('Campaign pages','Stranice kampanja')}><button disabled={page===1} onClick={()=>change({page:String(page-1)})}>{t('Previous','Prethodno')}</button><span>{page} / {pages}</span><button disabled={page===pages} onClick={()=>change({page:String(page+1)})}>{t('Next','Sljedeće')}</button></nav>:null}
 </section>;
}

export default function PodiumCampaigns(props:Parameters<typeof CampaignBrowser>[0]){return <CampaignSponsorProvider><CampaignBrowser {...props}/></CampaignSponsorProvider>;}
