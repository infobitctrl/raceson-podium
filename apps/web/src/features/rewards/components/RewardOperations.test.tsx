import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
import RewardReviewIssues from './RewardReviewIssues';
import RewardSupportSettings from './RewardSupportSettings';
const m=vi.hoisted(()=>({issues:vi.fn(),read:vi.fn(),review:vi.fn(),save:vi.fn()}));
vi.mock('../data/operations',()=>({reviewIssues:m.issues,readSupportSettings:m.read,reviewSupportSettings:m.review,saveSupportSettings:m.save}));
const id='aa000000-0000-4000-8000-000000000001',hash='a'.repeat(64);
const emptyIssues={revision:0,contextHash:hash,canReport:true,issues:[]};
const settings={gasAlertWei:null,supportWallet:null,supportLimitWei:'0'};
const snapshot={revision:0,settings,history:[],gas:null};
beforeEach(()=>{vi.resetAllMocks();m.issues.mockResolvedValue(emptyIssues);m.read.mockResolvedValue(snapshot);});
const reviewer=(hr=false)=>render(<RewardReviewIssues setupId={id} slot={1} contextHash={hash} approved={false} hr={hr}><button>Approve exact awards</button></RewardReviewIssues>);
it('reports, blocks approval, withdraws and retains issue history',async()=>{
 reviewer();fireEvent.click(await screen.findByRole('button',{name:'Flag an issue'}));expect(screen.getByRole('button',{name:'Submit flag'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Describe the issue'),{target:{value:'Check the synthetic allocation totals.'}});
 const issue={id,description:'Check the synthetic allocation totals.',createdBy:id,createdAt:'2026-10-05T08:00:00Z',withdrawnAt:null,canWithdraw:true};
 m.issues.mockResolvedValueOnce({...emptyIssues,revision:1,issues:[issue]});fireEvent.click(screen.getByRole('button',{name:'Submit flag'}));
 await screen.findByRole('button',{name:'Withdraw flag'});expect(screen.queryByRole('button',{name:'Approve exact awards'})).not.toBeInTheDocument();m.issues.mockResolvedValue({...emptyIssues,revision:2,issues:[{...issue,withdrawnAt:'2026-10-05T08:01:00Z',canWithdraw:false}]});fireEvent.click(screen.getByRole('button',{name:'Withdraw flag'}));
 await screen.findByRole('button',{name:'Approve exact awards'});expect(screen.getByText('Issue history (1)')).toBeVisible();
});
it('an open flag hides approval and another reviewer cannot withdraw it',async()=>{
 m.issues.mockResolvedValue({...emptyIssues,revision:1,issues:[{id,description:'Review allocation.',createdBy:id,createdAt:'2026-10-05T08:00:00Z',withdrawnAt:null,canWithdraw:false}]});reviewer();
 await screen.findByText('Issue flagged');expect(screen.queryByRole('button',{name:'Approve exact awards'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Withdraw flag'})).not.toBeInTheDocument();
});
it('failed issue read fails closed with a usable reload',async()=>{
 m.issues.mockRejectedValueOnce(Error('offline'));reviewer();await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Approve exact awards'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Reload issues'}));expect(await screen.findByRole('button',{name:'Approve exact awards'})).toBeEnabled();
});
it('support settings require review, reason and acknowledgment and invalidate on edits',async()=>{
 render(<RewardSupportSettings area="support" hr={false}/>);await screen.findByLabelText('Support wallet address');
 expect(screen.getByRole('button',{name:'Review change'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Support wallet address'),{target:{value:'0x'+'12'.repeat(20)}});fireEvent.change(screen.getByLabelText('Support limit (test MON)'),{target:{value:'0.25'}});
 const candidate={...settings,supportWallet:'0x'+'12'.repeat(20),supportLimitWei:'250000000000000000'};m.review.mockResolvedValue({revision:0,settings:candidate,fingerprint:hash});
 fireEvent.click(screen.getByRole('button',{name:'Review change'}));expect(await screen.findByRole('button',{name:'Save change'})).toBeDisabled();expect(m.save).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Reason for change'),{target:{value:'Synthetic support test'}});fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'Save change'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));fireEvent.change(screen.getByLabelText('Support limit (test MON)'),{target:{value:'0.5'}});expect(screen.queryByRole('button',{name:'Save change'})).not.toBeInTheDocument();
});
it('saves a reviewed gas alert with exact wei and keeps failed saves retryable',async()=>{
 render(<RewardSupportSettings area="gas" hr={false}/>);fireEvent.change(await screen.findByLabelText('Low-balance alert (test MON)'),{target:{value:'2.000000000000000001'}});
 const candidate={...settings,gasAlertWei:'2000000000000000001'},review={revision:0,settings:candidate,fingerprint:hash};m.review.mockResolvedValue(review);
 fireEvent.click(screen.getByRole('button',{name:'Review change'}));await screen.findByRole('button',{name:'Save change'});expect(m.review).toHaveBeenCalledWith(0,candidate);
 fireEvent.change(screen.getByLabelText('Reason for change'),{target:{value:'Synthetic balance threshold'}});fireEvent.click(screen.getByRole('checkbox'));m.save.mockRejectedValueOnce(Error('lost response'));
 fireEvent.click(screen.getByRole('button',{name:'Save change'}));await screen.findByRole('alert');const requestId=m.save.mock.calls[0][2];
 m.save.mockResolvedValue({...snapshot,revision:1,settings:candidate});fireEvent.click(screen.getByRole('button',{name:'Save change'}));await screen.findByText('Settings saved. No funds were moved.');expect(m.save.mock.calls[1][2]).toBe(requestId);
});
it('Croatian recipient-support controls use translated labels',async()=>{
 render(<RewardSupportSettings area="support" hr/>);expect(await screen.findByLabelText('Adresa novčanika za podršku')).toBeVisible();expect(screen.getByRole('button',{name:'Pregledaj promjenu'})).toBeDisabled();
});
