import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import HostedReviewPublication from './HostedReviewPublication';
const mocks=vi.hoisted(()=>({read:vi.fn(),enable:vi.fn(),connected:false,session:'one'}));
vi.mock('../data/reviewPublication',()=>({readReviewPublication:mocks.read}));
vi.mock('../components/RewardEmbeddedWalletContext',()=>({useRewardEmbeddedWallet:()=>({status:'off',wallet:null,enable:mocks.enable,reviewerConnected:mocks.connected})}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({session:{}})}));
vi.mock('../model/useRewardSessionEpoch',()=>({useRewardSessionEpoch:()=>mocks.session}));
const props={id:'setup',slot:0,approvalId:'approval',documentHash:'d'.repeat(64),hr:false};
const base={state:1,claimsOpen:false,next:'upload',ownership:'owned',pending:null};
beforeEach(()=>{vi.clearAllMocks();mocks.connected=false;mocks.session='one';mocks.read.mockResolvedValue(base);});
it('reads without publication and requires the reviewer to explicitly start',async()=>{
 render(<HostedReviewPublication {...props}/>);const button=await screen.findByRole('button',{name:'Publish awards and open claims'});
 expect(mocks.read).toHaveBeenCalledExactlyOnceWith({id:'setup',slot:0,approvalId:'approval'},props.documentHash);
 mocks.read.mockResolvedValue({state:3,claimsOpen:true,next:null,ownership:'owned',pending:null});fireEvent.click(button);
 expect(await screen.findByText('Awards published. Claims are open.')).toBeVisible();expect(mocks.read.mock.lastCall?.[2]).toBe(true);
});
it('requires actual reviewer ownership and offers the one-time handover',async()=>{
 mocks.read.mockResolvedValue({...base,ownership:'transfer_required'});render(<HostedReviewPublication {...props}/>);
 expect(await screen.findByRole('link',{name:'Take ownership of rewards wallet'})).toHaveAttribute('href','/rewards/wallet-handover?setup=setup&slot=0&approval=approval');
 expect(screen.queryByRole('button',{name:'Publish awards and open claims'})).not.toBeInTheDocument();expect(mocks.read).toHaveBeenCalledOnce();
});
it('connects the same reviewer account before preparing its handover',async()=>{
 mocks.read.mockResolvedValue({...base,ownership:'connect_required'});render(<HostedReviewPublication {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Connect my reviewer account'}));expect(mocks.enable).toHaveBeenCalledOnce();expect(mocks.read).toHaveBeenCalledOnce();
});
it('retires a late response when the account changes, without continuing publication',async()=>{
 let resolve!:(v:unknown)=>void;const {rerender}=render(<HostedReviewPublication {...props}/>);const button=await screen.findByRole('button',{name:'Publish awards and open claims'});
 mocks.read.mockImplementationOnce(()=>new Promise(r=>resolve=r));fireEvent.click(button);
 mocks.session='two';mocks.read.mockResolvedValue({...base,ownership:'transfer_required'});rerender(<HostedReviewPublication {...props}/>);
 await screen.findByRole('link',{name:'Take ownership of rewards wallet'});
 await act(async()=>resolve({state:3,claimsOpen:true,next:null,ownership:'owned',pending:null}));
 expect(screen.queryByText('Awards published. Claims are open.')).not.toBeInTheDocument();expect(mocks.read).toHaveBeenCalledTimes(3);
});
it('failed read offers a status refresh without starting a transaction',async()=>{
 mocks.read.mockRejectedValueOnce(Error('unavailable')).mockResolvedValue(base);render(<HostedReviewPublication {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Refresh publication status'}));await screen.findByRole('button',{name:'Publish awards and open claims'});
 expect(mocks.read.mock.calls.every(c=>c[2]!==true)).toBe(true);
});
