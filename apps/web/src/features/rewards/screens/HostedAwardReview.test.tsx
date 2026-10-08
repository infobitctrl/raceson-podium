import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import HostedAwardReview from './HostedAwardReview';
const mocks=vi.hoisted(()=>({read:vi.fn(),issues:vi.fn()}));
vi.mock('./HostedAwardUpload',()=>({default:({autoStart}:{autoStart:boolean})=><p>{autoStart?'Continue publication automatically':'Saved approval requires resume'}</p>}));
vi.mock('../data/hostedAwardReview',()=>({readHostedAwardReview:mocks.read}));
vi.mock('../data/operations',()=>({hostedReviewIssues:mocks.issues}));
const base={historicalAcknowledgement:false,contextHash:'c'.repeat(64),documentHash:'d'.repeat(64),approval:null,recorded:null,proposedWei:'1000000000000000001',retainedWei:'2',reasons:[],recipientCounts:{athletes:1,clubs:0}};
beforeEach(()=>{mocks.read.mockReset();mocks.issues.mockReset().mockResolvedValue({revision:0,contextHash:'c'.repeat(64),canReport:true,issues:[]});});
it('recovers a failed initial load without suggesting an unsubmitted decision was saved',async()=>{
 mocks.read.mockRejectedValueOnce(Error('load failed')).mockResolvedValueOnce(base);
 render(<HostedAwardReview id="setup" slot={5} hr={false}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Review details could not be loaded.');
 expect(screen.queryByRole('button',{name:'Retry same decision'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Reload review'}));
 expect(await screen.findByRole('button',{name:'Approve and open claims'})).toBeDisabled();
 expect(mocks.read.mock.calls).toEqual([['setup',5],['setup',5]]);
});
it('shows exact amounts and submits only the reviewed digest and decision',async()=>{
 mocks.read.mockResolvedValue(base);render(<HostedAwardReview id="setup" slot={0} hr={false}/>);
 await screen.findByText('1.000000000000000001 test MON');fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve and open claims'}));
 await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(2));
 const c=mocks.read.mock.calls[1][2];expect(c).toEqual({requestId:expect.any(String),expectedApprovalId:null,contextHash:base.contextHash,documentHash:base.documentHash,decision:'approved'});
 expect(JSON.stringify(c)).not.toMatch(/amountWei|wallet|beneficiary|source/);
});
it('requested pot is a bounded navigation hint and does not modify the decision',async()=>{
 mocks.read.mockResolvedValue(base);render(<HostedAwardReview id="setup" slot={4} hr={false}/>);
 await screen.findByText('1.000000000000000001 test MON');expect(mocks.read.mock.calls[0]).toEqual(['setup',4]);expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
it('disables approval for a source hold and leaves explicit hold available',async()=>{
 mocks.read.mockResolvedValue({...base,reasons:['duplicate_classified_finish']});render(<HostedAwardReview id="setup" slot={0} hr={false}/>);
 expect(await screen.findByRole('button',{name:'Approve and open claims'})).toBeDisabled();expect(screen.getByRole('button',{name:'Hold awards'})).toBeEnabled();
});
it('retries an uncertain decision with the same UUID, digest and previous approval',async()=>{
 mocks.read.mockResolvedValueOnce(base).mockRejectedValueOnce(Error('uncertain')).mockResolvedValueOnce({historicalAcknowledgement:true,approval:null,recorded:null});
 render(<HostedAwardReview id="setup" slot={0} hr={false}/>);await screen.findByRole('button',{name:'Approve and open claims'});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve and open claims'}));
 const retry=await screen.findByRole('button',{name:'Retry same decision'});expect(screen.queryByText('1.000000000000000001 test MON')).not.toBeInTheDocument();fireEvent.click(retry);
 await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(3));expect(mocks.read.mock.calls[2][2]).toEqual(mocks.read.mock.calls[1][2]);
 await screen.findByText(/earlier decision is confirmed/);
});
it('pool selection retires a late private review response',async()=>{
 let resolve!:(v:unknown)=>void;mocks.read.mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValue(base);
 const ui=render(<HostedAwardReview id="setup" slot={0} hr={false}/>);ui.rerender(<HostedAwardReview id="setup" slot={2} hr={false}/>);
 await waitFor(()=>expect(mocks.read).toHaveBeenLastCalledWith('setup',2));resolve({...base,proposedWei:'999'});
 await screen.findByText('1.000000000000000001 test MON');expect(screen.queryByText('0.000000000000000999 test MON')).not.toBeInTheDocument();
});
it('reload discards uncertain command and reads current approval without a new write',async()=>{
 mocks.read.mockResolvedValueOnce(base).mockRejectedValueOnce(Error('conflict')).mockResolvedValueOnce({...base,approval:{decision:'held',current:true}});
 render(<HostedAwardReview id="setup" slot={0} hr={false}/>);await screen.findByRole('button',{name:'Approve and open claims'});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve and open claims'}));
 fireEvent.click(await screen.findByRole('button',{name:'Reload review'}));await screen.findByText('Held');expect(mocks.read.mock.calls[2]).toEqual(['setup',0]);
 expect(screen.queryByRole('button',{name:'Retry same decision'})).not.toBeInTheDocument();
});

it('does not offer approval when visible awards differ from the current decision',async()=>{
 mocks.read.mockResolvedValue({...base,budgetWei:'3'});render(<HostedAwardReview id="setup" slot={4} hr={false} expected={{budgetWei:'2',proposedWei:'1'}}/>);
 await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Approve and open claims'})).not.toBeInTheDocument();
});
it('requires an explicit totals acknowledgement before approval',async()=>{
 mocks.read.mockResolvedValue(base);render(<HostedAwardReview id="setup" slot={4} hr={false}/>);
 expect(await screen.findByRole('button',{name:'Approve and open claims'})).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'Approve and open claims'})).toBeEnabled();
});

it('replaces the decision button while saving and never shows approval before the exact response',async()=>{
 let reject!:(reason:unknown)=>void;
 mocks.read.mockResolvedValueOnce(base).mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));
 render(<HostedAwardReview id="setup" slot={0} hr={false}/>);
 await screen.findByRole('button',{name:'Approve and open claims'});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve and open claims'}));
 expect(screen.getByRole('group',{name:'Decision progress'})).toHaveAttribute('aria-busy','true');
 expect(screen.queryByRole('button',{name:'Approve and open claims'})).not.toBeInTheDocument();
 expect(screen.queryByText('Allocation approved')).not.toBeInTheDocument();
 await act(async()=>reject(Error('uncertain')));
 expect(screen.getByRole('group',{name:'Decision progress'})).toHaveAttribute('aria-busy','false');
 expect(within(screen.getByRole('group',{name:'Decision progress'})).getAllByRole('listitem').some(x=>x.getAttribute('data-state')==='current')).toBe(false);
 expect(screen.getByRole('button',{name:'Retry same decision'})).toBeEnabled();
});

