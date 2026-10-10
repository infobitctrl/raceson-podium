import {render,screen,fireEvent,waitFor,within} from '@testing-library/react';
import {DirectClubClaim} from './DirectClubClaims';
const m=vi.hoisted(()=>({read:vi.fn(),history:vi.fn(),send:vi.fn(),sign:vi.fn(),proof:vi.fn(),confirm:vi.fn(),dispose:vi.fn(),assertCurrent:vi.fn(),actor:'',request:null as string|null,signatures:[] as {address:string;signature:string}[]}));
vi.mock('../data/clubDirectClaimsV5',()=>({readClubDirectClaimV5:m.read,sendDirectClubClaimV5:m.send,signDirectClubClaimV5:m.sign}));
vi.mock('../data/clubSafeCreation',()=>({clubSafeCreationHistory:m.history}));
vi.mock('../data/browserWallet',()=>({prepareBrowserWalletProof:m.proof}));
vi.mock('./SponsorWallet',()=>({default:({onWallet})=><button onClick={()=>onWallet({wallet:{provider:{}},address:m.actor})}>Connect my wallet</button>}));
const id='75000000-0000-4000-8000-000000000001',creationId='75000000-0000-4000-8000-000000000002',hash='0x'+'ab'.repeat(32),safe='0x'+'56'.repeat(20),owners=['0x'+'12'.repeat(20),'0x'+'34'.repeat(20),'0x'+'78'.repeat(20)];
const award={approvalId:id,clubId:id,entitlementId:hash,slot:1,amountWei:'1000000000000000000',claims:[],protocolVersion:5 as const,directClaim:{paid:false}};
const fixed={creationId,safeAddress:safe};
const view={schema:'podium-club-direct-claim-v5',creationId,clubId:id,safeAddress:safe,owners,safeNonce:'0',approvalId:id,entitlementId:hash,chainId:10143,amountWei:award.amountWei,status:'claimable',recipient:null,deadline:'1801000000',transaction:null,receipt:null};
const current=()=>({...view,transaction:m.request?{from:safe}:null,ownerApproval:{signerAddress:m.actor,requestId:m.request,expiresAt:m.request?new Date(Date.now()+480000).toISOString():null,signatures:[...m.signatures],submissions:[]}});
beforeEach(()=>{Object.values(m).forEach(fn=>{if(typeof fn==='function')fn.mockReset();});m.actor=owners[0];m.request=null;m.signatures=[];sessionStorage.clear();
 m.read.mockImplementation(async(_a,_c,command)=>{if(command?.action==='prepare')m.request=id;if(command?.action==='sign')m.signatures.push({address:m.actor,signature:command.signature});return current();});
 m.history.mockResolvedValue({items:[{requestId:creationId,clubId:id,current:true,verified:{safeAddress:safe}}],nextCursor:null});m.send.mockResolvedValue(hash);m.sign.mockResolvedValue('0x'+'11'.repeat(65));m.confirm.mockResolvedValue({proofId:id});m.proof.mockResolvedValue({confirm:m.confirm,dispose:m.dispose,assertCurrent:m.assertCurrent});});
