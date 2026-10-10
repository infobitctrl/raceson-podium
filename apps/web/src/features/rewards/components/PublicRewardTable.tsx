import {useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpDown,ArrowUp,ArrowDown,Clock3} from 'lucide-react';
import {PUBLIC_REWARD_PAGE_SIZE} from '@raceson/domain/rewards/public-campaign';
import {usePublicCampaignRewards,type PublicCampaignRewards} from '../model/usePublicCampaignRewards';
import {sortPublicRewards,publicFinishTime,type RewardSort} from '../model/publicDistribution';
import {publicAmount as setupAmount} from '../model/publicAmount';
import s from './Podium.module.css';
import styles from './PublicRewardTable.module.css';
export default function PublicRewardTable({id,slot,hr,refresh,title,subtitle,rewards}:{id:string;slot:number;hr:boolean;refresh:number;title?:string;subtitle?:string;rewards?:PublicCampaignRewards}) {
 const t=(en:string,local:string)=>hr?local:en;
 const ownRewards=usePublicCampaignRewards(id,slot,refresh,!rewards);
 const {page,busy,failed,retry}=rewards??ownRewards;
 const label=page?.availability==='open'?t('Claims are open. Each recipient must claim their reward from My rewards.','Preuzimanje je otvoreno. Svaki primatelj preuzima svoju nagradu na stranici Moje nagrade.'):
 page?.availability==='paused'?t('Claims are paused. Confirmed payments remain visible below.','Preuzimanje je pauzirano. Potvrđene isplate vidljive su u nastavku.'):
 page?.availability==='closed'?t('The claim window is closed. Unclaimed rewards are not payments.','Rok za preuzimanje je zatvoren. Nepreuzete nagrade nisu isplate.'):
 t('Awards are prepared. Claims open after the remaining review and controller steps.','Nagrade su pripremljene. Preuzimanje se otvara nakon pregleda i preostalih koraka kontrolera.');
 return <section aria-label={t('Individual rewards','Pojedinačne nagrade')} aria-busy={busy}>
  <div className={styles.heading}><div><h2>{title??t('Rewards','Nagrade')}{page?<span className={styles.count} aria-label={`${page.total} ${t('rewards','nagrade')}`}> {page.total}</span>:null}</h2>{subtitle?<p className={styles.subtitle}>{subtitle}</p>:null}</div>{!title?<Link to="/athlete/rewards" className={s.back}>{t('Claim my rewards →','Preuzmi moje nagrade →')}</Link>:null}</div>
  {busy?<p className={styles.loading} role="status">{t('Checking reward status…','Provjera stanja nagrada…')}</p>:failed?<div className={s.notice} role="alert"><p>{t('Reward status could not be verified. No payment status is assumed.','Stanje nagrada nije moguće provjeriti. Stanje isplate nije pretpostavljeno.')}</p><button className={s.secondary} onClick={retry}>{t('Retry reward status','Ponovi provjeru nagrada')}</button></div>:page?.total===0?<div className={styles.empty}><Clock3 size={22} aria-hidden="true"/><div><strong>{t('No individual rewards yet','Pojedinačne nagrade još nisu dostupne')}</strong><p>{t('Awaiting approved results and reward allocation. Saved category budgets are below.','Čeka odobrene rezultate i raspodjelu nagrada. Spremljeni fondovi kategorija su u nastavku.')}</p></div></div>:page?<>
  <details className={styles.guidance}><summary>{page.availability==='open'?t('Claims open','Preuzimanje otvoreno'):page.availability==='paused'?t('Claims paused','Preuzimanje pauzirano'):page.availability==='closed'?t('Claims closed','Preuzimanje zatvoreno'):t('Awaiting review','Čeka pregled')}</summary><p>{label}</p></details>
  <RecipientLedger key={`${id}:${slot}:athlete`} rows={page.rows.filter(r=>r.kind==='athlete')} kind="athlete" hr={hr}/>
  <RecipientLedger key={`${id}:${slot}:club`} rows={page.rows.filter(r=>r.kind==='club')} kind="club" hr={hr}/>
  <details className={styles.note}><summary>{t('Verification details','Detalji provjere')}</summary><p>{t('Names are the sporting display names in the approved demo copy. Account details, wallets and consents remain private. “Claimed” means the contract confirms payment.','Imena su sportski prikazi iz odobrene demo kopije. Podaci računa, novčanici i privole ostaju privatni. „Preuzeto” znači da ugovor potvrđuje isplatu.')}<br/>{t('Verified','Provjereno')} {new Date(Number(page.blockTimestamp)*1000).toLocaleString(hr?'hr-HR':'en-GB')} · {t('Finalized block','Finalizirani blok')} {page.blockNumber}</p></details>
  </>:null}
 </section>;
}

