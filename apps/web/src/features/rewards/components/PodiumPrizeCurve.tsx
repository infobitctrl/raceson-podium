import {CartesianGrid,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {formatEther} from 'viem';
import s from './Podium.module.css';
/** Chart numbers are presentation only; exact integer slots remain the monetary source. */
export default function PodiumPrizeCurve({shares,slots,hr,compact=false,label}:{shares:number[];slots?:bigint[];hr:boolean;compact?:boolean;label?:string}){
 const hasAmounts=slots?.length===shares.length,data=shares.map((share,i)=>({rank:i+1,value:hasAmounts?Number(slots![i])/1e18:share/100,amount:hasAmounts?formatEther(slots![i]):undefined}));
 if(!data.length)return null;
 return <section style={{gridColumn:'1 / -1',minWidth:0}} aria-label={label??(hr?'Planirana krivulja nagrada':'Planned prize curve')}>
 {!compact?<p className={s.eyebrow}>{hr?'Planirana raspodjela · nije isplata':'Planned distribution · not a payout'}</p>:null}
 <div className={s.curve} style={compact?{height:160}:undefined}><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{top:15,right:20,bottom:24,left:5}} accessibilityLayer><CartesianGrid vertical={false} stroke="#e2e2d9"/><XAxis dataKey="rank" type="number" domain={['dataMin','dataMax']} allowDecimals={false} label={{value:hr?'Mjesto u kategoriji':'Rank within category',position:'bottom',offset:5}} tick={{fontSize:11}}/><YAxis domain={[0,'auto']} tick={{fontSize:11}} width={58} label={{value:hasAmounts?'test MON':'%',angle:-90,position:'insideLeft'}}/><Tooltip contentStyle={{maxWidth:240,whiteSpace:'normal'}} itemStyle={{whiteSpace:'normal',overflowWrap:'anywhere'}} formatter={(value:number,_name,item)=>hasAmounts?`${hr?item.payload.amount.replace('.',','):item.payload.amount} test MON`:`${value}%`} labelFormatter={value=>`${hr?'Mjesto':'Rank'} ${value}`}/><Line type="linear" dataKey="value" name={hr?'Nagrada':'Reward'} stroke="#ec510f" strokeWidth={2.5} dot={data.length<=25} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>
 {!compact?<details><summary>{hr?'Točni iznosi po mjestu':'Exact values by rank'}</summary><ol className={s.legend}>{shares.map((share,i)=><li key={i}>#{i+1} · {share/100}%{hasAmounts?` · ${formatEther(slots![i])} test MON`:''}</li>)}</ol></details>:null}
 </section>;
}
