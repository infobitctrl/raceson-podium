import {render,screen,fireEvent,within} from '@testing-library/react';
import {expect,it} from 'vitest';
import ClubResultsTable from './ClubResultsTable';
import type {ResultDisplay} from '../data/resultDisplay';
const rows:ResultDisplay['rows']=Array.from({length:12},(_,i)=>({key:`club-${i}`,rank:i<2?1:i+1,name:`Sample club ${i+1}`,club:null,race:'Official round',categories:[i<10?'Club points':'Distance'],points:i<10?100-i:null,timeMs:null,status:'finished',amountWei:i===0?'200000000000000000':'0',kind:'club'}));
it('shows the full styled club standings with independent search, category filtering and paging',()=>{
 render(<ClubResultsTable rows={rows}/>);
 const table=screen.getByRole('table');expect(within(table).getByRole('columnheader',{name:'Points'})).toBeVisible();
 expect(screen.getByText('Sample club 1')).toBeVisible();expect(screen.getByText('100')).toBeVisible();expect(screen.getByText('0.2 test MON')).toBeVisible();
 expect(screen.queryByText('Sample club 9')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Next club results'}));expect(screen.getByText('Sample club 9')).toBeVisible();
 fireEvent.change(screen.getByRole('combobox',{name:'Club category'}),{target:{value:'Distance'}});expect(screen.getByText('Showing 1–2 of 2 club entries')).toBeVisible();
 fireEvent.change(screen.getByRole('textbox',{name:'Find a club'}),{target:{value:'12'}});expect(screen.getByText('Sample club 12')).toBeVisible();expect(screen.queryByText('Sample club 11')).not.toBeInTheDocument();
 fireEvent.change(screen.getByRole('textbox',{name:'Find a club'}),{target:{value:'missing'}});expect(screen.getByRole('status')).toHaveTextContent('No matching clubs');
});
it('distinguishes missing source points and held rewards from known zero values',()=>{
 render(<ClubResultsTable approved rows={[{...rows[0],points:null,rank:null,amountWei:null},{...rows[1],points:0}]}/>);
 expect(screen.getByRole('columnheader',{name:'Reward'})).toBeVisible();expect(screen.getByText('Pending review')).toBeVisible();expect(screen.getByText('0')).toBeVisible();expect(screen.getByText('0 test MON')).toBeVisible();expect(screen.getAllByText('—')).toHaveLength(2);
});

it('clears club filters without losing selected sort or pagination recovery',()=>{
 render(<ClubResultsTable rows={rows}/>);
 expect(screen.queryByRole('button',{name:'Clear club filters'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Points'}));fireEvent.click(screen.getByRole('button',{name:'Points'}));
 fireEvent.click(screen.getByRole('button',{name:'Next club results'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Club category'}),{target:{value:'Distance'}});
 fireEvent.change(screen.getByRole('textbox',{name:'Find a club'}),{target:{value:'missing'}});
 expect(screen.getByText('0 of 12 club entries match your filters')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Clear club filters'}));
 expect(screen.getByRole('combobox',{name:'Club category'})).toHaveValue('');
 expect(screen.getByRole('textbox',{name:'Find a club'})).toHaveValue('');
 expect(screen.getByText('Showing 1–8 of 12 club entries')).toBeVisible();
 expect(screen.getByRole('button',{name:'Previous club results'})).toBeDisabled();
 expect(screen.getByRole('columnheader',{name:'Points'})).toHaveAttribute('aria-sort','descending');
 expect(within(screen.getByRole('table')).getAllByRole('row')[1]).toHaveTextContent('Sample club 1');
 expect(screen.queryByRole('button',{name:'Clear club filters'})).not.toBeInTheDocument();
});
