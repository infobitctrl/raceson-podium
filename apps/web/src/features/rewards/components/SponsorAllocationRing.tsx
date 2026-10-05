import {Cell,Pie,PieChart,ResponsiveContainer} from "recharts";
import {sponsorColors} from "../model/sponsorCatalogue";
import s from "./SponsorStudio.module.css";
export type SponsorSlice={id:string;name:string;value:number;color?:string};
export default function SponsorAllocationRing({items,selected,onSelect,headline,caption,hr,disabled=false,selectionOnly=false,hideLegend=false}:{items:SponsorSlice[];selected?:string;onSelect:(id:string)=>void;headline:string;caption:string;hr:boolean;disabled?:boolean;selectionOnly?:boolean;hideLegend?:boolean}){
 const total=items.reduce((sum,item)=>sum+item.value,0);
 const basis=selectionOnly?total:10000,over=total>basis;
 const slices=total>0&&!over?[...items.filter(item=>item.value>0),...(!selectionOnly&&total<10000?[{id:"remaining",name:hr?"Neraspoređeno":"Unallocated",value:10000-total,color:"#e5e5df"}]:[])]:[{id:"empty",name:hr?"Nema raspodjele":"No allocation",value:1,color:"#e5e5df"}];
 return <div className={s.ringArea}>
  <div className={s.ring}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="67%" outerRadius="94%" startAngle={90} endAngle={-270} paddingAngle={slices.length>1?1.5:0} isAnimationActive={false} onClick={(_,index)=>{if(!disabled&&total>0&&items.some(item=>item.id===slices[index].id))onSelect(slices[index].id);}} stroke="#f7f5ef" strokeWidth={3}>{slices.map((item,i)=><Cell key={item.id} fill={item.color??sponsorColors[i%sponsorColors.length]} opacity={!selected||selected===item.id?1:.72}/>)}</Pie></PieChart></ResponsiveContainer><div className={s.ringCenter}><strong>{headline}</strong><span>{caption}</span></div></div>
  {!hideLegend?<><div className={s.legend} aria-label={hr?"Dijelovi raspodjele":"Allocation segments"}>{items.map((item,i)=><button key={item.id} disabled={disabled} aria-pressed={selected===item.id} onClick={()=>onSelect(item.id)}><i style={{background:item.color??sponsorColors[i%sponsorColors.length]}}/><span>{item.name}</span>{!selectionOnly?<b>{new Intl.NumberFormat(hr?"hr":"en",{maximumFractionDigits:2}).format(item.value/100)}%</b>:null}</button>)}</div>
  <p className={s.hint}>{over?(hr?"Prekoračen fond · ispravite udjele":"Over budget · correct the shares"):(hr?"Odaberite dio za pregled raspodjele":"Select a segment to view its allocation")}</p>
 </>:null}
 </div>;
}
