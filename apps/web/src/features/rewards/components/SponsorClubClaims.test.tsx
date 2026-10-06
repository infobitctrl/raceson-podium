vi.mock('../data/hostedClubClaims',()=>({getHostedClubAwards:vi.fn()}));
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import SponsorClubClaims,{SponsorClubClaimDetail} from './SponsorClubClaims';
const m=vi.hoisted(()=>({claim:vi.fn(),awards:vi.fn(),history:vi.fn(),sign:vi.fn(),combine:vi.fn(),send:vi.fn(),operator:vi.fn()}));
vi.mock('../data/sponsorClubClaims',()=>({sponsorClubClaim:m.claim,sponsorClubAwards:m.awards}));
vi.mock('../data/clubTreasuries',()=>({getClubTreasuryHistory:m.history}));
vi.mock('../data/sponsorClubWallet',()=>({signSponsorClubConsent:m.sign,combineSponsorClubSignatures:m.combine}));
vi.mock('../data/sponsorProgrammeWallet',()=>({signProgrammeClaim:m.operator,sendProgrammeTransaction:m.send}));
vi.mock('./SponsorWallet',()=>({default:({onWallet}:any)=><div>{['11','22','33'].map(n=><button key={n} onClick={()=>onWallet({address:'0x'+n.repeat(20),wallet:{provider:{}}})}>Owner {n}</button>)}</div>}));
afterEach(()=>{cleanup();vi.clearAllMocks();sessionStorage.clear();});
const id='73000000-0000-4000-8000-000000000001',address='0x'+'44'.repeat(20);
function view(){return{schema:'raceson-sponsor-club-claim-view-v4',claimId:id,approvalId:id,role:'recipient',chainId:31337,current:true,status:'awaiting_consent',address,owners:['11','22','33'].map(n=>'0x'+n.repeat(20)),operatorAddress:'0x'+'55'.repeat(20),claim:{amount:'1000000000000000000'},context:{},signing:{message:{message:'0x1234'}},transaction:null,receipt:null};}
it('keeps the award reserved without a treasury nomination and never requests or signs automatically',async()=>{
 m.awards.mockResolvedValue([{approvalId:id,slot:1,entitlementId:'0x'+'66'.repeat(32),amountWei:'1000000000000000000',clubId:id,claims:[]}]);m.history.mockResolvedValue({items:[],nextCursor:null});
 render(<SponsorClubClaims role="recipient" hr={false} chainId={31337}/>);
 await screen.findByText('Nominate your club’s 2-of-3 Safe in Club and treasury. Your award stays reserved.');expect(m.claim).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
});
it('requires separate owner acknowledgements and explicit submit after two signatures; never pays from recipient UI',async()=>{
 const v=view();m.claim.mockImplementation(async(_role,_id,body)=>body?{...v,status:'awaiting_operator',signing:null}:v);m.sign.mockResolvedValue('0x1234');m.combine.mockResolvedValue('0x123456');
 render(<SponsorClubClaimDetail id={id} role="recipient" hr={false} chainId={31337}/>);
 await screen.findByText('Waiting for two Safe owner signatures');const sign=screen.getByRole('button',{name:'Sign as Safe owner'});
 expect(sign).toBeDisabled();expect(screen.getByRole('button',{name:'Submit club consent'})).toBeDisabled();
 fireEvent.click(screen.getByText('Owner 11'));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(sign);
 await screen.findByText(/1\/2 owner signatures collected/);expect(m.sign).toHaveBeenCalledTimes(1);expect(sign).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox'));expect(sign).toBeDisabled();
 fireEvent.click(screen.getByText('Owner 22'));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(sign);
 await screen.findByText(/2\/2 owner signatures collected/);expect(m.claim.mock.calls.some(c=>c[2]?.action==='recipient')).toBe(false);expect(m.send).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Submit club consent'}));await screen.findByText('Club consent recorded · waiting for controller');
 expect(m.claim).toHaveBeenCalledWith('recipient',id,{action:'recipient',signature:'0x123456'});expect(m.send).not.toHaveBeenCalled();expect(m.operator).not.toHaveBeenCalled();
});
it('shows the finalized club payment and offers no consent or second payment',async()=>{
 m.claim.mockResolvedValue({...view(),status:'paid',signing:null,receipt:{transactionHash:'0x'+'77'.repeat(32),blockNumber:'100'}});
 render(<SponsorClubClaimDetail id={id} role="recipient" hr={false} chainId={31337}/>);
 await screen.findByText('Payment confirmed');expect(screen.getByText(/Confirmed transaction/)).toHaveTextContent('block 100');
 expect(screen.queryByRole('button',{name:'Sign as Safe owner'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Confirm club reward payment'})).not.toBeInTheDocument();
});

it('discards stale club authority and collected signatures after a failed refresh',async()=>{
 const v=view();m.claim.mockResolvedValue(v);m.sign.mockResolvedValue('0x1234');
 render(<SponsorClubClaimDetail id={id} role="recipient" hr={false} chainId={31337}/>);
 fireEvent.click(await screen.findByText('Owner 11'));fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.click(screen.getByRole('button',{name:'Sign as Safe owner'}));
 await screen.findByText(/1\/2 owner signatures collected/);
 m.claim.mockRejectedValueOnce(new Error('unavailable'));
 fireEvent.click(screen.getByRole('button',{name:'Refresh claim'}));
 await screen.findByRole('alert');
 expect(screen.queryByRole('button',{name:'Sign as Safe owner'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Submit club consent'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Refresh claim'}));
 await screen.findByText(/0\/2 owner signatures collected/);
 expect(screen.getByRole('checkbox')).not.toBeChecked();
 expect(screen.getByRole('button',{name:'Submit club consent'})).toBeDisabled();
 await waitFor(()=>expect(m.sign).toHaveBeenCalledTimes(1));expect(m.send).not.toHaveBeenCalled();
});

it('ordinary treasury review uses only the copied review transport and cannot expose wallet signing or payment controls',async()=>{
 const v={...view(),role:'operator',status:'awaiting_operator',signing:{message:{amount:'1'}},transaction:{to:address}};
 const review=vi.fn().mockResolvedValue(v);
 render(<SponsorClubClaimDetail id={id} role="operator" hr={false} chainId={31337} reviewerOnly claimRequest={review}/>);
 await screen.findByText('Club consent recorded · waiting for controller');
 expect(review).toHaveBeenCalledWith(id,undefined);expect(m.claim).not.toHaveBeenCalled();
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(screen.queryByText('Owner 11')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Sign controller approval'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Confirm club reward payment'})).not.toBeInTheDocument();expect(m.send).not.toHaveBeenCalled();
});
