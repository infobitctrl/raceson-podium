import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import HostedAwardReview from './HostedAwardReview';
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('./HostedAwardUpload',()=>({default:()=>null}));
vi.mock('../data/hostedAwardReview',()=>({readHostedAwardReview:mocks.read}));
const base={historicalAcknowledgement:false,contextHash:'c'.repeat(64),documentHash:'d'.repeat(64),approval:null,recorded:null,proposedWei:'1000000000000000001',retainedWei:'2',reasons:[],recipientCounts:{athletes:1,clubs:0}};
beforeEach(()=>mocks.read.mockReset());
it('shows exact amounts and submits only the reviewed digest and decision',async()=>{
 mocks.read.mockResolvedValue(base);render(<HostedAwardReview id="setup" slot={0} hr={false}/>);
 await screen.findByText('1.000000000000000001 test MON');fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve exact awards'}));
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
 expect(await screen.findByRole('button',{name:'Approve exact awards'})).toBeDisabled();expect(screen.getByRole('button',{name:'Hold awards'})).toBeEnabled();
});
it('retries an uncertain decision with the same UUID, digest and previous approval',async()=>{
 mocks.read.mockResolvedValueOnce(base).mockRejectedValueOnce(Error('uncertain')).mockResolvedValueOnce({historicalAcknowledgement:true,approval:null,recorded:null});
 render(<HostedAwardReview id="setup" slot={0} hr={false}/>);await screen.findByRole('button',{name:'Approve exact awards'});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve exact awards'}));
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
 render(<HostedAwardReview id="setup" slot={0} hr={false}/>);await screen.findByRole('button',{name:'Approve exact awards'});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve exact awards'}));
 fireEvent.click(await screen.findByRole('button',{name:'Reload review'}));await screen.findByText('Held');expect(mocks.read.mock.calls[2]).toEqual(['setup',0]);
 expect(screen.queryByRole('button',{name:'Retry same decision'})).not.toBeInTheDocument();
});

it('does not offer approval when visible awards differ from the current decision',async()=>{
 mocks.read.mockResolvedValue({...base,budgetWei:'3'});render(<HostedAwardReview id="setup" slot={4} hr={false} expected={{budgetWei:'2',proposedWei:'1'}}/>);
 await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Approve exact awards'})).not.toBeInTheDocument();
});
it('requires an explicit totals acknowledgement before approval',async()=>{
 mocks.read.mockResolvedValue(base);render(<HostedAwardReview id="setup" slot={4} hr={false}/>);
 expect(await screen.findByRole('button',{name:'Approve exact awards'})).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'Approve exact awards'})).toBeEnabled();
});

it('replaces the decision button while saving and never shows approval before the exact response',async()=>{
 let reject!:(reason:unknown)=>void;
 mocks.read.mockResolvedValueOnce(base).mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));
 render(<HostedAwardReview id="setup" slot={0} hr={false}/>);
 await screen.findByRole('button',{name:'Approve exact awards'});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve exact awards'}));
 expect(screen.getByRole('group',{name:'Decision progress'})).toHaveAttribute('aria-busy','true');
 expect(screen.queryByRole('button',{name:'Approve exact awards'})).not.toBeInTheDocument();
 expect(screen.queryByText('Allocation approved')).not.toBeInTheDocument();
 await act(async()=>reject(Error('uncertain')));
 expect(screen.getByRole('group',{name:'Decision progress'})).toHaveAttribute('aria-busy','false');
 expect(screen.getAllByRole('listitem').some(x=>x.getAttribute('data-state')==='current')).toBe(false);
 expect(screen.getByRole('button',{name:'Retry same decision'})).toBeEnabled();
});