function RecipientLedger({rows,kind,hr}:{rows:NonNullable<PublicCampaignRewards['page']>['rows'];kind:'athlete'|'club';hr:boolean}) {
 const t=(en:string,local:string)=>hr?local:en,athlete=kind==='athlete';
 const title=athlete?t('Athlete rewards','Nagrade sportaša'):t('Club rewards','Nagrade klubova');
 const [query,setQuery]=useState(''),[status,setStatus]=useState('all'),[category,setCategory]=useState<string|null>(null);
 const categories=[...new Set(rows.flatMap(row=>row.breakdown?.map(b=>b.category)??[]))].sort((a,b)=>a.localeCompare(b,hr?'hr':'en'));
 const hasFilters=Boolean(query)||status!=='all'||category!==null;
 const [offset,setOffset]=useState(0),[sort,setSort]=useState<RewardSort>('position'),[direction,setDirection]=useState<'asc'|'desc'>('asc');
 const changeSort=(key:RewardSort)=>{setOffset(0);setSort(key);setDirection(key===sort?(direction==='asc'?'desc':'asc'):key==='amount'?'desc':'asc');};
 const filtered=sortPublicRewards(rows.filter(row=>(category===null||row.breakdown?.some(b=>b.category===category))&&(status==='all'||row.status===status)&&`${row.id} ${row.number} ${row.display?.name??''} ${row.display?.club??''} ${row.breakdown?.map(b=>b.category).join(' ')??''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),sort,direction==='desc',hr,category);
 const pageOffset=Math.min(offset,Math.max(0,Math.ceil(filtered.length/PUBLIC_REWARD_PAGE_SIZE)-1)*PUBLIC_REWARD_PAGE_SIZE);
 const visible=filtered.slice(pageOffset,pageOffset+PUBLIC_REWARD_PAGE_SIZE);
 const columns:[RewardSort,string][]=[['number','#'],['reward',t('Category','Kategorija')],['position',t('Position','Mjesto')],['name',athlete?t('Athlete name','Ime sportaša'):t('Club name','Ime kluba')],...(athlete?[['club',t('Club','Klub')],['time',t('Time','Vrijeme')]] as [RewardSort,string][]:[]),['amount',t('Rewards','Nagrade')],['status',t('Status','Stanje')]];
 const fallback=(row:typeof rows[number])=>`${athlete?t('Athlete reward','Nagrada sportaša'):t('Club reward','Nagrada kluba')} ${row.number}`;
 return <section className={styles.ledger} aria-label={title}>
  <h3>{title} <span className={styles.count}>{rows.length}</span></h3>
  <div className={styles.categories} role="group" aria-label={`${title} · ${t('Category filters','Filtri kategorija')}`}>
   <button aria-pressed={category===null} onClick={()=>{setCategory(null);setOffset(0);}}>{t('All categories','Sve kategorije')}</button>
   {categories.map(label=><button key={label} aria-pressed={category===label} onClick={()=>{setCategory(label);setOffset(0);}}>{label}</button>)}
  </div>
  <div className={styles.filters} role="search" aria-label={`${title} · ${t('filters','filtri')}`}><label><span className="sr-only">{title} · {t('Search rewards','Pretraži nagrade')}</span><input value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}} placeholder={t('Search name, club or category…','Pretraži ime, klub ili kategoriju…')}/></label><label><span className="sr-only">{title} · {t('Reward status','Stanje nagrade')}</span><select value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}}><option value="all">{t('All statuses','Sva stanja')}</option><option value="planned">{t('Planned','Planirano')}</option><option value="unclaimed">{t('Unclaimed','Nepreuzeto')}</option><option value="claimed">{t('Claimed','Preuzeto')}</option></select></label>{hasFilters?<button className={s.secondary} onClick={()=>{setQuery('');setStatus('all');setCategory(null);setOffset(0);}}>{t('Clear filters','Očisti filtre')}</button>:null}</div>
  {hasFilters?<p role="status" className={s.muted}>{t(`${filtered.length} matching rewards of ${rows.length}.`,`${filtered.length} odgovarajućih nagrada od ${rows.length}.`)}</p>:null}
  <div className={`${s.scroll} ${styles.scroll}`} tabIndex={0} role="region" aria-label={`${title} · ${t('table','tablica')}`}><table className={`${s.table} ${styles.table} ${athlete?styles.athletes:styles.clubs}`}><caption className="sr-only">{title}</caption><thead><tr>{columns.map(([key,label])=><th key={key} scope="col" aria-sort={sort===key?(direction==='asc'?'ascending':'descending'):'none'}><button onClick={()=>changeSort(key)}>{label}{sort===key?(direction==='asc'?<ArrowUp size={14}/>:<ArrowDown size={14}/>):<ArrowUpDown size={14}/>}</button></th>)}</tr></thead><tbody>{visible.map(row=><tr key={row.id}>
   <td title={row.id}>{row.number}</td><td>{row.breakdown?.map(b=><span className={styles.categoryLabel} key={b.category}>{b.category}</span>)??'—'}</td><td>{row.breakdown?.map(b=><span className={styles.categoryLabel} key={b.category}>{b.place??'—'}</span>)??'—'}</td><th scope="row">{row.display?.name??fallback(row)}</th>{athlete?<><td>{row.display?.club??'—'}</td><td className={styles.time}>{publicFinishTime(row.display?.timeMs??null)}</td></>:null}<td className={styles.amount}>{setupAmount(BigInt(row.amountWei),hr)} <small>test MON</small></td><td><span className={row.status==='claimed'?styles.claimed:row.status==='planned'?styles.planned:styles.pending}>{row.status==='claimed'?t('Claimed','Preuzeto'):row.status==='planned'?t('Planned','Planirano'):t('Unclaimed','Nepreuzeto')}</span></td>
  </tr>)}</tbody></table></div>
  {filtered.length===0?<p role="status" className={styles.loading}>{t('No rewards match these filters.','Nema nagrada za odabrane filtre.')}</p>:null}
  <div className={styles.footer}><span>{t('Showing','Prikaz')} {filtered.length?pageOffset+1:0}–{Math.min(pageOffset+visible.length,filtered.length)} {t('of','od')} {filtered.length}</span>{filtered.length>PUBLIC_REWARD_PAGE_SIZE?<div><button className={s.secondary} disabled={pageOffset===0} onClick={()=>setOffset(Math.max(0,pageOffset-PUBLIC_REWARD_PAGE_SIZE))}>{t('Previous','Prethodno')}</button><button className={s.secondary} disabled={pageOffset+PUBLIC_REWARD_PAGE_SIZE>=filtered.length} onClick={()=>setOffset(pageOffset+PUBLIC_REWARD_PAGE_SIZE)}>{t('Next','Sljedeće')}</button></div>:null}</div>
 </section>;
}
