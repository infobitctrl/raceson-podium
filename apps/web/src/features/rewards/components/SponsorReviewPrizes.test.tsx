import {render,screen,within} from '@testing-library/react';
import {expect,it} from 'vitest';
import {createGuidedSetup,addGuidedGroup} from '@raceson/domain/rewards/guided-setup-editor';
import {previewRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import SponsorReviewPrizes from './SponsorReviewPrizes';
it('shows only selected categories in one exact prize table without mutating excluded rules',()=>{
 let i=1;const next=()=>`94000000-0000-4000-8000-${String(i++).padStart(12,'0')}`;let c=createGuidedSetup(next);c.budgetMon='1';
 for(let n=0;n<2;n++)c=addGuidedGroup(c,c.root.children[0].id,'athlete_standings',next,null);
 const pot=c.root.children[0];pot.children[0].name='Selected';pot.children[0].shareBps=10000;pot.children[0].rule!.sharesBps=[5000,3000,2000];pot.children[1].name='Excluded';pot.children[1].shareBps=0;
 const before=JSON.stringify(c);render(<SponsorReviewPrizes pot={pot} preview={previewRewardSetup(c)} hr={false}/>);
 expect(screen.getAllByRole('table')).toHaveLength(1);expect(screen.queryByText('Excluded')).not.toBeInTheDocument();expect(screen.getByText('Selected')).toBeVisible();
 expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);expect(screen.getByText('0.25')).toBeVisible();expect(JSON.stringify(c)).toBe(before);
});
