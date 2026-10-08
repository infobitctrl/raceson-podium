import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import HostedReviewPublication from './HostedReviewPublication';
const mocks=vi.hoisted(()=>({read:vi.fn(),authorize:vi.fn(),enable:vi.fn(),connected:true,status:'ready',session:'one'}));
vi.mock('../data/reviewPublication',()=>({readReviewPublication:mocks.read}));
vi.mock('../components/RewardEmbeddedWalletContext',()=>({useRewardEmbeddedWallet:()=>({status:mocks.status,wallet:null,enable:mocks.enable,reviewerConnected:mocks.connected,...(mocks.connected?{authorizePublication:mocks.authorize}:{})})}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({session:{}})}));
vi.mock('../model/useRewardSessionEpoch',()=>({useRewardSessionEpoch:()=>mocks.session}));
const props={id:'setup',slot:0,approvalId:'approval',documentHash:'d'.repeat(64),hr:false};
const base={state:1,claimsOpen:false,next:'upload',ownership:'owned',pending:null};
beforeEach(()=>{vi.clearAllMocks();mocks.connected=true;mocks.status='ready';mocks.session='one';mocks.read.mockResolvedValue(base);});
it('reconnects the owned reviewer after a reload before allowing any publication reservation',async()=>{
 mocks.connected=false;mocks.status='off';const {rerender}=render(<HostedReviewPublication {...props}/>);
 const publish=await screen.findByRole('button',{name:'Resume approved publication'});
 expect(mocks.enable).toHaveBeenCalledOnce();expect(publish).toBeDisabled();fireEvent.click(publish);
 expect(mocks.read).toHaveBeenCalledOnce();expect(mocks.authorize).not.toHaveBeenCalled();
 mocks.status='loading';rerender(<HostedReviewPublication {...props}/>);
 expect(screen.getByRole('status')).toHaveTextContent('Connecting your existing reviewer wallet');
 mocks.status='ready';mocks.connected=true;rerender(<HostedReviewPublication {...props}/>);
 expect(await screen.findByRole('button',{name:'Resume approved publication'})).toBeEnabled();
 expect(mocks.enable).toHaveBeenCalledOnce();expect(mocks.read.mock.calls.every(c=>c[2]!==true)).toBe(true);expect(mocks.authorize).not.toHaveBeenCalled();
});
it('retries a failed wallet connection without creating a transaction',async()=>{
 mocks.connected=false;mocks.status='error';render(<HostedReviewPublication {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Reconnect reviewer wallet'}));
 expect(mocks.enable).toHaveBeenCalledOnce();expect(mocks.read).toHaveBeenCalledOnce();expect(mocks.authorize).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Resume approved publication'})).toBeDisabled();
});
it('reads without publication and requires the reviewer to explicitly start',async()=>{
 render(<HostedReviewPublication {...props}/>);const button=await screen.findByRole('button',{name:'Resume approved publication'});
 expect(mocks.read).toHaveBeenCalledExactlyOnceWith({id:'setup',slot:0,approvalId:'approval'},props.documentHash);
 mocks.read.mockResolvedValue({state:3,claimsOpen:true,next:null,ownership:'owned',pending:null});fireEvent.click(button);
 expect(await screen.findByText('Claims are open.')).toBeVisible();expect(mocks.read.mock.lastCall?.[2]).toBe(true);
});
it('explains unavailable handover without offering publication',async()=>{
 mocks.read.mockResolvedValue({...base,ownership:'transfer_required'});render(<HostedReviewPublication {...props}/>);
 expect(await screen.findByRole('link',{name:'Check wallet access'})).toHaveAttribute('href','/rewards/review');
 expect(screen.queryByRole('button',{name:'Resume approved publication'})).not.toBeInTheDocument();expect(mocks.read).toHaveBeenCalledOnce();
});
it('does not create reviewer wallet access for an unsupported handover',async()=>{
 mocks.read.mockResolvedValue({...base,ownership:'connect_required'});render(<HostedReviewPublication {...props}/>);
 await screen.findByRole('link',{name:'Check wallet access'});expect(screen.getByRole('status')).toHaveTextContent('owns the assigned wallet');expect(mocks.enable).not.toHaveBeenCalled();expect(mocks.read).toHaveBeenCalledOnce();
});
it('retires a late response when the account changes, without continuing publication',async()=>{
 let resolve!:(v:unknown)=>void;const {rerender}=render(<HostedReviewPublication {...props}/>);const button=await screen.findByRole('button',{name:'Resume approved publication'});
 mocks.read.mockImplementationOnce(()=>new Promise(r=>resolve=r));fireEvent.click(button);
 mocks.session='two';mocks.read.mockResolvedValue({...base,ownership:'transfer_required'});rerender(<HostedReviewPublication {...props}/>);
 await screen.findByRole('link',{name:'Check wallet access'});
 await act(async()=>resolve({state:3,claimsOpen:true,next:null,ownership:'owned',pending:null}));
 expect(screen.queryByText('Claims are open.')).not.toBeInTheDocument();expect(mocks.read).toHaveBeenCalledTimes(3);
});
it('failed read offers a status refresh without starting a transaction',async()=>{
 mocks.read.mockRejectedValueOnce(Error('unavailable')).mockResolvedValue(base);render(<HostedReviewPublication {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Refresh publication status'}));await screen.findByRole('button',{name:'Resume approved publication'});
 expect(mocks.read.mock.calls.every(c=>c[2]!==true)).toBe(true);
});
it('explains another campaign reservation without starting or authorizing publication',async()=>{
 mocks.read.mockRejectedValue(Error('controller_transaction_pending'));render(<HostedReviewPublication {...props}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Another campaign has an unfinished publication in this wallet.');
 expect(screen.queryByRole('button',{name:'Resume approved publication'})).not.toBeInTheDocument();
 expect(mocks.read).toHaveBeenCalledOnce();expect(mocks.authorize).not.toHaveBeenCalled();
});
it.each([
 ['review_publication_authorization_failed','The wallet provider rejected the reviewer authorization.'],
 ['review_publication_request_expired','The signing request expired.'],
 ['review_publication_request_invalid','The signing request does not match the approved publication.'],
 ['review_publication_client_authorization_failed','Browser wallet authorization failed.'],
 ['review_publication_session_required','The reviewer wallet connection is not ready.'],
 ['review_publication_session_changed','The reviewer wallet connection is not ready.'],
])('identifies %s without retrying a wallet operation',async(code,message)=>{
 mocks.read.mockRejectedValue(Error(code));render(<HostedReviewPublication {...props}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent(message);
 expect(mocks.authorize).not.toHaveBeenCalled();expect(mocks.read).toHaveBeenCalledOnce();
});

it('authorizes only the prepared transaction in the reviewer browser before submission',async()=>{
 const authorization={transactionId:'saved',request:{headers:{'privy-request-expiry':'999'}}};
 const signature={transactionId:'saved',authorizationSignature:'fictional',requestExpiry:999};
 mocks.authorize.mockResolvedValue(signature);
 mocks.read.mockResolvedValueOnce(base).mockResolvedValueOnce({...base,pending:{hash:null,confirmed:false,action:'upload'},authorization}).mockResolvedValueOnce({state:3,claimsOpen:true,next:null,ownership:'owned',pending:null});
 render(<HostedReviewPublication {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Resume approved publication'}));
 expect(await screen.findByText('Claims are open.')).toBeVisible();
 expect(mocks.authorize).toHaveBeenCalledOnce();expect(mocks.read.mock.lastCall).toEqual([{id:'setup',slot:0,approvalId:'approval'},props.documentHash,true,signature]);
});
it('wallet cancellation keeps the reservation and exposes resume without claiming network confirmation',async()=>{
 mocks.read.mockResolvedValueOnce(base).mockResolvedValue({...base,pending:{hash:null,confirmed:false,action:'upload'},authorization:{transactionId:'saved'}});
 mocks.authorize.mockRejectedValue(Error('review_publication_authorization_cancelled'));
 render(<HostedReviewPublication {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Resume approved publication'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Wallet authorization was not completed');
 expect(screen.getByRole('button',{name:'Resume approved publication'})).toBeEnabled();expect(mocks.read).toHaveBeenCalledTimes(2);
});
it('an account change during authorization discards the signature and never submits it',async()=>{
 let resolve!:(v:unknown)=>void;mocks.authorize.mockImplementation(()=>new Promise(r=>resolve=r));
 mocks.read.mockResolvedValueOnce(base).mockResolvedValueOnce({...base,pending:{hash:null,confirmed:false,action:'upload'},authorization:{transactionId:'saved'}});
 const {rerender}=render(<HostedReviewPublication {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Resume approved publication'}));
 await act(async()=>{});expect(mocks.authorize).toHaveBeenCalledOnce();
 mocks.session='two';mocks.read.mockResolvedValue({...base,ownership:'transfer_required'});rerender(<HostedReviewPublication {...props}/>);
 await screen.findByRole('link',{name:'Check wallet access'});await act(async()=>resolve({authorizationSignature:'fictional'}));
 expect(mocks.read).toHaveBeenCalledTimes(3);expect(screen.queryByText('Claims are open.')).not.toBeInTheDocument();
});

it('advances immediately after a newly confirmed receipt without the polling delay',async()=>{
 mocks.read.mockResolvedValueOnce(base)
  .mockResolvedValueOnce({...base,pending:{action:'upload',hash:'0xconfirmed',confirmed:true}})
  .mockResolvedValueOnce({state:3,claimsOpen:true,next:null,ownership:'owned',pending:null});
 render(<HostedReviewPublication {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Resume approved publication'}));
 // findBy's 1s limit is shorter than the 2.5s pending-transaction poll.
 expect(await screen.findByRole('heading',{name:'Rewards published'})).toBeVisible();
 expect(mocks.read).toHaveBeenCalledTimes(3);expect(mocks.authorize).not.toHaveBeenCalled();
});
it('keeps a transaction hash pending and paces repeated receipt observations',async()=>{
 render(<HostedReviewPublication {...props}/>);const button=await screen.findByRole('button',{name:'Resume approved publication'});
 vi.useFakeTimers();
 try{
  mocks.read.mockResolvedValue({...base,pending:{action:'activate',hash:'0xpending',confirmed:false},next:null,state:3,claimsOpen:true});
  await act(async()=>{fireEvent.click(button);});
  expect(screen.queryByRole('heading',{name:'Rewards published'})).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for network confirmation');
  expect(screen.getByText(/Allow about 30 seconds per step/)).toBeVisible();
  expect(screen.getByLabelText('Open claims: current step')).toBeVisible();
  expect(screen.getByLabelText('Publication progress')).toHaveAttribute('aria-busy','true');
  expect(mocks.read).toHaveBeenCalledTimes(2);
  await act(async()=>{await vi.advanceTimersByTimeAsync(2499);});expect(mocks.read).toHaveBeenCalledTimes(2);
  mocks.read.mockResolvedValue({state:3,claimsOpen:true,next:null,ownership:'owned',pending:{action:'activate',hash:'0xpending',confirmed:true}});
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
  expect(screen.getByRole('heading',{name:'Rewards published'})).toBeVisible();
  expect(screen.getByLabelText('Claims open: complete')).toBeVisible();
  expect(screen.queryByText(/Allow about 30 seconds per step/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Publication progress')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Rewards publishedClaims are open.');
  expect(mocks.authorize).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
it('shows wallet confirmation separately and stops animation after cancellation',async()=>{
 let reject!:(reason:unknown)=>void;
 mocks.read.mockResolvedValueOnce(base).mockResolvedValue({...base,pending:{action:'upload',hash:null,confirmed:false},authorization:{transactionId:'saved'}});
 mocks.authorize.mockImplementation(()=>new Promise((_,fail)=>{reject=fail;}));
 render(<HostedReviewPublication {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Resume approved publication'}));
 expect(await screen.findByRole('status')).toHaveTextContent('Confirm in your wallet.');
 await act(async()=>reject(Error('review_publication_authorization_cancelled')));
 expect(screen.getByLabelText('Publication progress')).toHaveAttribute('aria-busy','false');
 expect(screen.getByRole('button',{name:'Resume approved publication'})).toBeEnabled();
});
it('does not reconnect the wallet after verified completion',async()=>{
 mocks.connected=false;mocks.status='off';mocks.read.mockResolvedValue({state:3,claimsOpen:true,next:null,ownership:'owned',pending:null});
 render(<HostedReviewPublication {...props}/>);await screen.findByRole('heading',{name:'Rewards published'});
 expect(mocks.enable).not.toHaveBeenCalled();expect(mocks.authorize).not.toHaveBeenCalled();
 expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('paces a repeated confirmed receipt instead of looping against a stale provider',async()=>{
 const rendered=render(<HostedReviewPublication {...props}/>);const button=await screen.findByRole('button',{name:'Resume approved publication'});
 vi.useFakeTimers();
 try{
  mocks.read.mockResolvedValue({...base,pending:{action:'upload',hash:'0xsame',confirmed:true}});
  await act(async()=>{fireEvent.click(button);});expect(mocks.read).toHaveBeenCalledTimes(3);
  await act(async()=>{await vi.advanceTimersByTimeAsync(2499);});expect(mocks.read).toHaveBeenCalledTimes(3);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(mocks.read).toHaveBeenCalledTimes(4);
  expect(mocks.authorize).not.toHaveBeenCalled();
 }finally{rendered.unmount();vi.clearAllTimers();vi.useRealTimers();}
});

it('continues the explicit approval automatically after the existing wallet connects',async()=>{
 mocks.connected=false;mocks.status='off';const {rerender}=render(<HostedReviewPublication {...props} autoStart/>);
 await screen.findByRole('button',{name:'Resume approved publication'});expect(mocks.read).toHaveBeenCalledOnce();expect(mocks.authorize).not.toHaveBeenCalled();
 mocks.connected=true;mocks.status='ready';mocks.read.mockResolvedValueOnce(base).mockResolvedValue({state:3,claimsOpen:true,next:null,ownership:'owned',pending:null});
 rerender(<HostedReviewPublication {...props} autoStart/>);
 expect(await screen.findByText('Claims are open.')).toBeVisible();
 expect(mocks.read.mock.calls.filter(c=>c[2]===true)).toHaveLength(1);
 rerender(<HostedReviewPublication {...props} autoStart/>);expect(mocks.read).toHaveBeenCalledTimes(3);
});
it('stops automatic continuation after a cancelled wallet authorization, including status refresh',async()=>{
 mocks.read.mockResolvedValueOnce(base).mockResolvedValue({...base,pending:{hash:null,confirmed:false,action:'upload'},authorization:{transactionId:'saved'}});
 mocks.authorize.mockRejectedValue(Error('review_publication_authorization_cancelled'));
 render(<HostedReviewPublication {...props} autoStart/>);
 await screen.findByRole('alert');expect(mocks.authorize).toHaveBeenCalledOnce();
 mocks.read.mockResolvedValue(base);fireEvent.click(screen.getByRole('button',{name:'Refresh publication status'}));
 await screen.findByRole('button',{name:'Resume approved publication'});expect(mocks.authorize).toHaveBeenCalledOnce();expect(mocks.read).toHaveBeenCalledTimes(3);
});
it('does not carry an automatic approval into another signed-in session',async()=>{
 mocks.connected=false;mocks.status='loading';const {rerender}=render(<HostedReviewPublication {...props} autoStart/>);
 await screen.findByRole('button',{name:'Resume approved publication'});
 mocks.session='two';mocks.connected=true;mocks.status='ready';rerender(<HostedReviewPublication {...props} autoStart/>);
 await act(async()=>{});expect(mocks.read.mock.calls.every(c=>c[2]!==true)).toBe(true);expect(mocks.authorize).not.toHaveBeenCalled();
});
it('a failed initial read requires explicit resume even when approval requested continuation',async()=>{
 mocks.read.mockRejectedValueOnce(Error('unavailable')).mockResolvedValue(base);
 render(<HostedReviewPublication {...props} autoStart/>);
 fireEvent.click(await screen.findByRole('button',{name:'Refresh publication status'}));
 await screen.findByRole('button',{name:'Resume approved publication'});expect(mocks.read.mock.calls.every(c=>c[2]!==true)).toBe(true);
});