it('continues a newly saved exact approval into publication without another decision',async()=>{
 mocks.read.mockResolvedValueOnce(base).mockResolvedValueOnce({...base,approval:{id:'approval',decision:'approved',current:true,documentHash:base.documentHash}});
 render(<HostedAwardReview id="setup" slot={4} hr={false}/>);
 await screen.findByRole('checkbox');fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve and open claims'}));
 expect(await screen.findByText('Continue publication automatically')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Approve and open claims'})).not.toBeInTheDocument();expect(mocks.read).toHaveBeenCalledTimes(2);
});
it('loading an existing approval offers resume without automatically authorizing publication',async()=>{
 mocks.read.mockResolvedValue({...base,approval:{id:'approval',decision:'approved',current:true,documentHash:base.documentHash}});
 render(<HostedAwardReview id="setup" slot={4} hr={false}/>);
 expect(await screen.findByText('Saved approval requires resume')).toBeVisible();expect(mocks.read).toHaveBeenCalledOnce();
});

it('hosted issue failure and open flags block approval; only its author can withdraw',async()=>{
 mocks.read.mockResolvedValue(base);mocks.issues.mockRejectedValueOnce(Error('offline'));
 render(<HostedAwardReview id="setup" slot={0} hr={false}/>);
 await screen.findByText('Issue status could not be confirmed. Reload before approving or retrying.');
 expect(screen.queryByRole('button',{name:'Approve and open claims'})).not.toBeInTheDocument();
 mocks.issues.mockResolvedValue({revision:1,contextHash:base.contextHash,canReport:true,issues:[{id:'issue',description:'Synthetic source needs review',createdAt:'2026-10-08T12:00:00Z',withdrawnAt:null,canWithdraw:false}]});
 fireEvent.click(screen.getByRole('button',{name:'Reload issues'}));await screen.findByText('Issue flagged');
 expect(screen.queryByRole('button',{name:'Approve and open claims'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Withdraw flag'})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Hold awards'})).toBeEnabled();
});
it('hosted reviewer can report and withdraw before explicitly approving',async()=>{
 mocks.read.mockResolvedValue(base);render(<HostedAwardReview id="setup" slot={0} hr={false}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Flag an issue'}));
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'Check the official result allocation'}});
 const flagged={revision:1,contextHash:base.contextHash,canReport:true,issues:[{id:'issue',description:'Check the official result allocation',createdAt:'2026-10-08T12:00:00Z',withdrawnAt:null,canWithdraw:true}]};
 mocks.issues.mockResolvedValueOnce(flagged);fireEvent.click(screen.getByRole('button',{name:'Submit flag'}));
 fireEvent.click(await screen.findByRole('button',{name:'Withdraw flag'}));
 await screen.findByRole('button',{name:'Approve and open claims'});
 expect(mocks.issues.mock.calls[1][2]).toMatchObject({action:'report',contextHash:base.contextHash});
 expect(mocks.issues.mock.calls[2][2]).toMatchObject({action:'withdraw',issueId:'issue',expectedRevision:1});
 expect(mocks.read).toHaveBeenCalledOnce();
});
