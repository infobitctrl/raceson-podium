import {Cell,Pie,PieChart,ResponsiveContainer} from 'recharts';
import {setupAmount} from '../model/setupAmount';
import s from './Podium.module.css';
export default function PodiumPaymentRing({paid,held,returned,hr}:{paid:bigint;held:bigint;returned:bigint;hr:boolean}){
 const rows=[{label:hr?'Isplaćeno':'Paid',amount:paid,color:'#f44b0b'},{label:hr?'U fondu':'Held for rewards',amount:held,color:'#d9d8cf'},{label:hr?'Vraćeno':'Returned',amount:returned,color:'#e68e59'}],total=paid+held+returned;
 if(total===0n)return <p className={s.muted}>{hr?'Još nema potvrđenih sredstava.':'No confirmed funds yet.'}</p>;
 const data=rows.filter(r=>r.amount>0n).map(r=>({...r,value:Number(r.amount*1000000n/total)}));
 return <div><div className={s.ring} aria-hidden="true"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" innerRadius="67%" outerRadius="94%" startAngle={90} endAngle={-270} isAnimationActive={false}>{data.map(r=><Cell key={r.label} fill={r.color}/>)}</Pie></PieChart></ResponsiveContainer><div className={s.ringLabel}><small>{hr?'Ukupno':'Total'}</small>{setupAmount(total,hr)}<small>test MON</small></div></div><dl className={s.legend}>{rows.map(r=><div key={r.label}><dt><span><i style={{background:r.color}}/>{r.label}</span></dt><dd>{setupAmount(r.amount,hr)} test MON</dd></div>)}</dl></div>;
}
