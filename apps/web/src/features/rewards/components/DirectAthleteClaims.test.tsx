import {render,screen,fireEvent} from '@testing-library/react';
import {DirectAthleteClaim} from './DirectAthleteClaims';
const m=vi.hoisted(()=>({read:vi.fn(),send:vi.fn(),proof:vi.fn(),confirm:vi.fn(),dispose:vi.fn(),assertCurrent:vi.fn()}));
vi.mock('../data/directClaimsV5',()=>({readDirectClaimV5:m.read,sendDirectClaimV5:m.send}));
vi.mock('../data/browserWallet',()=>({prepareBrowserWalletProof:m.proof}));
vi.mock('./SponsorWallet',()=>({default:({onWallet}:{onWallet:(v:unknown)=>void})=><button onClick={()=>onWallet({wallet:{provider:{}},address:'0x'+'12'.repeat(20)})}>Create or connect my wallet</button>}));
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
 expect(screen.getByRole('button',{name:'Claim reward'})).toBeDisabled();
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
 expect(m.read.mock.calls.every(call=>!call[1]||['prepare','receipt'].includes(call[1].action))).toBe(true);
 m.read.mockResolvedValue({...view,status:'paid',recipient:address,receipt:{transactionHash:hash,amountWei:award.amountWei}});
 fireEvent.click(screen.getByRole('button',{name:'Check payment'}));await screen.findByText('Reward paid');
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
