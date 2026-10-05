import {render,screen,within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
import PodiumPrizeCurve from './PodiumPrizeCurve';
// Exercise the tooltip contract with real chart data; layout/pointer behavior is checked in Chrome.
vi.mock('recharts',async()=>{
 const {createContext,useContext}=await import('react');
 type Point={rank:number;value:number;amount?:string};
 const Data=createContext<Point[]>([]);
 return {ResponsiveContainer:({children}:{children:ReactNode})=><>{children}</>,LineChart:({children,data}:{children:ReactNode;data:Point[]})=><Data.Provider value={data}>{children}</Data.Provider>,CartesianGrid:()=>null,XAxis:()=>null,YAxis:()=>null,Line:()=>null,Tooltip:({formatter}:{formatter:(value:number,name:string,item:{payload:Point})=>ReactNode})=>{const data=useContext(Data);return <div aria-label="Tooltips">{data.map(point=><p key={point.rank}>{formatter(point.value,'Reward',{payload:point})}</p>)}</div>;}};
});
it.each([false,true])('retains every integer digit in monetary tooltip (hr %s)',hr=>{
 render(<PodiumPrizeCurve shares={[5000,5000]} slots={[1n,1234567890123456789012345678n]} hr={hr}/>);
 const tip=within(screen.getByLabelText('Tooltips'));
 expect(tip.getByText(hr?'0,000000000000000001 test MON':'0.000000000000000001 test MON')).toBeInTheDocument();
 expect(tip.getByText(hr?'1234567890,123456789012345678 test MON':'1234567890.123456789012345678 test MON')).toBeInTheDocument();
 expect(screen.getByText('#1 · 50% · 0.000000000000000001 test MON')).toBeInTheDocument();
});
it('keeps exact zero distinct from a tiny nonzero slot',()=>{
 render(<PodiumPrizeCurve shares={[5000,5000]} slots={[0n,1000000000n]} hr={false}/>);
 const tip=within(screen.getByLabelText('Tooltips'));
 expect(tip.getByText('0 test MON')).toBeInTheDocument();
 expect(tip.getByText('0.000000001 test MON')).toBeInTheDocument();
});
it.each([undefined,[1n]])('falls back to percentages when complete amounts are unavailable (%s)',slots=>{
 render(<PodiumPrizeCurve shares={[6667,3333]} slots={slots} hr={false}/>);
 expect(within(screen.getByLabelText('Tooltips')).getByText('66.67%')).toBeInTheDocument();
 expect(screen.queryByText(/test MON/)).not.toBeInTheDocument();
});
it('renders no empty chart',()=>{
 const {container}=render(<PodiumPrizeCurve shares={[]} slots={[]} hr={false}/>);expect(container).toBeEmptyDOMElement();
});
