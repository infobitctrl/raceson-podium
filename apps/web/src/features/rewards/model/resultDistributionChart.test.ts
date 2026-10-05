import {expect,it} from 'vitest';
import type {ResultDisplay} from '../data/resultDisplay';
import {resultDistributionChart} from './resultDistributionChart';
const data:ResultDisplay={name:'Synthetic review',estimated:false,blocked:false,scope:'race',sourceAvailable:true,allocatedWei:'7',retainedWei:'3',rows:[],distribution:[{id:'category',name:'Women',budgetWei:'10',allocatedWei:'7',retainedWei:'3',held:false,prizes:[{rank:1,amountWei:'5'},{rank:3,amountWei:'2'}]}]};
it('preserves exact rank pools, gaps and retained funds without recalculating money from rounded percentages',()=>{
 const before=structuredClone(data),chart=resultDistributionChart(data,'10')!;
 expect(chart.rows[1]).toMatchObject({amountWei:10n,retainedWei:3n,slots:[5n,0n,2n]});
 expect(data).toEqual(before);
});
it('hides rank dots for blocked categories and declines absent or inconsistent financial evidence',()=>{
 expect(resultDistributionChart({...data,blocked:true},'10')!.root.children[0].rule).toBeNull();
 expect(resultDistributionChart({...data,distribution:undefined},'10')).toBeNull();
 expect(resultDistributionChart(data,'9')).toBeNull();
 expect(resultDistributionChart({...data,allocatedWei:'8'},'10')).toBeNull();
 expect(resultDistributionChart({...data,distribution:[{...data.distribution![0],prizes:[{rank:1,amountWei:'8'}]}]},'10')).toBeNull();
});
