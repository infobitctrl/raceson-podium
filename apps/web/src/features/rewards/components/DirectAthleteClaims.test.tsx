import {useEffect} from 'react';
import {act,render,screen,fireEvent,waitFor} from '@testing-library/react';
import DirectAthleteClaims,{DirectAthleteClaim} from './DirectAthleteClaims';
const m=vi.hoisted(()=>({read:vi.fn(),send:vi.fn(),proof:vi.fn(),confirm:vi.fn(),dispose:vi.fn(),assertCurrent:vi.fn()}));
vi.mock('../data/directClaimsV5',()=>({readDirectClaimV5:m.read,sendDirectClaimV5:m.send}));
vi.mock('../data/browserWallet',()=>({prepareBrowserWalletProof:m.proof}));
vi.mock('./SponsorWallet',()=>({default:function MockSponsorWallet({onWallet}:{onWallet:(v:unknown)=>void}){useEffect(()=>()=>onWallet(null),[onWallet]);return <button onClick={()=>onWallet({wallet:{provider:{},sendDirectClaim:m.send},address:'0x'+'12'.repeat(20)})}>Create or connect my wallet</button>}}));
const id='73000000-0000-4000-8000-000000000001',hash='0x'+'ab'.repeat(32),address='0x'+'12'.repeat(20);
const award={approvalId:id,entitlementId:hash,slot:1,amountWei:'1000000000000000000',athleteProfileId:id,claims:[],protocolVersion:5 as const,directClaim:{paid:false}};
const view={schema:'podium-direct-claim-v5',approvalId:id,entitlementId:hash,chainId:10143,amountWei:award.amountWei,status:'claimable',recipient:null,deadline:'1801000000',transaction:null,receipt:null};
beforeEach(()=>{Object.values(m).forEach(fn=>fn.mockReset());sessionStorage.clear();m.read.mockResolvedValue(view);m.send.mockResolvedValue(hash);
 m.confirm.mockResolvedValue({proofId:id});m.proof.mockResolvedValue({confirm:m.confirm,dispose:m.dispose,assertCurrent:m.assertCurrent});});
it('loading an award does not create/connect a wallet, prove ownership or submit a claim',async()=>{
 render(<DirectAthleteClaim award={award} hr={false}/>);
 await screen.findByRole('button',{name:'Create or connect my wallet'});
 expect(m.read).toHaveBeenCalledWith({approvalId:id,entitlementId:hash},undefined);
 expect(m.proof).not.toHaveBeenCalled();expect(m.confirm).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
 expect(screen.queryByRole('button',{name:'Claim reward'})).not.toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'Set up your reward wallet'})).toBeVisible();
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
 expect(screen.queryByText(/Awaiting.*review/i)).not.toBeInTheDocument();
});
it('requires explicit wallet choice and consent, then sends without requesting reviewer approval',async()=>{
 render(<DirectAthleteClaim award={award} hr={false}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Create or connect my wallet'}));
 expect(m.proof).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Claim reward'})).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox'));
 m.read.mockResolvedValue({...view,transaction:{from:address}});
 fireEvent.click(screen.getByRole('button',{name:'Claim reward'}));
 await screen.findByRole('button',{name:'Check payment'});
 expect(m.read).toHaveBeenCalledWith({approvalId:id,entitlementId:hash},{action:'prepare',proofId:id});
 expect(m.send).toHaveBeenCalledOnce();expect(m.dispose).toHaveBeenCalledOnce();
 expect(screen.queryByText('Choose your wallet')).not.toBeInTheDocument();expect(screen.getAllByText('0x1212…1212').length).toBeGreaterThan(0);
 expect(m.read.mock.calls.every(call=>!call[1]||['prepare','receipt'].includes(call[1].action))).toBe(true);
 m.read.mockResolvedValue({...view,status:'paid',recipient:address,receipt:{transactionHash:hash,amountWei:award.amountWei}});
 fireEvent.click(screen.getByRole('button',{name:'Check payment'}));await screen.findByText('Reward paid');
 expect(screen.queryByText(/RacesOn covers the network fee/)).not.toBeInTheDocument();
 expect(m.send).toHaveBeenCalledOnce();
});
it('recovers a submitted hash after reopening without another signature or transaction',async()=>{
 sessionStorage.setItem(`podium:direct-claim:${id}:${hash}`,hash);
 m.read.mockResolvedValue({...view,status:'paid',recipient:address,receipt:{transactionHash:hash,amountWei:award.amountWei}});
 render(<DirectAthleteClaim award={award} hr={false}/>);await screen.findByText('Reward paid');
 expect(m.read).toHaveBeenCalledWith({approvalId:id,entitlementId:hash},{action:'receipt',hash});
 expect(m.proof).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
});
it('wallet proof failure prevents preparing or sending a claim',async()=>{
 m.confirm.mockRejectedValue(Error('rejected'));
 render(<DirectAthleteClaim award={award} hr={false}/>);fireEvent.click(await screen.findByRole('button',{name:'Create or connect my wallet'}));
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Claim reward'}));
 await screen.findByRole('alert');expect(m.send).not.toHaveBeenCalled();expect(m.read).toHaveBeenCalledTimes(1);expect(m.dispose).toHaveBeenCalledOnce();
});

