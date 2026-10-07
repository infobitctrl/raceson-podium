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
it('explains the provider restriction without asking for signatures or another login',async()=>{
 render(<Entry/>);expect(await screen.findByRole('status')).toHaveTextContent('Ownership handover is unavailable');
 expect(screen.queryByRole('button',{name:/Hand over|Reconnect|authorize handover/i})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Refresh wallet status'}));
 await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(2));
 expect(mocks.read.mock.calls.every(args=>args.length===1)).toBe(true);expect(mocks.sign).not.toHaveBeenCalled();expect(mocks.token).not.toHaveBeenCalled();expect(mocks.login).not.toHaveBeenCalled();
});
it('keeps acknowledgement of an already completed ownership change recoverable',async()=>{
 const owned={...initial,status:'owned',ownerSubject:initial.reviewerSubject,acknowledgementRequired:true,requestId:'33333333-3333-4333-8333-333333333333'};
 mocks.read.mockResolvedValueOnce(owned).mockResolvedValueOnce({...owned,acknowledgementRequired:false});
 render(<Entry/>);fireEvent.click(await screen.findByRole('button',{name:'Finish ownership handover'}));
 expect(await screen.findByRole('button',{name:'Return to award review'})).toBeVisible();
 expect(mocks.read.mock.calls[1][1]).toEqual({action:'acknowledge',requestId:owned.requestId,expectedFingerprint:owned.fingerprint});expect(mocks.sign).not.toHaveBeenCalled();
});
it('removes stale ownership state when refreshing fails',async()=>{
 let reject!:(error:unknown)=>void;
 mocks.read.mockResolvedValueOnce({...initial,status:'owned'}).mockImplementationOnce(()=>new Promise((_,no)=>{reject=no;}));
 render(<Entry/>);await screen.findByRole('button',{name:'Return to award review'});
 fireEvent.click(screen.getByRole('button',{name:'Refresh wallet status'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Return to award review'})).not.toBeInTheDocument());
 await act(async()=>reject(new ApiError('private error',{status:403,code:'reward_demo_reviewer_required'})));
 expect(await screen.findByRole('alert')).toHaveTextContent('switch to Reviewer');expect(mocks.sign).not.toHaveBeenCalled();
});
