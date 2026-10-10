import s from './RewardRoleWorkspace.module.css';
export type ClaimFilter='all'|'unclaimed'|'paid';
export default function RewardClaimFilters({value,onChange,total,paid,unclaimed=total-paid,hr}:{value:ClaimFilter;onChange:(value:ClaimFilter)=>void;total:number;paid:number;unclaimed?:number;hr:boolean}){
 return <div className={s.filters} role="group" aria-label={hr?'Filtriraj nagrade':'Filter rewards'}>{([
  ['all',hr?'Sve nagrade':'All awards',total],['unclaimed',hr?'Nepreuzeto':'Unclaimed',unclaimed],['paid',hr?'Isplaćeno':'Paid',paid],
 ] as const).map(([key,label,count])=><button type="button" key={key} aria-pressed={value===key} onClick={()=>onChange(key)}>{label} <span>{count}</span></button>)}</div>;
}
