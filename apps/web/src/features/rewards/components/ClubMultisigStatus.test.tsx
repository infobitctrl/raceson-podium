import {act,render,screen,waitFor} from '@testing-library/react';
import ClubMultisigStatus from './ClubMultisigStatus';
import type {ClubOwnerAward} from '../data/clubOwnerApprovals';
const m=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../data/clubDirectClaimsV5',()=>({readClubDirectClaimV5:m.read}));
const me='0x'+'12'.repeat(20),other='0x'+'34'.repeat(20),third='0x'+'56'.repeat(20),safe='0x'+'78'.repeat(20);
const item={cursor:'one',creationId:'creation',clubName:'Club 1',safeAddress:safe,award:{approvalId:'approval',entitlementId:'award',clubId:'club',amountWei:'100',slot:0,protocolVersion:6,claims:[],directClaim:{paid:false}}} as ClubOwnerAward;
const approval={signerAddress:me,requestId:'request',expiresAt:new Date(Date.now()+60000).toISOString(),signatures:[{address:me,signature:'private-payload'}],submissions:[]};
const view={clubId:'club',safeAddress:safe,amountWei:'100',protocolVersion:6,status:'claimable',phase:'register',owners:[me,other,third],ownerApproval:approval};
beforeEach(()=>{m.read.mockReset().mockResolvedValue(view);});
afterEach(()=>vi.useRealTimers());
it.each([false,true])('shows registration, count and the current athlete signature (hr=%s)',async hr=>{
 render(<ClubMultisigStatus item={item} hr={hr}/>);
 expect(await screen.findByText(hr?'1 · Registracija riznice':'1 · Treasury registration')).toBeVisible();
 expect(screen.getByText(hr?'Potpisali ste ovaj zahtjev':'You signed this request')).toBeVisible();
 expect(screen.getByText(/1\/2/)).toBeVisible();expect(screen.queryByText('private-payload')).not.toBeInTheDocument();
 expect(m.read).toHaveBeenCalledExactlyOnceWith({approvalId:'approval',entitlementId:'award'},'creation');
});
it('distinguishes another owner signature and resets status between registration and claiming',async()=>{
 const rendered=render(<ClubMultisigStatus item={item} hr={false}/>);await screen.findByText('You signed this request');
 m.read.mockResolvedValue({...view,phase:'claim',ownerApproval:{...approval,requestId:'claim-request',signatures:[{address:other}]}});
 rendered.rerender(<ClubMultisigStatus item={{...item}} hr={false}/>);
 expect(await screen.findByText('2 · Reward claim')).toBeVisible();expect(screen.getByText('You have not signed this request')).toBeVisible();expect(screen.queryByText('You signed this request')).not.toBeInTheDocument();
});
it('distinguishes two approvals, submission and payment',async()=>{
 m.read.mockResolvedValue({...view,ownerApproval:{...approval,signatures:[{address:me},{address:other}]}});
 const rendered=render(<ClubMultisigStatus item={item} hr={false}/>);await screen.findByText(/Ready to submit · 2\/2/);
 m.read.mockResolvedValue({...view,ownerApproval:{...approval,submissions:['tx']}});rendered.rerender(<ClubMultisigStatus item={{...item}} hr={false}/>);
 await screen.findByText(/Submitted · awaiting confirmation/);expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument();
 m.read.mockResolvedValue({...view,status:'paid',phase:'claim',ownerApproval:undefined});rendered.rerender(<ClubMultisigStatus item={{...item}} hr={false}/>);
 await screen.findByText('3 · Reward paid');expect(screen.getByText('Payment confirmed')).toBeVisible();expect(screen.getByText('No further signature needed')).toBeVisible();
});
it('expires a displayed request without treating its old signature as current',async()=>{
 vi.useFakeTimers();m.read.mockResolvedValue({...view,ownerApproval:{...approval,expiresAt:new Date(Date.now()+1000).toISOString()}});
 render(<ClubMultisigStatus item={item} hr={false}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});expect(screen.getByText('You signed this request')).toBeVisible();
 await act(async()=>{await vi.advanceTimersByTimeAsync(1001);});expect(screen.getByText(/Request expired/)).toBeVisible();expect(screen.getByText(/No valid signature/)).toBeVisible();expect(screen.getByText(/0\/2/)).toBeVisible();
});
it.each(['not_open','paused','expired'])('reports blocked claim status %s without inventing approvals',async status=>{
 m.read.mockResolvedValue({...view,status,ownerApproval:{...approval,requestId:null,signatures:[],expiresAt:null}});render(<ClubMultisigStatus item={item} hr={false}/>);
 await screen.findByText('You have not signed · no active request');expect(screen.queryByText(/Collecting signatures/)).not.toBeInTheDocument();
});
it('does not infer paid or signed from a stale list item, and reports failed access',async()=>{
 const lost=vi.fn();m.read.mockRejectedValue({status:403});render(<ClubMultisigStatus item={{...item,award:{...item.award,directClaim:{paid:true}}}} hr={false} onAccessError={lost}/>);
 await screen.findByText(/Multisig status unavailable/);expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument();expect(lost).toHaveBeenCalledWith({status:403});
});
it('rejects a mismatched treasury and ignores a late previous account response',async()=>{
 m.read.mockResolvedValueOnce({...view,safeAddress:other});const first=render(<ClubMultisigStatus item={item} hr={false}/>);await screen.findByText(/Multisig status unavailable/);first.unmount();
 let finish:(value:unknown)=>void=()=>{};m.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const old=render(<ClubMultisigStatus item={item} hr={false}/>);await waitFor(()=>expect(m.read).toHaveBeenCalledTimes(2));old.unmount();
 m.read.mockResolvedValue({...view,ownerApproval:{...approval,signatures:[]}});render(<ClubMultisigStatus item={item} hr={false}/>);await screen.findByText('You have not signed this request');
 await act(async()=>finish(view));expect(screen.queryByText('You signed this request')).not.toBeInTheDocument();
});
