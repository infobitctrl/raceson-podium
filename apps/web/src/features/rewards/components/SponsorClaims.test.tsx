import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
import SponsorClaims,{ClaimDetail} from './SponsorClaims';
const m=vi.hoisted(()=>({awards:vi.fn(),claim:vi.fn(),destinations:vi.fn(),sign:vi.fn(),send:vi.fn()}));
vi.mock('../data/sponsorProgramme',()=>({sponsorAwards:m.awards,sponsorClaim:m.claim}));
vi.mock('../data/athleteDestinations',()=>({getOwnRewardDestinations:m.destinations}));
vi.mock('../data/sponsorProgrammeWallet',()=>({signProgrammeClaim:m.sign,sendProgrammeTransaction:m.send}));
vi.mock('./SponsorWallet',()=>({default:({onWallet}:{onWallet:(wallet:unknown)=>void})=><><button onClick={()=>onWallet({address:'0xrecipient',wallet:{id:"browser",provider:{}}})}>Connect wallet</button><button onClick={()=>onWallet({address:'0xrecipient',wallet:{id:`privy:0x${"11".repeat(20)}`,provider:{}}})}>Connect Privy test wallet</button></>}));
const id='73000000-0000-4000-8000-000000000010',hash='0x'+'a'.repeat(64);
const view={claimId:id,current:true,status:'awaiting_consent',address:'0xrecipient',claim:{amount:'1000000000000000000'},signing:{message:{amount:'1000000000000000000'}},transaction:null,receipt:null};
beforeEach(()=>{Object.values(m).forEach(x=>x.mockReset());sessionStorage.clear();});
it('opens an existing request without creating consent and supports a replacement request',async()=>{
 m.awards.mockResolvedValue([{approvalId:id,entitlementId:hash,athleteProfileId:id,slot:1,amountWei:'1',claims:[{id,prepared:true,paid:false}]}]);
 m.destinations.mockResolvedValue({items:[{requestId:id,athleteProfileId:id,chainId:31337,status:'pending_review',address:'0x'+'1'.repeat(40)}]});
 m.claim.mockResolvedValue({...view,status:'held',current:false,signing:null});render(<SponsorClaims role="recipient" hr={false} chainId={31337}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review claim'}));await screen.findByText(/reward remains reserved/);
 expect(m.claim).toHaveBeenCalledWith('recipient',id);expect(m.sign).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Close'}));
 fireEvent.click(await screen.findByRole('button',{name:/New wallet request/}));await waitFor(()=>expect(m.claim.mock.calls.some(c=>c[2]?.action==='request')).toBe(true));expect(m.sign).not.toHaveBeenCalled();
});
it('requires explicit consent and clears the checkbox when the wallet changes',async()=>{
 m.claim.mockResolvedValue(view);m.sign.mockResolvedValue('0xsig');render(<ClaimDetail id={id} role="recipient" hr={false} chainId={31337}/>);
 const button=await screen.findByRole('button',{name:'Sign reward consent'});expect(button).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Connect wallet'}));fireEvent.click(screen.getByRole('checkbox'));expect(button).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'Connect wallet'}));expect(screen.getByRole('checkbox')).not.toBeChecked();expect(button).toBeDisabled();expect(m.sign).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(button);await waitFor(()=>expect(m.claim).toHaveBeenCalledWith('recipient',id,{action:'recipient',signature:'0xsig'}));
});
it('retains a submitted payment hash and allows verification without another wallet send',async()=>{
 m.claim.mockResolvedValue({...view,status:'ready_to_pay',signing:null,transaction:{from:'0xrecipient'}});m.send.mockResolvedValue(hash);
 render(<ClaimDetail id={id} role="operator" hr={false} chainId={31337}/>);fireEvent.click(await screen.findByRole('button',{name:'Connect wallet'}));
 fireEvent.click(screen.getByRole('button',{name:'Pay exact reward'}));await screen.findByRole('button',{name:'Verify payment receipt'});
 expect(sessionStorage.getItem(`raceson:sponsor-claim:31337:${id}`)).toBe(hash);expect(screen.getByRole('button',{name:'Pay exact reward'})).toBeDisabled();
 m.claim.mockResolvedValue({...view,status:'paid',signing:null,receipt:{transactionHash:hash,blockNumber:'1'}});
 fireEvent.click(screen.getByRole('button',{name:'Verify payment receipt'}));await screen.findByText('Payment confirmed');expect(m.send).toHaveBeenCalledTimes(1);
});
it('requires explicit provider evidence for the existing Privy testnet readiness policy',async()=>{
 m.claim.mockResolvedValue({...view,status:'awaiting_review',signing:null,claim:null,sourceStamp:'a'.repeat(64),profileFingerprint:'b'.repeat(64)});
 render(<ClaimDetail id={id} role="operator" hr={false} chainId={10143}/>);
 fireEvent.change(await screen.findByRole('combobox',{name:'Wallet readiness policy'}),{target:{value:'privy'}});
 expect(screen.queryByLabelText('Wallet MFA reference')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Verify & prepare claim'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Verified date of birth'),{target:{value:'1990-01-01'}});
 for(const label of ['Identity evidence reference','Adult status reference','Privy provider evidence reference','Wallet recovery reference'])fireEvent.change(screen.getByLabelText(label),{target:{value:id}});
 fireEvent.click(screen.getByRole('button',{name:'Verify & prepare claim'}));
 await waitFor(()=>expect(m.claim).toHaveBeenCalledWith('operator',id,expect.objectContaining({action:'prepare',attestation:expect.objectContaining({schemaVersion:2,chainId:10143,walletProviderEvidenceRef:id,policy:'operator-observed-privy-testnet-no-mfa-v1'})})));
 expect(m.claim.mock.calls.at(-1)![2].attestation).not.toHaveProperty('walletMfaEvidenceRef');
});
it('sorts exact reward amounts without treating unsigned claims as paid',()=>{
 const shared={refresh:vi.fn(),destinations:[],awards:[
  {approvalId:id,athleteProfileId:null,entitlementId:'0x1',slot:1,amountWei:'9007199254740992001',claims:[{id,prepared:true,consented:true,approved:true,paid:false}]},
  {approvalId:id,athleteProfileId:null,entitlementId:'0x2',slot:2,amountWei:'9007199254740992002',claims:[{id:id+'2',prepared:true,consented:true,approved:true,paid:true}]},
 ]};
 render(<SponsorClaims role="recipient" hr={false} chainId={31337} shared={shared}/>);
 const order=()=>screen.getAllByText(/^Round [12]$/).map(x=>x.textContent);
 fireEvent.change(screen.getByRole('combobox',{name:'Sort sponsored rewards'}),{target:{value:'amount'}});
 expect(order()).toEqual(['Round 2','Round 1']);
 fireEvent.change(screen.getByRole('combobox',{name:'Sort sponsored rewards'}),{target:{value:'unclaimed'}});
 expect(order()).toEqual(['Round 1','Round 2']);
 expect(screen.getAllByText('Unclaimed').length).toBeGreaterThan(0);expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
 expect(m.claim).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
});

