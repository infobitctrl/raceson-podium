import {useState} from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {createGuidedSetup} from '@raceson/domain/rewards/guided-setup-editor';
import type {RewardDistributionSetup} from '@raceson/domain/rewards/distribution-setup';
import {splitSponsorSections} from '../model/sponsorBudget';
import SponsorFundingWorkspace from './SponsorFundingWorkspace';
vi.mock('./DistributionFlowChart',()=>({default:()=>null}));
let nextId=1;
const fresh=()=>createGuidedSetup(()=>`73000000-0000-4000-8000-${String(nextId++).padStart(12,'0')}`);
function Harness({initial,disabled=false}:{initial:RewardDistributionSetup;disabled?:boolean}){
 const [value,setValue]=useState(initial);
 return <><SponsorFundingWorkspace configuration={value} onChange={setValue} stage="pot" onNavigate={()=>{}} disabled={disabled} hr={false}/><output aria-label="Saved configuration">{JSON.stringify(value)}</output></>;
}
it('edits the league share without losing round rules or the exact budget',()=>{
 const initial=splitSponsorSections(fresh(),10000);initial.budgetMon='1';render(<Harness initial={initial}/>);
 expect(screen.getByLabelText('League %')).toHaveValue(100);
 fireEvent.change(screen.getByLabelText('League %'),{target:{value:'50'}});
 const current=JSON.parse(screen.getByLabelText('Saved configuration').textContent!);
 expect(current.root.children.reduce((sum:number,p:{shareBps:number})=>sum+p.shareBps,0)).toBe(10000);
 expect(current.budgetMon).toBe('1');expect(current.guided).toEqual(initial.guided);
 expect(current.root.children.map(({id,children,rule}:{id:string;children:unknown;rule:unknown})=>({id,children,rule}))).toEqual(initial.root.children.map(({id,children,rule})=>({id,children,rule})));
 fireEvent.change(screen.getByLabelText('League %'),{target:{value:'100'}});
 expect(screen.getByLabelText('Round 1 %')).toHaveValue(0);
 expect(screen.getByLabelText('Total budget · test MON')).toHaveValue('1');
});
it('keeps the saved percentages editable when the total budget is invalid',()=>{
 const initial=splitSponsorSections(fresh(),5000);initial.budgetMon='0';render(<Harness initial={initial}/>);
 expect(screen.getByLabelText('Round 1 %')).toBeEnabled();
 fireEvent.change(screen.getByLabelText('Round 1 %'),{target:{value:'20'}});
 const current=JSON.parse(screen.getByLabelText('Saved configuration').textContent!);
 expect(current.budgetMon).toBe('0');expect(current.root.children[1].shareBps).toBe(2000);
 expect(current.root.children.reduce((sum:number,p:{shareBps:number})=>sum+p.shareBps,0)).toBe(10000);
});
it('freezes every economic control when viewing saved rules',()=>{
 const initial=splitSponsorSections(fresh(),10000);render(<Harness initial={initial} disabled/>);
 expect(screen.getByLabelText('League %')).toBeDisabled();expect(screen.getByLabelText('Round 1 %')).toBeDisabled();
 expect(screen.getByLabelText('Total budget · test MON')).toBeDisabled();
 expect(screen.getByRole('radio',{name:'Back to the sponsor wallet'})).toBeDisabled();
 expect(JSON.parse(screen.getByLabelText('Saved configuration').textContent!)).toEqual(initial);
});
it('updates only supported return destinations and the claim window',()=>{
 const initial=fresh();render(<Harness initial={initial}/>);
 fireEvent.click(screen.getByRole('radio',{name:'Back to the sponsor wallet'}));
 fireEvent.change(screen.getByLabelText('Claim window (days)'),{target:{value:'30'}});
 const current=JSON.parse(screen.getByLabelText('Saved configuration').textContent!);
 expect(current.policy).toMatchObject({claimWindowDays:30,treasuryReturn:'original_sender',fewerFinishers:'selected_return'});
 expect(current.root).toEqual(initial.root);
});

it('links league amounts and sliders and recalculates amounts when the pool changes',()=>{
 const initial=splitSponsorSections(fresh(),5000);initial.budgetMon='1';render(<Harness initial={initial}/>);
 fireEvent.change(screen.getByRole('textbox',{name:'League · test MON'}),{target:{value:'0.7'}});
 fireEvent.blur(screen.getByRole('textbox',{name:'League · test MON'}));
 expect(screen.getByRole('slider',{name:'League prize share'})).toHaveValue('7000');
 expect(screen.getByLabelText('League %')).toHaveValue(70);
 expect(screen.getByRole('textbox',{name:'Round 1 · test MON'})).toHaveValue('0.06');
 fireEvent.change(screen.getByLabelText('Total budget · test MON'),{target:{value:'2'}});
 expect(screen.getByRole('textbox',{name:'League · test MON'})).toHaveValue('1.4');
 expect(screen.getByRole('textbox',{name:'Round 1 · test MON'})).toHaveValue('0.12');
 expect(screen.getByLabelText('League %')).toHaveValue(70);
 fireEvent.change(screen.getByRole('slider',{name:'Round 1 prize share'}),{target:{value:'2000'}});
 expect(screen.getByLabelText('Round 1 %')).toHaveValue(20);
 expect(screen.getByRole('textbox',{name:'Round 1 · test MON'})).toHaveValue('0.4');
 const current=JSON.parse(screen.getByLabelText('Saved configuration').textContent!);
 expect(current.root.children.reduce((sum:number,n:{shareBps:number})=>sum+n.shareBps,0)).toBe(10000);
 expect(current.root.children[0].shareBps).toBe(7000);
 fireEvent.change(screen.getByRole('textbox',{name:'Round 1 · test MON'}),{target:{value:'0.8'}});
 expect(screen.getByRole('alert')).toBeVisible();
 expect(JSON.parse(screen.getByLabelText('Saved configuration').textContent!)).toEqual(current);
});
it('disables amount inputs without a valid pool and all linked inputs for saved rules',()=>{
 const initial=splitSponsorSections(fresh(),5000);initial.budgetMon='0';const {unmount}=render(<Harness initial={initial}/>);
 expect(screen.getByRole('textbox',{name:'League · test MON'})).toBeDisabled();
 expect(screen.getByRole('slider',{name:'League prize share'})).toBeEnabled();
 unmount();initial.budgetMon='1';render(<Harness initial={initial} disabled/>);
 expect(screen.getByRole('textbox',{name:'League · test MON'})).toBeDisabled();
 expect(screen.getByRole('slider',{name:'League prize share'})).toBeDisabled();
});
