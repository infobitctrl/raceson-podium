import {sortResultRows,type ResultSort} from '../model/resultSorting';
import ResultSortHeader from './ResultSortHeader';
import {useState} from 'react';
import {ChevronLeft,ChevronRight,Search} from 'lucide-react';
import type {ResultDisplay} from '../data/resultDisplay';
import {setupAmount} from '../model/setupAmount';
import s from './RewardResultsTable.module.css';

export default function ClubResultsTable({rows,approved=false,hr=false,title}:{rows:ResultDisplay['rows'];approved?:boolean;hr?:boolean;title?:string}){
 const [category,setCategory]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(0);
 const [sort,setSort]=useState<ResultSort>('official'),[descending,setDescending]=useState(false);
 const changeSort=(key:ResultSort)=>{setSort(key);setDescending(sort===key?!descending:false);setPage(0);};
 const t=(en:string,local:string)=>hr?local:en;
 const categories=[...new Set(rows.flatMap(row=>row.categories))].sort();
 const filtered=sortResultRows(rows.filter(row=>(!category||row.categories.includes(category))&&(!query||(row.name??'').toLocaleLowerCase().includes(query.toLocaleLowerCase()))),sort,descending);
 const hasFilters=Boolean(category||query);
 const clearFilters=()=>{setCategory('');setQuery('');setPage(0);};
 const pages=Math.max(1,Math.ceil(filtered.length/8)),current=Math.min(page,pages-1),visible=filtered.slice(current*8,current*8+8);
 return <section className={s.clubSection} aria-label={title??t('Club standings and rewards','Klupski poredak i nagrade')}>
  <div className={s.toolbar}><div><h3>{title??t('Club standings & rewards','Klupski poredak i nagrade')}</h3><p className={s.note}>{t('Review club points and the reward for each category.','Pregledajte klupske bodove i nagradu za svaku kategoriju.')}</p></div>
   <div className={s.filters}><select aria-label={t('Club category','Klupska kategorija')} value={category} onChange={e=>{setCategory(e.target.value);setPage(0);}}><option value="">{t('All club categories','Sve klupske kategorije')}</option>{categories.map(value=><option key={value}>{value}</option>)}</select><label className={s.search}><Search size={16}/><input aria-label={t('Find a club','Pronađi klub')} placeholder={t('Find a club…','Pronađi klub…')} value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label></div>
  </div>
  {hasFilters?<div className={s.filterStatus}><span aria-live="polite">{t(`${filtered.length} of ${rows.length} club entries match your filters`,`${filtered.length} od ${rows.length} klupskih rezultata odgovara filtrima`)}</span><button type="button" onClick={clearFilters}>{t('Clear club filters','Očisti klupske filtre')}</button></div>:null}
  <p className={s.scrollHint}>{t('Scroll the table sideways to see points and rewards.','Pomaknite tablicu vodoravno za bodove i nagrade.')}</p>
  <div className={s.scroll} tabIndex={0} role="region" aria-label={t('Scrollable club results','Pomični klupski rezultati')}><table>
   <caption className={s.caption}>{t('Ranks are from the official category standings. Points are from this round; — means unavailable or not applicable. Each row shows only that category’s reward.','Poredak dolazi iz službene kategorije. Bodovi su iz ovog kola; — znači da nisu dostupni ili primjenjivi. Svaki red prikazuje samo nagradu te kategorije.')}</caption>
   <thead><tr>{([['rank',t('Rank','Poredak')],['name',t('Club','Klub')],['category',t('Category','Kategorija')],['points',t('Points','Bodovi')],['reward',approved?t('Reward','Nagrada'):t('Proposed reward','Predložena nagrada')]] as [ResultSort,string][]).map(([key,label])=><ResultSortHeader key={key} column={key} label={label} current={sort} descending={descending} onSort={changeSort}/>)}</tr></thead>
   <tbody>{visible.map(row=><tr key={row.key}><td>{row.rank??'—'}</td><th scope="row">{row.name??t('Club name unavailable','Naziv kluba nije dostupan')}</th><td>{row.categories.join(' · ')||'—'}</td><td className={s.time}>{row.points==null?'—':row.points.toLocaleString(hr?'hr-HR':'en-GB')}</td><td className={s.amount}>{row.amountWei===null?t('Pending review','Čeka pregled'):`${setupAmount(BigInt(row.amountWei),hr)} test MON`}</td></tr>)}</tbody>
  </table></div>
  {!filtered.length?<p role="status" className={s.empty}>{t('No matching clubs.','Nema odgovarajućih klubova.')}</p>:null}
  <div className={s.pagination}><span>{filtered.length?t(`Showing ${current*8+1}–${Math.min((current+1)*8,filtered.length)} of ${filtered.length} club entries`,`Prikaz ${current*8+1}–${Math.min((current+1)*8,filtered.length)} od ${filtered.length} klupskih rezultata`):t('0 club entries','0 klupskih rezultata')}</span><div><button aria-label={t('Previous club results','Prethodni klupski rezultati')} disabled={current===0} onClick={()=>setPage(current-1)}><ChevronLeft size={18}/></button><span>{current+1} / {pages}</span><button aria-label={t('Next club results','Sljedeći klupski rezultati')} disabled={current===pages-1} onClick={()=>setPage(current+1)}><ChevronRight size={18}/></button></div></div>
 </section>;
}
