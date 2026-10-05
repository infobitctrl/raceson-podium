import {useState} from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {createGuidedSetup,addGuidedGroup} from '@raceson/domain/rewards/guided-setup-editor';
import {previewRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import SponsorInlineCategory from './SponsorInlineCategory';
vi.mock('recharts',()=>({
 ResponsiveContainer:({children}:{children:React.ReactNode})=><div>{children}</div>,
 LineChart:({data}:{data:{rank:number;value:number;amount:string}[]})=><output data-testid="plotted-prizes">{JSON.stringify(data)}</output>,
 CartesianGrid:()=>null,Line:()=>null,Tooltip:()=>null,XAxis:()=>null,YAxis:()=>null,
}));
function Harness({disabled=false}:{disabled?:boolean}){
 let i=1;const next=()=>`75000000-0000-4000-8000-${String(i++).padStart(12,'0')}`;
 const base=createGuidedSetup(next),potId=base.guided!.pots[0].nodeId,setup=addGuidedGroup(base,potId,'athlete_standings',next,null);
 setup.budgetMon='1';setup.root.children.forEach(p=>{p.shareBps=p.id===potId?10000:0;});setup.root.children[0].children[0].shareBps=10000;setup.root.children[0].children[0].name='Category';
 const [c,setC]=useState(setup),node=c.root.children[0].children[0],row=previewRewardSetup(c).rows.find(r=>r.id===node.id);
 return <><SponsorInlineCategory initialExpanded node={node} group={c.guided!.groups[0]} configuration={c} catalogue={null} roundId={null} row={row} hr={false} disabled={disabled} onNode={update=>setC({...c,root:{...c.root,children:c.root.children.map((p,i)=>i===0?{...p,children:[update(node)]}:p)}})} onGroup={()=>{}} onMethod={()=>{}} onConnect={()=>{}} onRemove={()=>{}}/><output data-testid="exact-prizes">{JSON.stringify(row?.slots.map(String))}</output></>;
}
const plotted=()=>JSON.parse(screen.getByTestId('plotted-prizes').textContent!) as {rank:number;value:number;amount:string}[];
it('plots authoritative amounts for presets and manual edits while conserving the category pool',()=>{
 render(<Harness/>);fireEvent.change(screen.getByLabelText('Category prize positions'),{target:{value:'3'}});
 fireEvent.click(screen.getByRole('button',{name:'Linear'}));const linear=plotted();expect(linear.map(p=>p.value)).toEqual([0.5,0.3333,0.1667]);
 fireEvent.click(screen.getByRole('button',{name:'Top heavy'}));expect(plotted()[0].value).toBeGreaterThan(linear[0].value);
 fireEvent.change(screen.getByLabelText('Category #1 weight'),{target:{value:'90'}});const custom=plotted();expect(custom).not.toEqual(linear);expect(screen.getByRole('button',{name:'Custom'})).toHaveAttribute('aria-pressed','true');
 const exact=JSON.parse(screen.getByTestId('exact-prizes').textContent!) as string[];expect(exact.reduce((sum,v)=>sum+BigInt(v),0n)).toBe(10n**18n);
 expect(custom.map(p=>p.value)).toEqual(exact.map(v=>Number(BigInt(v))/1e18));
 fireEvent.click(screen.getByRole('button',{name:'Linear'}));expect(plotted()).toEqual(linear);expect(screen.getByLabelText('Category #1 weight')).toHaveValue(50);
});
it('keeps saved preset and manual controls disabled while showing the curve',()=>{
 render(<Harness disabled/>);for(const name of ['Linear','Top heavy','Custom'])expect(screen.getByRole('button',{name})).toBeDisabled();
 expect(screen.getByLabelText('Category #1 weight')).toBeDisabled();expect(screen.getByRole('region',{name:'Category prize distribution'})).toBeVisible();
});
