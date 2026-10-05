import {render,screen,fireEvent} from '@testing-library/react';
import {expect,it} from 'vitest';
import RewardReviewOverview from './RewardReviewOverview';
import type {ResultDisplay} from '../data/resultDisplay';
const data:ResultDisplay={name:'Synthetic pot',estimated:false,blocked:false,scope:'race',sourceAvailable:true,rows:[],allocatedWei:'5000000000000000000',retainedWei:'5000000000000000000',distribution:[{id:'women',name:'Women',budgetWei:'10000000000000000000',allocatedWei:'5000000000000000000',retainedWei:'5000000000000000000',held:false,prizes:[{rank:1,amountWei:'5000000000000000000'}]}]};
it('starts with category inspection, reveals exact rank pools and keeps editing controls unavailable',()=>{
 render(<RewardReviewOverview data={data} budgetWei="10000000000000000000"/>);
 expect(screen.getByRole('checkbox',{name:'Prize places'})).not.toBeChecked();
 expect(screen.queryByRole('button',{name:/Women · Place 1/})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Reset positions'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('checkbox',{name:'Prize places'}));
 const prize=screen.getByRole('button',{name:'Women · Place 1, 50%, 5 test MON'});
 fireEvent.keyDown(prize,{key:'Enter'});
 expect(screen.getByText('Rank 1 · award pool').nextElementSibling).toHaveTextContent('5 test MON');
 expect(prize).toHaveAttribute('aria-controls','reward-review-inspector');
});
