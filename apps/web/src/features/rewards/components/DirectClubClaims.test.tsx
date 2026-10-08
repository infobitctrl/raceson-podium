import {render,screen,fireEvent} from '@testing-library/react';
import {DirectClubClaim} from './DirectClubClaims';
const m=vi.hoisted(()=>({read:vi.fn(),history:vi.fn(),send:vi.fn(),sign:vi.fn(),proof:vi.fn(),confirm:vi.fn(),dispose:vi.fn(),assertCurrent:vi.fn()}));
vi.mock('../data/clubDirectClaimsV5',()=>({readClubDirectClaimV5:m.read,sendDirectClubClaimV5:m.send,signDirectClubClaimV5:m.sign}));
vi.mock('../data/clubSafeCreation',()=>({clubSafeCreationHistory:m.history}));
vi.mock('../data/browserWallet',()=>({prepareBrowserWalletProof:m.proof}));
vi.mock('./SponsorWallet',()=>({default:({onWallet})=><><button onClick={()=>onWallet({wallet:{provider:{}},address:'0x'+'12'.repeat(20)})}>Connect owner one</button><button onClick={()=>onWallet({wallet:{provider:{}},address:'0x'+'34'.repeat(20)})}>Connect owner two</button></>}));
const id='75000000-0000-4000-8000-000000000001',creationId='75000000-0000-4000-8000-000000000002',hash='0x'+'ab'.repeat(32),safe='0x'+'56'.repeat(20),owners=['0x'+'12'.repeat(20),'0x'+'34'.repeat(20),'0x'+'78'.repeat(20)];
const award={approvalId:id,clubId:id,entitlementId:hash,slot:1,amountWei:'1000000000000000000',claims:[],protocolVersion:5 as const,directClaim:{paid:false}};
const view={schema:'podium-club-direct-claim-v5',creationId,clubId:id,safeAddress:safe,owners,safeNonce:'0',approvalId:id,entitlementId:hash,chainId:10143,amountWei:award.amountWei,status:'claimable',recipient:null,deadline:'1801000000',transaction:null,receipt:null};
beforeEach(()=>{Object.values(m).forEach(fn=>fn.mockReset());sessionStorage.clear();m.read.mockImplementation(async(_a,_c,command)=>command?.action==='prepare'?{...view,transaction:{from:safe}}:view);m.history.mockResolvedValue({items:[{requestId:creationId,clubId:id,current:true,verified:{safeAddress:safe}}],nextCursor:null});m.send.mockResolvedValue(hash);m.sign.mockResolvedValue('0x'+'11'.repeat(65));m.confirm.mockResolvedValue({proofId:id});m.proof.mockResolvedValue({confirm:m.confirm,dispose:m.dispose,assertCurrent:m.assertCurrent});});
it('reading club rewards does not create a wallet, collect consent or request reviewer approval',async()=>{
 render(<DirectClubClaim award={award} hr={false}/>);await screen.findByRole('button',{name:'Connect owner one'});
 expect(screen.getByRole('button',{name:'Prepare club claim'})).toBeDisabled();expect(m.proof).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled();
});
it('requires explicit preparation, two distinct connected owners and separate submission consent',async()=>{
 render(<DirectClubClaim award={award} hr={false}/>);fireEvent.click(await screen.findByRole('button',{name:'Connect owner one'}));fireEvent.click(screen.getByRole('button',{name:'Prepare club claim'}));
 await screen.findByRole('button',{name:'Sign as treasury owner'});expect(m.sign).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Sign as treasury owner'}));
 await screen.findByText(/1\/2 owner signatures/);expect(screen.getByRole('button',{name:'Sign as treasury owner'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Connect owner two'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Sign as treasury owner'}));
 const submit=await screen.findByRole('button',{name:'Submit club claim'});expect(submit).toBeDisabled();expect(m.send).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(submit);
 await screen.findByRole('button',{name:'Check payment'});expect(m.sign).toHaveBeenCalledTimes(2);expect(m.send).toHaveBeenCalledOnce();
 m.read.mockResolvedValue({...view,status:'paid',recipient:safe,receipt:{transactionHash:hash}});fireEvent.click(screen.getByRole('button',{name:'Check payment'}));await screen.findByText('Reward paid');expect(m.send).toHaveBeenCalledOnce();
});
it('recovers a submitted hash after reopening without new consent or broadcast',async()=>{
 sessionStorage.setItem(`podium:club-direct:${id}:${hash}`,JSON.stringify({creationId,hash}));m.read.mockResolvedValue({...view,status:'paid',recipient:safe,receipt:{transactionHash:hash}});
 render(<DirectClubClaim award={award} hr={false}/>);await screen.findByText('Reward paid');expect(m.read).toHaveBeenCalledWith({approvalId:id,entitlementId:hash},creationId,{action:'receipt',hash});expect(m.sign).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
});

