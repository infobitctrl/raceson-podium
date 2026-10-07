import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({read:vi.fn(),sign:vi.fn(),token:vi.fn(),login:vi.fn(),logout:vi.fn()}));
vi.mock('@/lib/public-env',()=>({publicEnv:{rewardDemo:{chainId:10143}}}));
vi.mock('./PrivyUiProvider',()=>({default:({children}:{children:React.ReactNode})=>children}));
vi.mock('@/features/rewards/data/reviewWalletHandover',()=>({readReviewWalletHandover:mocks.read}));
vi.mock('@privy-io/react-auth',()=>({usePrivy:()=>({ready:true,authenticated:true,user:{id:'did:privy:owner'},getAccessToken:mocks.token,login:mocks.login,logout:mocks.logout}),useAuthorizationSignature:()=>({generateAuthorizationSignature:mocks.sign})}));
import {ApiError} from '@/lib/api';
import Entry from './PrivyReviewerHandover';
const initial={schema:'podium-review-wallet-handover-v1',status:'transfer_required',requestId:null,acknowledgementRequired:false,operator:'0x1111111111111111111111111111111111111111',walletId:'fixturewallet',ownerId:'ownerquorum',ownerSubject:'did:privy:owner',reviewerSubject:'did:privy:reviewer',reviewerUserId:'11111111-1111-4111-8111-111111111111',appId:'fixture-app',fingerprint:'a'.repeat(64),body:{owner:{user_id:'did:privy:reviewer'},additional_signers:[]}};
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('NEXT_PUBLIC_RACESON_REWARD_PRIVY_APP_ID','fixture-app');window.history.replaceState({},'', '/rewards/wallet-handover?setup=11111111-1111-4111-8111-111111111111&slot=0&approval=22222222-2222-4222-8222-222222222222');mocks.read.mockResolvedValue(initial);mocks.sign.mockResolvedValue({signature:'fixture-signature'});mocks.token.mockResolvedValue('fixture-owner-token');});
afterEach(()=>{vi.unstubAllEnvs();window.history.replaceState({},'','/');});
it('identifies signature failure without submitting or claiming ownership changed',async()=>{
 mocks.sign.mockRejectedValueOnce(new Error('private SDK detail'));
 render(<Entry/>);fireEvent.click(await screen.findByRole('button',{name:'Hand over rewards wallet to reviewer'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('wallet authorization could not be signed');
 expect(screen.getByRole('alert')).not.toHaveTextContent('private SDK detail');
 expect(mocks.read.mock.calls.every(args=>args.length===1)).toBe(true);expect(mocks.token).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Reconnect current wallet owner'}));expect(mocks.logout).toHaveBeenCalledOnce();
});
it('identifies the expired owner session before submission',async()=>{
 mocks.token.mockResolvedValueOnce(null);render(<Entry/>);fireEvent.click(await screen.findByRole('button',{name:'Hand over rewards wallet to reviewer'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('session ended before submission');
 expect(mocks.read.mock.calls.every(args=>args.length===1)).toBe(true);
});
it('keeps uncertain submissions recoverable by a read-only refresh',async()=>{
 mocks.read.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('transport failed')).mockResolvedValueOnce({...initial,status:'owned',ownerSubject:initial.reviewerSubject,acknowledgementRequired:true,requestId:'33333333-3333-4333-8333-333333333333'});
 render(<Entry/>);fireEvent.click(await screen.findByRole('button',{name:'Hand over rewards wallet to reviewer'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('submitted handover could not be confirmed');
 fireEvent.click(screen.getByRole('button',{name:'Refresh handover status'}));
 expect(await screen.findByRole('button',{name:'Finish ownership handover'})).toBeVisible();
 expect(mocks.sign).toHaveBeenCalledOnce();expect(mocks.read.mock.calls.filter(args=>args.length===2)).toHaveLength(1);
});
it('explains reviewer access failure and removes stale transfer controls after a refresh',async()=>{
 let reject!:(error:unknown)=>void;
 mocks.read.mockResolvedValueOnce(initial).mockImplementationOnce(()=>new Promise((_,no)=>{reject=no;}));
 render(<Entry/>);await screen.findByRole('button',{name:'Hand over rewards wallet to reviewer'});
 fireEvent.click(screen.getByRole('button',{name:'Refresh handover status'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Hand over rewards wallet to reviewer'})).not.toBeInTheDocument());
 await act(async()=>reject(new ApiError('private error',{status:403,code:'reward_demo_reviewer_required'})));
 expect(await screen.findByRole('alert')).toHaveTextContent('switch to Reviewer');
 expect(screen.queryByRole('button',{name:'Reconnect current wallet owner'})).not.toBeInTheDocument();expect(mocks.sign).not.toHaveBeenCalled();
});
it('reports server owner verification failure separately from an uncertain provider result',async()=>{
 mocks.read.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial).mockRejectedValueOnce(new ApiError('server detail',{status:409,code:'controller_auth_required'}));
 render(<Entry/>);fireEvent.click(await screen.findByRole('button',{name:'Hand over rewards wallet to reviewer'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('wallet owner’s sign-in could not be verified');
});