it('filters rewards without loading a claim or changing payment state',()=>{
 const shared={refresh:vi.fn(),destinations:[],awards:[
  {approvalId:id,athleteProfileId:null,entitlementId:'0x1',slot:1,amountWei:'1',claims:[]},
  {approvalId:id,athleteProfileId:null,entitlementId:'0x2',slot:2,amountWei:'2',claims:[{id,prepared:true,consented:true,approved:true,paid:true}]},
 ]};
 render(<SponsorClaims role="recipient" hr={false} chainId={31337} shared={shared}/>);
 fireEvent.click(screen.getByRole('button',{name:'Paid 1'}));
 expect(screen.queryByText('Round 1')).not.toBeInTheDocument();expect(screen.getByText('Round 2')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Unclaimed 1'}));
 expect(screen.getByText('Round 1')).toBeVisible();expect(screen.queryByText('Round 2')).not.toBeInTheDocument();
 expect(m.claim).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
});
it('Done closes the verified receipt dialog and refreshes the award list',async()=>{
 m.awards.mockResolvedValue([{approvalId:id,athleteProfileId:null,entitlementId:hash,slot:1,amountWei:'1',claims:[{id,paid:true,prepared:true,consented:true,approved:true}]}]);
 m.destinations.mockResolvedValue({items:[]});m.claim.mockResolvedValue({...view,status:'paid',signing:null,receipt:{transactionHash:hash,blockNumber:'1'}});
 render(<SponsorClaims role="recipient" hr={false} chainId={31337}/>);
 fireEvent.click(await screen.findByRole('button',{name:'View payment'}));
 expect(await screen.findByRole('dialog',{name:'Review your reward'})).toBeVisible();
 fireEvent.click(await screen.findByRole('button',{name:'Done'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(m.awards).toHaveBeenCalledTimes(2);expect(m.send).not.toHaveBeenCalled();
});

it('attributes a real embedded-wallet selection to Privy and clears attribution on external selection',async()=>{
 m.claim.mockResolvedValue(view);render(<ClaimDetail id={id} role="recipient" hr={false} chainId={31337}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Connect Privy test wallet'}));
 expect(screen.getByRole('button',{name:'Sign reward consent · Privy'})).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox'));
 expect(screen.getByRole('button',{name:'Sign reward consent · Privy'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'Connect wallet'}));
 expect(screen.queryByRole('button',{name:'Sign reward consent · Privy'})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Sign reward consent'})).toBeDisabled();
 expect(m.sign).not.toHaveBeenCalled();
});

it('reviewer-only details suppress wallet approval and payment even if transport supplies them',async()=>{
 sessionStorage.setItem(`raceson:sponsor-claim:10143:${id}`,hash);
 const request=vi.fn().mockResolvedValue({...view,role:'operator',operatorAddress:'0xrecipient',status:'ready_to_pay',transaction:{from:'0xrecipient'}});
 render(<ClaimDetail id={id} role="operator" chainId={10143} hr={false} reviewerOnly claimRequest={request}/>);
 await screen.findByText('Ready for payment');expect(request).toHaveBeenCalledWith(id);expect(screen.queryByText('Wallet confirmation')).not.toBeInTheDocument();expect(screen.queryByText(hash)).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Connect wallet'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Sign operator approval'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Pay exact reward'})).not.toBeInTheDocument();expect(m.claim).not.toHaveBeenCalled();
});
it('reviewer-only preparation uses its readiness transport and never a native operator command',async()=>{
 const request=vi.fn().mockResolvedValue({...view,status:'awaiting_review',signing:null,transaction:null,claim:null,sourceStamp:'a'.repeat(64),profileFingerprint:'b'.repeat(64)});
 render(<ClaimDetail id={id} role="operator" chainId={10143} hr={false} reviewerOnly claimRequest={request}/>);
 await screen.findByRole('button',{name:'Verify & prepare claim'});
 fireEvent.change(screen.getByLabelText('Verified date of birth'),{target:{value:'1990-01-01'}});
 for(const label of ['Identity evidence reference','Adult status reference','Wallet MFA reference','Wallet recovery reference'])fireEvent.change(screen.getByLabelText(label),{target:{value:id}});
 fireEvent.click(screen.getByRole('button',{name:'Verify & prepare claim'}));await waitFor(()=>expect(request).toHaveBeenCalledWith(id,expect.objectContaining({action:'prepare'})));expect(m.claim).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
});

it('receipt verification keeps the submitted hash when the server has not confirmed payment',async()=>{
 sessionStorage.setItem(`raceson:sponsor-claim:31337:${id}`,hash);
 m.claim.mockResolvedValue({...view,status:'ready_to_pay',signing:null,transaction:{from:'0xrecipient'}});
 render(<ClaimDetail id={id} role="operator" hr={false} chainId={31337}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Verify payment receipt'}));await screen.findByText(/This step could not be completed/);
 expect(sessionStorage.getItem(`raceson:sponsor-claim:31337:${id}`)).toBe(hash);expect(m.send).not.toHaveBeenCalled();expect(screen.queryByText('Claim confirmed — reward paid')).not.toBeInTheDocument();
});
it('shows actual wallet progress while consent is pending and stops it on cancellation',async()=>{
 m.claim.mockResolvedValue(view);let reject!:(e:unknown)=>void;m.sign.mockImplementation(()=>new Promise((_,fail)=>{reject=fail;}));
 render(<ClaimDetail id={id} role="recipient" hr={false} chainId={31337}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Connect wallet'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Sign reward consent'}));
 await screen.findByText('Confirm in your wallet. Nothing is sent until you approve.');expect(screen.getByRole('group',{name:'Reward action progress'})).toHaveAttribute('aria-busy','true');
 reject({code:4001});await screen.findByText(/This step could not be completed/);expect(screen.getByRole('group',{name:'Reward action progress'})).toHaveAttribute('aria-busy','false');expect(m.send).not.toHaveBeenCalled();
});
it('a refresh reconciles a verified receipt without sending a saved transaction again',async()=>{
 sessionStorage.setItem(`raceson:sponsor-claim:31337:${id}`,hash);
 m.claim.mockResolvedValue({...view,status:'paid',signing:null,receipt:{transactionHash:hash,blockNumber:'1',recipient:'0xrecipient'}});
 render(<ClaimDetail id={id} role="recipient" hr={false} chainId={31337}/>);await screen.findByText('Claim confirmed — reward paid');
 expect(sessionStorage.getItem(`raceson:sponsor-claim:31337:${id}`)).toBe(null);expect(screen.queryByRole('button',{name:'Verify payment receipt'})).not.toBeInTheDocument();expect(m.send).not.toHaveBeenCalled();
});

it('keeps the hosted reward dialog open during an explicit request and never creates consent',async()=>{
 let finish!:(value:unknown)=>void;m.claim.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const shared={awards:[{approvalId:id,athleteProfileId:id,entitlementId:hash,slot:1,amountWei:'1',claims:[]}],destinations:[{requestId:id,athleteProfileId:id,chainId:31337 as const,status:'pending_review' as const,address:'0x'+'1'.repeat(40),requestedAt:'2026-10-06T00:00:00Z',withdrawnAt:null}],destinationsComplete:true,refresh:vi.fn().mockResolvedValue(undefined)};
 render(<SponsorClaims athletePresentation role="recipient" hr={false} chainId={31337} shared={shared}/>);
 fireEvent.click(screen.getByRole('button',{name:'Review reward'}));expect(m.claim).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Request reward to this wallet'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Close review'})).toBeDisabled());
 fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(screen.getByRole('dialog',{name:'Claim your reward'})).toBeVisible();
 expect(m.claim.mock.calls[0][2].action).toBe('request');expect(m.sign).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
 finish({...view,status:'awaiting_review',signing:null});
});


it('the hosted athlete checklist resets explicit consent on a wallet change and retires readiness after failed signing',async()=>{
 const current={...view,chainId:31337,context:{verifyingContract:'0xcontract'},claim:{...view.claim,expiresAt:'10000'}};
 m.claim.mockResolvedValue(current);m.sign.mockRejectedValue({code:4001});
 render(<ClaimDetail athletePresentation id={id} role="recipient" hr={false} chainId={31337}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Connect wallet'}));
 const button=screen.getByRole('button',{name:'Sign reward consent'});expect(button).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox'));expect(button).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'Connect wallet'}));expect(screen.getByRole('checkbox')).not.toBeChecked();
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(button);
 await screen.findByText('The claim changed or could not be verified. Refresh before continuing.');expect(screen.queryByText('Verified sporting identity')).not.toBeInTheDocument();
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(m.send).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));
 await screen.findByText('Verified sporting identity');expect(screen.getByRole('checkbox')).not.toBeChecked();expect(screen.getByRole('button',{name:'Sign reward consent'})).toBeDisabled();
});
