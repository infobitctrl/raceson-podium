import { act,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { beforeEach,expect,it,vi } from 'vitest';
import { I18nProvider } from '@/shared/i18n/I18nProvider';
import ProgrammeWorkflowV3 from './ProgrammeWorkflowV3';
const calls=vi.hoisted(()=>({inspect:vi.fn(),schedule:vi.fn()}));
vi.mock('../data/workflowV3',()=>({inspectWorkflow:(...args:unknown[])=>calls.inspect(...args),scheduleWorkflow:(...args:unknown[])=>calls.schedule(...args)}));
const id=(n:number)=>`8fe00000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const target={kind:'programme' as const,draftId:id(1),slot:6,approvalId:id(2),uploadId:id(3),intentId:id(4),attemptId:null};
const value={recorded:false,transactionHash:null,plan:{planHash:`0x${'a'.repeat(64)}`,campaignAddress:`0x${'b'.repeat(40)}`,operatorAddress:`0x${'c'.repeat(40)}`,allocatedWei:'1000000000000000001',fees:{maxGasCostWei:'500000000000000000'}}};
const element=(onSigned=vi.fn(),t=target,jobId:string|null=null)=><I18nProvider initialLocale="en"><ProgrammeWorkflowV3 target={t} chainId={31337} jobId={jobId} transactionHash={jobId?`0x${'d'.repeat(64)}`:null} onSigned={onSigned}/></I18nProvider>;
beforeEach(()=>{calls.inspect.mockReset().mockResolvedValue(value);calls.schedule.mockReset()});
it('requires exact-plan consent and recovers a lost signing response with the same attempt',async()=>{
 const signed=vi.fn();render(element(signed));fireEvent.click(screen.getByRole('button',{name:'Inspect operator signing plan'}));
 await screen.findByRole('checkbox');expect(screen.getByRole('button',{name:'Authorize this exact signature'})).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox'));calls.inspect.mockRejectedValueOnce({status:503});fireEvent.click(screen.getByRole('button',{name:'Authorize this exact signature'}));
 await screen.findByRole('alert');const original=calls.inspect.mock.calls[1][0];expect(calls.inspect.mock.calls[1][2]).toBe(value.plan.planHash);
 calls.inspect.mockResolvedValueOnce({...value,recorded:true,transactionHash:`0x${'d'.repeat(64)}`});fireEvent.click(screen.getByRole('button',{name:'Inspect operator signing plan'}));
 await screen.findByText('Signature recorded · not submitted');expect(calls.inspect.mock.calls[2][0]).toEqual(original);expect(signed).toHaveBeenCalledOnce();
});
it('retires late inspection after a scope change and enables a new inspection',async()=>{
 let finish!:(value:unknown)=>void;calls.inspect.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
 const view=render(element());fireEvent.click(screen.getByRole('button',{name:'Inspect operator signing plan'}));
 await waitFor(()=>expect(finish).toBeTypeOf('function'));view.rerender(element(vi.fn(),{...target,slot:5}));
 expect(screen.getByRole('button',{name:'Inspect operator signing plan'})).toBeEnabled();await act(async()=>finish(value));expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
it('does not report scheduled or submitted work as a confirmed receipt',async()=>{
 calls.schedule.mockResolvedValueOnce({state:'queued',confirmed:false,reconciliationRequired:false,scheduled:false,scheduler:null})
  .mockResolvedValue({state:'submitted',confirmed:false,reconciliationRequired:true,scheduled:true,scheduler:{outcome:'submitted'}});
 render(element(vi.fn(),target,id(7)));
 expect(screen.queryByRole('button',{name:'Schedule the queued transaction'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Refresh execution status'}));await screen.findByRole('checkbox');
 expect(screen.getByRole('button',{name:'Schedule the queued transaction'})).toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Schedule the queued transaction'}));
 await screen.findByText('Scheduled · awaiting a verified receipt');expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(calls.schedule).toHaveBeenCalledTimes(2);
 expect(screen.getByText(/may already have been sent/)).toBeVisible();
});
it('holds uncertain and authorization-required jobs without offering another schedule',async()=>{
 calls.schedule.mockResolvedValue({state:'submitted',confirmed:false,reconciliationRequired:true,scheduled:true,scheduler:{outcome:'authorization_required'}});
 render(element(vi.fn(),target,id(7)));fireEvent.click(screen.getByRole('button',{name:'Refresh execution status'}));
 await screen.findByText(/a current authorized operator session is required/);
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
 calls.schedule.mockRejectedValueOnce({status:503});fireEvent.click(screen.getByRole('button',{name:'Refresh execution status'}));
 await screen.findByText(/Execution is unavailable/);expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
 expect(screen.queryByText(/Scheduled ·/)).not.toBeInTheDocument();
});
it('keeps a ledger-confirmed receipt terminal even if worker progress is stale',async()=>{
 calls.schedule.mockResolvedValue({state:'confirmed',confirmed:true,reconciliationRequired:true,scheduled:true,scheduler:{outcome:'authorization_required'}});
 render(element(vi.fn(),target,id(7)));fireEvent.click(screen.getByRole('button',{name:'Refresh execution status'}));
 await waitFor(()=>expect(calls.schedule).toHaveBeenCalledOnce());
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
 expect(screen.queryByText(/may already have been sent/)).not.toBeInTheDocument();
});
