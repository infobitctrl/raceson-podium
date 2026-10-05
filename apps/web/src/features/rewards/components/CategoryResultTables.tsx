import {useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import type {ResultDisplay} from '../data/resultDisplay';
import {sortResultRows,type ResultSort} from '../model/resultSorting';
import {resultTime} from '../model/resultTime';
import {setupAmount} from '../model/setupAmount';
import ResultSortHeader from './ResultSortHeader';
import s from './RewardResultsTable.module.css';

export default function CategoryResultTables({rows,scope,hr}:{rows:ResultDisplay['rows'];scope:ResultDisplay['scope'];hr:boolean}){
 const groups=new Map<string,{race:string;category:string;rows:ResultDisplay['rows']}>();
 for(const row of rows)for(const category of new Set(row.categories.length?row.categories:[''])){
  const key=JSON.stringify([row.race,category]),group=groups.get(key)??{race:row.race,category,rows:[]};group.rows.push(row);groups.set(key,group);
 }
 return <div className={s.categoryTables}>{[...groups].sort(([,a],[,b])=>a.race.localeCompare(b.race)||a.category.localeCompare(b.category)).map(([key,group])=><CategoryTable key={key} {...group} scope={scope} hr={hr}/>)}</div>;
}
function CategoryTable({race,category,rows,scope,hr}:{race:string;category:string;rows:ResultDisplay['rows'];scope:ResultDisplay['scope'];hr:boolean}){
 const [sort,setSort]=useState<ResultSort>('official'),[descending,setDescending]=useState(false),[page,setPage]=useState(0),t=(en:string,local:string)=>hr?local:en;
 const sorted=sortResultRows(rows,sort,descending),pages=Math.max(1,Math.ceil(sorted.length/8)),current=Math.min(page,pages-1),visible=sorted.slice(current*8,current*8+8),title=`${race} · ${category||t('No classification listed','Kategorija nije navedena')}`;
 function changeSort(key:ResultSort){setSort(key);setDescending(sort===key?!descending:false);setPage(0);}
 return <details className={s.categoryTable} open><summary><span><small>{race}</small><strong>{category||t('No classification listed','Kategorija nije navedena')}</strong></span><span className={s.categoryCount}>{rows.length} {t('results','rezultata')}</span></summary>
 <p className={s.scrollHint}>{t('Scroll the table sideways to see times and rewards.','Pomaknite tablicu vodoravno za vremena i nagrade.')}</p>
 <div className={s.scroll} tabIndex={0} role="region" aria-label={title}><table aria-label={title}><caption className={s.caption}>{scope==='race'?t('Rank is the official place in the race, not a category rank. Total award includes all eligible categories; it may appear in more than one table. Do not add repeated totals.','Poredak je službeno mjesto u utrci, a ne u kategoriji. Ukupna nagrada uključuje sve pripadajuće kategorije i može se pojaviti u više tablica. Ne zbrajajte ponovljene iznose.'):t('League awards combine eligible standings categories. Repeated membership does not create an additional award.','Nagrade lige zbrajaju pripadajuće kategorije poretka. Ponovljeno članstvo ne stvara dodatnu nagradu.')}</caption>
 <thead><tr>{([['rank',scope==='race'?t('Race rank','Poredak utrke'):t('Rank','Poredak')],['name',t('Athlete','Sportaš')],['club',t('Club','Klub')],['time',t('Finish time','Vrijeme')],['reward',t('Total award · all categories','Ukupna nagrada · sve kategorije')]] as [ResultSort,string][]).map(([key,label])=><ResultSortHeader key={key} column={key} label={label} current={sort} descending={descending} onSort={changeSort}/>)}</tr></thead><tbody>{visible.map(row=><tr key={row.key}><td>{row.rank??'—'}</td><th scope="row">{row.name??t('Name unavailable','Ime nije dostupno')}</th><td>{row.club||'—'}</td><td className={s.time}>{resultTime(row.timeMs,row.status)}</td><td className={s.amount}>{row.amountWei===null?t('Pending review','Čeka pregled'):`${setupAmount(BigInt(row.amountWei),hr)} test MON`}</td></tr>)}</tbody></table></div>
 <div className={s.pagination}><span>{t(`Showing ${current*8+1}–${Math.min((current+1)*8,rows.length)} of ${rows.length}`,`Prikaz ${current*8+1}–${Math.min((current+1)*8,rows.length)} od ${rows.length}`)}</span><div><button aria-label={t(`Previous results · ${title}`,`Prethodni rezultati · ${title}`)} disabled={current===0} onClick={()=>setPage(current-1)}><ChevronLeft size={18}/></button><span>{current+1} / {pages}</span><button aria-label={t(`Next results · ${title}`,`Sljedeći rezultati · ${title}`)} disabled={current===pages-1} onClick={()=>setPage(current+1)}><ChevronRight size={18}/></button></div></div>
 </details>;
}