it('explains sponsorship failure and permits explicit retry without asking the athlete for gas',async()=>{
 m.send.mockRejectedValueOnce(Error('claim_sponsorship_unavailable')).mockResolvedValue(hash);
 render(<DirectAthleteClaim award={award} hr={false}/>);fireEvent.click(await screen.findByRole('button',{name:'Create or connect my wallet'}));
 m.read.mockResolvedValue({...view,transaction:{from:address}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Claim reward'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('RacesOn fee sponsorship unavailable');expect(screen.getByRole('alert')).toHaveTextContent('You do not need to add test MON');
 expect(screen.queryByRole('button',{name:'Check payment'})).not.toBeInTheDocument();expect(sessionStorage.length).toBe(0);expect(screen.getByRole('checkbox')).not.toBeChecked();
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Claim reward'}));await screen.findByRole('button',{name:'Check payment'});
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('uses the single-race event name in both the award card and claim dialog',async()=>{
 const display={campaignName:'Trail sponsor',eventName:'Raslina 2026',scopeName:null};
 render(<DirectAthleteClaims awards={[{...award,slot:5,display}]} hr={false} onRefresh={async()=>{}}/>);
 expect(screen.getByRole('heading',{name:'Raslina 2026'})).toBeVisible();expect(screen.queryByText('Round 5')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Claim reward'}));
 expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Raslina 2026 · Trail sponsor');
 await screen.findByRole('button',{name:'Create or connect my wallet'});
 expect(screen.queryByText(/Check the amount, destination/)).not.toBeInTheDocument();
 expect(screen.getByText(/Demo account · Wallet proof/)).not.toBeVisible();
 fireEvent.click(screen.getByText('Claim details'));expect(screen.getByText(/Demo account · Wallet proof/)).toBeVisible();
});
it('uses saved league scope names and a neutral fallback for older award feeds',()=>{
 render(<DirectAthleteClaims awards={[{...award,display:{campaignName:'League sponsor',eventName:'Coastal league',scopeName:'Round 2 · Trogir'}},{...award,entitlementId:'0x'+'cd'.repeat(32),slot:5}]} hr={false} onRefresh={async()=>{}}/>);
 expect(screen.getByRole('heading',{name:'Coastal league'})).toBeVisible();expect(screen.getByText('League sponsor · Round 2 · Trogir')).toBeVisible();
 expect(screen.getByRole('heading',{name:'Sponsored reward'})).toBeVisible();expect(screen.queryByText('Round 5')).not.toBeInTheDocument();
});
it('allows dismissal during a read-only loading check and hides an unusable refresh action',async()=>{
 const onBusy=vi.fn();let resolve!:(value:unknown)=>void;m.read.mockImplementationOnce(()=>new Promise(r=>resolve=r));
 const rendered=render(<DirectAthleteClaim award={award} hr={false} onBusy={onBusy}/>);
 expect(await screen.findByRole('status')).toHaveTextContent('Checking your reward');expect(screen.queryByRole('button',{name:'Refresh status'})).not.toBeInTheDocument();
 expect(onBusy).toHaveBeenLastCalledWith(false);rendered.unmount();await act(async()=>resolve(view));expect(m.send).not.toHaveBeenCalled();
});
it('shows signing progress without the contradictory checking message and keeps the dialog locked',async()=>{
 let resolve!:(value:string)=>void;const onBusy=vi.fn();m.send.mockImplementationOnce(()=>new Promise(r=>resolve=r));
 render(<DirectAthleteClaim award={award} hr={false} onBusy={onBusy}/>);fireEvent.click(await screen.findByRole('button',{name:'Create or connect my wallet'}));
 m.read.mockResolvedValue({...view,transaction:{from:address}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Claim reward'}));
 await waitFor(()=>expect(m.send).toHaveBeenCalledOnce());expect(screen.getByRole('status')).toHaveTextContent('Confirm in your wallet');expect(screen.queryByText('Checking your reward…')).not.toBeInTheDocument();
 expect(onBusy).toHaveBeenLastCalledWith(true);await act(async()=>resolve(hash));expect(await screen.findByRole('button',{name:'Check payment'})).toBeEnabled();
 expect(screen.queryByText('Reward paid')).not.toBeInTheDocument();expect(onBusy).toHaveBeenLastCalledWith(false);
});

it('a failed initial award check points to refresh and never claims a payment was sent',async()=>{
 m.read.mockRejectedValueOnce(Error('reward_direct_claim_unavailable'));
 render(<DirectAthleteClaim award={award} hr={false}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Reward check unavailable');
 expect(screen.getByRole('alert')).toHaveTextContent('No claim was submitted');
 expect(screen.queryByText(/Check wallet activity/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));
 await screen.findByRole('heading',{name:'Set up your reward wallet'});
 expect(m.send).not.toHaveBeenCalled();expect(m.proof).not.toHaveBeenCalled();
});
it('an uncertain send requires a status refresh and recovers a payment without a second submission',async()=>{
 m.send.mockRejectedValueOnce(Error('transaction_unknown'));
 render(<DirectAthleteClaim award={award} hr={false}/>);fireEvent.click(await screen.findByRole('button',{name:'Create or connect my wallet'}));
 m.read.mockResolvedValue({...view,transaction:{from:address}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Claim reward'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Payment status needs checking');
 expect(screen.queryByRole('button',{name:'Claim reward'})).not.toBeInTheDocument();
 m.read.mockResolvedValue({...view,status:'paid',recipient:address,receipt:{transactionHash:hash,amountWei:award.amountWei}});
 fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));await screen.findByText('Reward paid');expect(m.send).toHaveBeenCalledOnce();
});
it('a failed receipt check preserves recovery and never exposes claim submission',async()=>{
 sessionStorage.setItem(`podium:direct-claim:${id}:${hash}`,hash);m.read.mockRejectedValueOnce(Error('unavailable'));
 render(<DirectAthleteClaim award={award} hr={false}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Your transaction is saved');
 expect(screen.getByRole('button',{name:'Check payment'})).toBeEnabled();expect(screen.queryByRole('button',{name:'Claim reward'})).not.toBeInTheDocument();
 expect(sessionStorage.getItem(`podium:direct-claim:${id}:${hash}`)).toBe(hash);
});
it('an existing registry address does not replace explicit wallet connection',async()=>{
 m.read.mockResolvedValue({...view,recipient:address});render(<DirectAthleteClaim award={award} hr={false}/>);
 await screen.findByRole('heading',{name:'Set up your reward wallet'});
 expect(screen.getByText('Choose your wallet')).toBeVisible();expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
