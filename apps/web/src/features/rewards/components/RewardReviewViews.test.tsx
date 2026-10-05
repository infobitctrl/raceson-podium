import {fireEvent,render,screen,within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import type {ResultDisplay} from '../data/resultDisplay';
import RewardReviewViews from './RewardReviewViews';
vi.mock('./RewardResultsTable',()=>({default:()=> <p>Official standings fixture</p>}));
vi.mock('./RewardReviewOverview',()=>({default:()=> <p>Distribution fixture</p>}));
const data:ResultDisplay={name:'Synthetic round',scope:'race',estimated:false,blocked:false,allocatedWei:'3000000000000000000',retainedWei:'1000000000000000000',sourceAvailable:true,rows:[],recipientTotals:[{key:'athlete:one',name:'Same name',kind:'athlete',categoryCount:2,amountWei:'1000000000000000000'},{key:'athlete:two',name:'Same name',kind:'athlete',categoryCount:1,amountWei:'2000000000000000000'}],distribution:[{id:'held',name:'Official category',budgetWei:'1000000000000000000',allocatedWei:'0',retainedWei:'1000000000000000000',held:true,prizes:[]}]};
const tab=(name:string)=>fireEvent.mouseDown(screen.getByRole('tab',{name}),{button:0,ctrlKey:false});
it('keeps identical recipient names separate and uses server totals',()=>{
 render(<RewardReviewViews data={data} budgetWei="4000000000000000000"/>);
 expect(screen.getByText('Official standings fixture')).toBeVisible();tab('Recipient totals');
 const rows=within(screen.getByRole('table')).getAllByRole('row');expect(rows).toHaveLength(3);
 expect(rows[1]).toHaveTextContent('Same name');expect(rows[1]).toHaveTextContent('2 test MON');
 expect(rows[2]).toHaveTextContent('1 test MON');expect(screen.queryByText('Official standings fixture')).not.toBeInTheDocument();
});
it('shows reserved source holds separately from recipient wallet readiness',()=>{
 render(<RewardReviewViews data={data} budgetWei="4000000000000000000"/>);tab('Reserved funds');
 expect(screen.getByText(/category allocation is on hold/)).toBeVisible();expect(screen.getByText(/not a list of walletless athletes/)).toBeVisible();
 tab('Distribution');expect(screen.getByText('Distribution fixture')).toBeVisible();
});
it('does not manufacture aggregate identity when older records lack totals',()=>{
 render(<RewardReviewViews data={{...data,recipientTotals:undefined}} budgetWei="4000000000000000000"/>);tab('Recipient totals');
 expect(screen.getByRole('status')).toHaveTextContent('unavailable for this record');expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
