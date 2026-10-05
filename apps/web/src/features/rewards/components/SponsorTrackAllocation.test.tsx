import {useState} from 'react';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {expect,it} from 'vitest';
import {createGuidedSetup,addGuidedGroup} from '@raceson/domain/rewards/guided-setup-editor';
import type {RewardDistributionSetup} from '@raceson/domain/rewards/distribution-setup';
import type {SponsorTrack} from '../model/sponsorTrackAllocation';
import SponsorTrackAllocation from './SponsorTrackAllocation';
import SponsorBudgetSummary from './SponsorBudgetSummary';

function Harness({disabled=false}:{disabled?:boolean}){
 const [c,setC]=useState(()=>{let i=1;const id=()=>`73000000-0000-4000-8000-${String(i++).padStart(12,'0')}`;let setup=createGuidedSetup(id);for(let k=0;k<3;k++)setup=addGuidedGroup(setup,setup.guided!.pots[5].nodeId,'athlete_standings',id,null);setup.budgetMon='100';setup.root.children=setup.root.children.map(n=>({...n,shareBps:n.id===setup.guided!.pots[5].nodeId?10000:0}));return setup;});
 const pot=c.root.children[5],tracks:SponsorTrack[]=[{id:'velika',name:'Velika',categoryIds:[],nodeIds:[pot.children[0].id]},{id:'mala',name:'Mala',categoryIds:[],nodeIds:pot.children.slice(1).map(n=>n.id)}];
 return <><SponsorTrackAllocation configuration={c} potId={pot.id} tracks={tracks} onChange={setC} disabled={disabled} hr={false}/><SponsorBudgetSummary configuration={c} selectedRace={{slot:5,name:'Trail',tracks}} hr={false}/><output data-testid="config">{JSON.stringify(c)}</output></>;
}
it('keeps Base44 track rows, amounts and summary synchronized through splitting and exclusion',()=>{
 render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'Split evenly'}));
 expect(screen.getByRole('spinbutton',{name:'Velika %'})).toHaveValue(50);
 expect(screen.getByRole('spinbutton',{name:'Mala %'})).toHaveValue(50);
 fireEvent.change(screen.getByRole('spinbutton',{name:'Velika %'}),{target:{value:'60'}});
 expect(screen.getByRole('spinbutton',{name:'Mala %'})).toHaveValue(40);
 const summary=within(screen.getByRole('complementary',{name:'Campaign summary'}));
 expect(summary.getByText('60%')).toBeVisible();expect(summary.getByText('40%')).toBeVisible();
 fireEvent.click(screen.getByRole('checkbox',{name:'Mala'}));
 expect(screen.getByRole('spinbutton',{name:'Velika %'})).toHaveValue(100);
 expect(screen.getByRole('spinbutton',{name:'Mala %'})).toHaveValue(0);
 const c=JSON.parse(screen.getByTestId('config').textContent!) as RewardDistributionSetup;
 expect(c.root.children[5].children.map(n=>n.shareBps)).toEqual([10000,0,0]);
});
it('keeps saved track allocations disabled',()=>{render(<Harness disabled/>);expect(screen.getByRole('button',{name:'Split evenly'})).toBeDisabled();expect(screen.getByRole('checkbox',{name:'Mala'})).toBeDisabled();expect(screen.getByRole('spinbutton',{name:'Velika %'})).toBeDisabled();});

it('selects one track without silently selecting the other',()=>{
 render(<Harness/>);fireEvent.click(screen.getByRole('checkbox',{name:'Mala'}));
 expect(screen.getByRole('spinbutton',{name:'Mala %'})).toHaveValue(100);
 expect(screen.getByRole('checkbox',{name:'Velika'})).not.toBeChecked();
 fireEvent.click(screen.getByRole('checkbox',{name:'Velika'}));
 expect(screen.getByRole('spinbutton',{name:'Mala %'})).toHaveValue(50);
 expect(screen.getByRole('spinbutton',{name:'Velika %'})).toHaveValue(50);
});