it('names the submitting owner wallet when gas is insufficient and preserves both consents',async()=>{
 m.send.mockRejectedValueOnce(Error('claim_insufficient_balance')).mockResolvedValue(hash);
 render(<DirectClubClaim award={award} hr={false}/>);fireEvent.click(await screen.findByRole('button',{name:'Connect owner one'}));fireEvent.click(screen.getByRole('button',{name:'Prepare club claim'}));
 await screen.findByRole('button',{name:'Sign as treasury owner'});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Sign as treasury owner'}));
 await screen.findByText(/1\/2 owner signatures/);fireEvent.click(screen.getByRole('button',{name:'Connect owner two'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Sign as treasury owner'}));
 await screen.findByRole('button',{name:'Submit club claim'});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Submit club claim'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('connected owner’s wallet');expect(sessionStorage.length).toBe(0);expect(screen.getByText(/2\/2 owner signatures/)).toBeVisible();
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Submit club claim'}));await screen.findByRole('button',{name:'Check payment'});expect(m.sign).toHaveBeenCalledTimes(2);
});
it('V6 registration recovery confirms registration without payment and requires new claim signatures',async()=>{
 const v6={...view,protocolVersion:6,phase:'claim',recipient:safe,chainState:{registrationNonce:'1',authorizationNonce:'0',clubOwnersHash:hash,allocationDigest:hash},clubClaim:null,registrationReceipt:{transactionHash:hash,blockNumber:'1',blockHash:hash}};
 sessionStorage.setItem(`podium:club-direct:${id}:${hash}`,JSON.stringify({creationId,hash,kind:'registrationReceipt'}));
 m.read.mockResolvedValue(v6);
 render(<DirectClubClaim award={{...award,protocolVersion:6}} hr={false}/>);
 await screen.findByRole('button',{name:'Prepare club claim'});expect(screen.queryByText('Reward paid')).not.toBeInTheDocument();
 expect(m.read).toHaveBeenCalledWith({approvalId:id,entitlementId:hash},creationId,{action:'registrationReceipt',hash});
 expect(m.sign).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
});
it('V6 first-time registration is explicit and does not describe it as an award payment',async()=>{
 const registered={...view,protocolVersion:6,phase:'register',chainState:{registrationNonce:'0',authorizationNonce:'0',clubOwnersHash:hash,allocationDigest:hash},clubClaim:null,registrationReceipt:null};
 m.read.mockImplementation(async(_a,_c,command)=>({...registered,transaction:command?.action==='prepare'?{from:safe}:null}));
 render(<DirectClubClaim award={{...award,protocolVersion:6}} hr={false}/>);fireEvent.click(await screen.findByRole('button',{name:'Connect owner one'}));
 fireEvent.click(screen.getByRole('button',{name:'Prepare treasury registration'}));await screen.findByRole('checkbox',{name:/registering this treasury/});
 expect(screen.getByText(/Registration does not pay the award/)).toBeVisible();expect(m.send).not.toHaveBeenCalled();
});
