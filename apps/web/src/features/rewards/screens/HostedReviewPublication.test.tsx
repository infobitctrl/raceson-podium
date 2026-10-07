import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import HostedReviewPublication from './HostedReviewPublication';
const mocks=vi.hoisted(()=>({read:vi.fn(),authorize:vi.fn(),enable:vi.fn(),connected:false,session:'one'}));
vi.mock('../data/reviewPublication',()=>({readReviewPublication:mocks.read}));
vi.mock('../components/RewardEmbeddedWalletContext',()=>({useRewardEmbeddedWallet:()=>({status:'off',wallet:null,enable:mocks.enable,reviewerConnected:mocks.connected,authorizePublication:mocks.authorize})}));
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
it('explains unavailable handover without offering publication',async()=>{
 mocks.read.mockResolvedValue({...base,ownership:'transfer_required'});render(<HostedReviewPublication {...props}/>);
 expect(await screen.findByRole('link',{name:'Check wallet access'})).toHaveAttribute('href','/rewards/review');
 expect(screen.queryByRole('button',{name:'Publish awards and open claims'})).not.toBeInTheDocument();expect(mocks.read).toHaveBeenCalledOnce();
});
it('does not create reviewer wallet access for an unsupported handover',async()=>{
 mocks.read.mockResolvedValue({...base,ownership:'connect_required'});render(<HostedReviewPublication {...props}/>);
 await screen.findByRole('link',{name:'Check wallet access'});expect(screen.getByRole('status')).toHaveTextContent('owns the assigned wallet');expect(mocks.enable).not.toHaveBeenCalled();expect(mocks.read).toHaveBeenCalledOnce();
});
it('retires a late response when the account changes, without continuing publication',async()=>{
 let resolve!:(v:unknown)=>void;const {rerender}=render(<HostedReviewPublication {...props}/>);const button=await screen.findByRole('button',{name:'Publish awards and open claims'});
 mocks.read.mockImplementationOnce(()=>new Promise(r=>resolve=r));fireEvent.click(button);
 mocks.session='two';mocks.read.mockResolvedValue({...base,ownership:'transfer_required'});rerender(<HostedReviewPublication {...props}/>);
 await screen.findByRole('link',{name:'Check wallet access'});
 await act(async()=>resolve({state:3,claimsOpen:true,next:null,ownership:'owned',pending:null}));
 expect(screen.queryByText('Awards published. Claims are open.')).not.toBeInTheDocument();expect(mocks.read).toHaveBeenCalledTimes(3);
});
it('failed read offers a status refresh without starting a transaction',async()=>{
 mocks.read.mockRejectedValueOnce(Error('unavailable')).mockResolvedValue(base);render(<HostedReviewPublication {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Refresh publication status'}));await screen.findByRole('button',{name:'Publish awards and open claims'});
 expect(mocks.read.mock.calls.every(c=>c[2]!==true)).toBe(true);
});

it('authorizes only the prepared transaction in the reviewer browser before submission',async()=>{
 const authorization={transactionId:'saved',request:{headers:{'privy-request-expiry':'999'}}};
 const signature={transactionId:'saved',authorizationSignature:'fictional',requestExpiry:999};
 mocks.authorize.mockResolvedValue(signature);
 mocks.read.mockResolvedValueOnce(base).mockResolvedValueOnce({...base,pending:{hash:null,confirmed:false,action:'upload'},authorization}).mockResolvedValueOnce({state:3,claimsOpen:true,next:null,ownership:'owned',pending:null});
 render(<HostedReviewPublication {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Publish awards and open claims'}));
 expect(await screen.findByText('Awards published. Claims are open.')).toBeVisible();
 expect(mocks.authorize).toHaveBeenCalledOnce();expect(mocks.read.mock.lastCall).toEqual([{id:'setup',slot:0,approvalId:'approval'},props.documentHash,true,signature]);
});
it('wallet cancellation keeps the reservation and exposes resume without claiming network confirmation',async()=>{
 mocks.read.mockResolvedValueOnce(base).mockResolvedValue({...base,pending:{hash:null,confirmed:false,action:'upload'},authorization:{transactionId:'saved'}});
 mocks.authorize.mockRejectedValue(Error('review_publication_authorization_cancelled'));
 render(<HostedReviewPublication {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Publish awards and open claims'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Wallet authorization was not completed');
 expect(screen.getByRole('button',{name:'Resume publication'})).toBeEnabled();expect(mocks.read).toHaveBeenCalledTimes(2);
});
it('an account change during authorization discards the signature and never submits it',async()=>{
 let resolve!:(v:unknown)=>void;mocks.authorize.mockImplementation(()=>new Promise(r=>resolve=r));
 mocks.read.mockResolvedValueOnce(base).mockResolvedValueOnce({...base,pending:{hash:null,confirmed:false,action:'upload'},authorization:{transactionId:'saved'}});
 const {rerender}=render(<HostedReviewPublication {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Publish awards and open claims'}));
 await act(async()=>{});expect(mocks.authorize).toHaveBeenCalledOnce();
 mocks.session='two';mocks.read.mockResolvedValue({...base,ownership:'transfer_required'});rerender(<HostedReviewPublication {...props}/>);
 await screen.findByRole('link',{name:'Check wallet access'});await act(async()=>resolve({authorizationSignature:'fictional'}));
 expect(mocks.read).toHaveBeenCalledTimes(3);expect(screen.queryByText('Awards published. Claims are open.')).not.toBeInTheDocument();
});
