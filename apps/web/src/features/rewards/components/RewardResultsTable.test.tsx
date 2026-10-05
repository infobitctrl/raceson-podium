import {render,screen,fireEvent,within} from '@testing-library/react';
import {expect,it} from 'vitest';
import RewardResultsTable from './RewardResultsTable';
import {resultTime} from '../model/resultTime';
import type {ResultDisplay} from '../data/resultDisplay';
const data:ResultDisplay={name:'Synthetic race',estimated:true,blocked:false,allocatedWei:'600000000000000000',retainedWei:'400000000000000000',sourceAvailable:true,scope:'race',rows:Array.from({length:12},(_,i)=>({key:`row-${i}`,rank:i+1,name:`Athlete ${i+1} Sample`,club:i%2?'Sample club':null,race:i<9?'Short':'Long',categories:[i%2?'Women':'Men'],timeMs:1634000+i*1000,status:'finished',amountWei:i===0?'200000000000000000':'0',kind:'athlete'}))};
it('shows recognizable rows, precise amounts and race/category/name filtering without duplicating totals',()=>{
 render(<RewardResultsTable data={data} budgetWei="1000000000000000000"/>);
 expect(screen.getByText('Athlete 1 Sample')).toBeVisible();expect(screen.getByText('00:27:14')).toBeVisible();
 expect(screen.getByText('0.2 test MON')).toBeVisible();expect(screen.queryByText('Athlete 9 Sample')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Next results'}));expect(screen.getByText('Athlete 9 Sample')).toBeVisible();
 fireEvent.change(screen.getByRole('combobox',{name:'Race'}),{target:{value:'Long'}});expect(screen.getByText('Showing 1–3 of 3')).toBeVisible();
 fireEvent.change(screen.getByRole('combobox',{name:'Category'}),{target:{value:'Women'}});expect(screen.getByText('Showing 1–2 of 2')).toBeVisible();
 fireEvent.change(screen.getByRole('textbox',{name:'Find an athlete'}),{target:{value:'Athlete 12'}});expect(screen.getByText('Showing 1–1 of 1')).toBeVisible();
 expect(screen.getByText('0.6 test MON')).toBeVisible();
});
it('distinguishes blocked amounts, non-finishers, missing clubs and separate club awards',()=>{
 render(<RewardResultsTable budgetWei="1000000000000000000" approved data={{...data,estimated:false,blocked:true,rows:[{...data.rows[0],status:'dnf',amountWei:null},{...data.rows[1],kind:'club',name:'Sample club reward'}]}}/>);
 expect(screen.getByText('Pending review')).toBeVisible();expect(screen.getByText('DNF')).toBeVisible();
 const table=screen.getAllByRole('table')[0];expect(within(table).queryByText('Sample club reward')).not.toBeInTheDocument();
 expect(resultTime(3601000,'finished')).toBe('01:00:01');expect(resultTime(null,'finished')).toBe('—');
});

it('clears combined athlete filters, resets pagination and preserves full-pot amounts and club search',()=>{
 const club={...data.rows[0],key:'club',kind:'club' as const,name:'Sample Club',points:10};
 render(<RewardResultsTable data={{...data,rows:[...data.rows,club]}} budgetWei="1000000000000000000"/>);
 expect(screen.queryByRole('button',{name:'Clear athlete filters'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByRole('textbox',{name:'Find a club'}),{target:{value:'Sample'}});
 fireEvent.click(screen.getByRole('button',{name:'Next results'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Race'}),{target:{value:'Long'}});
 fireEvent.change(screen.getByRole('combobox',{name:'Category'}),{target:{value:'Women'}});
 fireEvent.change(screen.getByRole('textbox',{name:'Find an athlete'}),{target:{value:'missing'}});
 expect(screen.getByText('0 of 12 results match your filters')).toBeVisible();
 expect(screen.getByText('0 results')).toBeVisible();
 expect(screen.getByText('0.6 test MON')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Clear athlete filters'}));
 expect(screen.getByRole('combobox',{name:'Race'})).toHaveValue('');
 expect(screen.getByRole('combobox',{name:'Category'})).toHaveValue('');
 expect(screen.getByRole('textbox',{name:'Find an athlete'})).toHaveValue('');
 expect(screen.getByRole('textbox',{name:'Find a club'})).toHaveValue('Sample');
 expect(screen.getByText('Showing 1–8 of 12')).toBeVisible();
 expect(screen.getByRole('button',{name:'Previous results'})).toBeDisabled();
 expect(screen.queryByRole('button',{name:'Clear athlete filters'})).not.toBeInTheDocument();
});
it('keeps reward sorting after clearing athlete filters',()=>{
 render(<RewardResultsTable data={data} budgetWei="1000000000000000000"/>);
 fireEvent.click(screen.getByRole('button',{name:'Proposed reward'}));
 fireEvent.click(screen.getByRole('button',{name:'Proposed reward'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Find an athlete'}),{target:{value:'missing'}});
 fireEvent.click(screen.getByRole('button',{name:'Clear athlete filters'}));
 expect(screen.getByRole('columnheader',{name:'Proposed reward'})).toHaveAttribute('aria-sort','descending');
 expect(within(screen.getByRole('table')).getAllByRole('row')[1]).toHaveTextContent('Athlete 1 Sample');
});
it('separates race/category tables while preserving overlapping membership, official rank and one full-pot total',()=>{
 const overlap={...data.rows[0],rank:7,categories:['Women','Senior'],amountWei:'200000000000000000'};
 render(<RewardResultsTable groupByCategory data={{...data,rows:[overlap,{...data.rows[1],race:'Long',categories:['Women']}]}} budgetWei="1000000000000000000"/>);
 const women=screen.getByRole('table',{name:'Short · Women'}),senior=screen.getByRole('table',{name:'Short · Senior'});
 expect(within(women).getByRole('rowheader',{name:'Athlete 1 Sample'})).toBeVisible();
 expect(within(senior).getByRole('rowheader',{name:'Athlete 1 Sample'})).toBeVisible();
 expect(within(women).getByRole('cell',{name:'7'})).toBeVisible();
 expect(within(women).getByRole('columnheader',{name:'Total award · all categories'})).toBeVisible();
 expect(screen.getAllByText('0.6 test MON')).toHaveLength(1);
 expect(screen.getByRole('table',{name:'Long · Women'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'All results',exact:true}));
 expect(screen.getAllByRole('table')).toHaveLength(1);
 expect(screen.getAllByRole('rowheader',{name:/Athlete 1 Sample/})).toHaveLength(1);
});
it('paginates category tables independently and resets them when shared filters change',()=>{
 render(<RewardResultsTable groupByCategory data={{...data,rows:data.rows.map(row=>({...row,race:'Short',categories:['Women']}))}} budgetWei="1000000000000000000"/>);
 fireEvent.click(screen.getByRole('button',{name:'Next results · Short · Women'}));
 expect(screen.getByText('Athlete 12 Sample')).toBeVisible();
 fireEvent.change(screen.getByRole('textbox',{name:'Find an athlete'}),{target:{value:'Athlete 1 Sample'}});
 expect(screen.getByRole('button',{name:'Previous results · Short · Women'})).toBeDisabled();
 expect(screen.getByText('Showing 1–1 of 1')).toBeVisible();
});