it('reading does not create a wallet, sign, submit or prepare',async()=>{
 render(<DirectClubClaim award={award} hr={false}/>);await screen.findByRole('button',{name:'Connect my wallet'});
 expect(screen.getByRole('button',{name:'Prepare club claim'})).toBeDisabled();expect(m.proof).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled();
});
it('persists first owner consent across unmount and a separate athlete account, then requires submission consent',async()=>{
 const first=render(<DirectClubClaim award={award} hr={false} fixedCreation={fixed}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Connect my wallet'}));fireEvent.click(screen.getByRole('button',{name:'Prepare club claim'}));
 await screen.findByRole('button',{name:'Sign as treasury owner'});expect(m.sign).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Sign as treasury owner'}));
 await screen.findByText(/1\/2 owner signatures/);expect(screen.getByRole('button',{name:'Sign as treasury owner'})).toBeDisabled();first.unmount();sessionStorage.clear();m.actor=owners[1];
 render(<DirectClubClaim award={award} hr={false} fixedCreation={fixed}/>);await screen.findByText(/1\/2 owner signatures/);expect(m.history).not.toHaveBeenCalled();expect(m.proof).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Connect my wallet'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Sign as treasury owner'}));
 const submit=await screen.findByRole('button',{name:'Submit club claim'});expect(submit).toBeDisabled();expect(m.send).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(submit);
 await screen.findByRole('button',{name:'Check payment'});expect(m.sign).toHaveBeenCalledTimes(2);expect(m.send).toHaveBeenCalledOnce();
 await waitFor(()=>expect(m.read).toHaveBeenCalledWith({approvalId:id,entitlementId:hash},creationId,{action:'submitted',requestId:id,hash}));
 m.read.mockResolvedValue({...current(),status:'paid',recipient:safe,receipt:{transactionHash:hash}});fireEvent.click(screen.getByRole('button',{name:'Check payment'}));await screen.findByText('Reward paid');
});
it('recovers a submitted hash when an athlete reopens without broadcasting again',async()=>{
 sessionStorage.setItem(`podium:club-direct:${id}:${hash}`,JSON.stringify({creationId,hash}));m.read.mockResolvedValue({...current(),status:'paid',recipient:safe,receipt:{transactionHash:hash}});
 render(<DirectClubClaim award={award} hr={false} fixedCreation={fixed}/>);await screen.findByText('Reward paid');expect(m.read).toHaveBeenCalledWith({approvalId:id,entitlementId:hash},creationId,{action:'receipt',hash});expect(m.send).not.toHaveBeenCalled();
});
it('manager outside the selected owner set can inspect but cannot prepare or sign',async()=>{
 m.read.mockResolvedValue({...view,ownerApproval:{signerAddress:null,requestId:null,expiresAt:null,signatures:[],submissions:[]}});
 render(<DirectClubClaim award={award} hr={false}/>);fireEvent.click(await screen.findByRole('button',{name:'Connect my wallet'}));await screen.findByText(/You manage this club/);
 expect(screen.getByRole('button',{name:'Prepare club claim'})).toBeDisabled();expect(m.sign).not.toHaveBeenCalled();
});
it('refresh retires expired approvals and requires a new preparation',async()=>{
 m.request=id;m.signatures=[{address:owners[0],signature:'0x'+'11'.repeat(65)}];render(<DirectClubClaim award={award} hr={false} fixedCreation={fixed}/>);await screen.findByText(/1\/2 owner signatures/);
 m.request=null;m.signatures=[];fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));await screen.findByRole('button',{name:'Prepare club claim'});expect(screen.queryByText(/1\/2 owner signatures/)).not.toBeInTheDocument();
});
it('gas failure preserves both saved consents and allows explicit retry',async()=>{
 m.request=id;m.signatures=owners.slice(0,2).map(address=>({address,signature:'0x'+'11'.repeat(65)}));m.send.mockRejectedValueOnce(Error('claim_insufficient_balance')).mockResolvedValue(hash);
 render(<DirectClubClaim award={award} hr={false}/>);fireEvent.click(await screen.findByRole('button',{name:'Connect my wallet'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Submit club claim'}));
 await screen.findByText('Not enough test MON for gas');expect(screen.getByText(/2\/2 owner signatures/)).toBeVisible();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Submit club claim'}));await screen.findByRole('button',{name:'Check payment'});expect(m.sign).not.toHaveBeenCalled();
});
it('V6 registration recovery confirms registration without payment or reusing claim signatures',async()=>{
 sessionStorage.setItem(`podium:club-direct:${id}:${hash}`,JSON.stringify({creationId,hash,kind:'registrationReceipt'}));
 m.read.mockResolvedValue({...current(),protocolVersion:6,phase:'claim',recipient:safe,chainState:{registrationNonce:'1',authorizationNonce:'0',clubOwnersHash:hash,allocationDigest:hash},clubClaim:null,registrationReceipt:{transactionHash:hash,blockNumber:'1',blockHash:hash}});
 render(<DirectClubClaim award={{...award,protocolVersion:6}} hr={false} fixedCreation={fixed}/>);await screen.findByRole('button',{name:'Prepare club claim'});expect(screen.queryByText('Reward paid')).not.toBeInTheDocument();expect(m.sign).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
});

it('shows the recorded owner names with full matching addresses before preparation, including for a manager',async()=>{
 const ownerDisplay=[{address:owners[2],name:'Demo athlete 201'},{address:owners[0],name:'Demo athlete 70'},{address:owners[1],name:'Demo athlete 173'}];
 m.read.mockResolvedValue({...view,ownerDisplay,ownerApproval:{signerAddress:null,requestId:null,expiresAt:null,signatures:[],submissions:[]}});
 render(<DirectClubClaim award={award} hr={false} fixedCreation={fixed}/>);
 const list=await screen.findByRole('list',{name:'Treasury owners'}),items=within(list).getAllByRole('listitem');
 for(const [i,name] of ['Demo athlete 70','Demo athlete 173','Demo athlete 201'].entries()){
  expect(items[i]).toHaveTextContent(name);expect(within(items[i]).getByRole('link')).toHaveTextContent(owners[i]);
 }
 expect(screen.getByRole('button',{name:'Prepare club claim'})).toBeDisabled();expect(m.proof).not.toHaveBeenCalled();
 m.read.mockResolvedValue({...current(),ownerDisplay,transaction:{from:safe},ownerApproval:{signerAddress:owners[0],requestId:id,signatures:[{address:owners[1],signature:'0x'+'11'.repeat(65)}],submissions:[],expiresAt:null}});
 fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));
 await waitFor(()=>expect(items[1]).toHaveTextContent('Signed'));expect(items[0]).toHaveTextContent('Awaiting signature');expect(m.sign).not.toHaveBeenCalled();
});
it('keeps legacy owner addresses visible without inventing names',async()=>{
 render(<DirectClubClaim award={award} hr={false} fixedCreation={fixed}/>);
 const list=await screen.findByRole('list',{name:'Treasury owners'});
 expect(within(list).getAllByText('Owner name unavailable')).toHaveLength(3);
 expect(within(list).getAllByRole('link').map(link=>link.textContent)).toEqual(owners);
});
