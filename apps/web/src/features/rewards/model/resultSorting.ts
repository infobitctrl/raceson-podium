import type {ResultDisplay} from '../data/resultDisplay';
export type ResultSort='official'|'rank'|'name'|'club'|'category'|'time'|'points'|'reward';
export function sortResultRows(rows:ResultDisplay['rows'],key:ResultSort,descending=false){
 const value=(r:ResultDisplay['rows'][number])=>key==='rank'?r.rank:key==='name'?r.name:key==='club'?r.club:key==='category'?r.categories.join(' · '):key==='time'?r.timeMs:key==='points'?r.points??null:key==='reward'?r.amountWei===null?null:BigInt(r.amountWei):r.race;
 return [...rows].sort((a,b)=>{
  if(key==='official')return a.race.localeCompare(b.race)||(a.rank??Infinity)-(b.rank??Infinity)||a.key.localeCompare(b.key);
  const x=value(a),y=value(b);
  if(x==null||x==='')return y==null||y===''?a.key.localeCompare(b.key):1;
  if(y==null||y==='')return -1;
  const n=typeof x==='string'&&typeof y==='string'?x.localeCompare(y):x<y?-1:x>y?1:0;
  return(descending?-n:n)||a.key.localeCompare(b.key);
 });
}
