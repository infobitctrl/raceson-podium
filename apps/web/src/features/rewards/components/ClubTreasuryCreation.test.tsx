import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import ClubTreasuryCreation from './ClubTreasuryCreation';
const m=vi.hoisted(()=>({members:vi.fn(),api:vi.fn(),history:vi.fn(),nominate:vi.fn(),proof:vi.fn(),send:vi.fn(),session:{},wallet:{},step:{confirm:vi.fn(),assertCurrent:vi.fn(),dispose:vi.fn()}}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({user:{id:'synthetic-club-account'},session:m.session})}));
vi.mock('./RewardEmbeddedWalletContext',()=>({useRewardEmbeddedWallet:()=>({wallet:m.wallet,status:'ready'})}));
vi.mock('./RewardEmbeddedWalletControls',()=>({default:()=> <p>Simulated wallet controls</p>}));
vi.mock('./RewardExplorerLink',()=>({default:({value}:{value:string})=><span>{value}</span>}));
vi.mock('../data/browserWallet',()=>({prepareBrowserWalletProof:m.proof}));
vi.mock('../data/clubSafeCreation',()=>({clubSafeCreation:m.api,clubSafeCreationHistory:m.history,clubCreationMembers:m.members}));
vi.mock('../data/clubTreasuries',()=>({submitClubTreasury:m.nominate}));
const id='7d100000-0000-4000-8000-000000000301',clubId='7d100000-0000-4000-8000-000000000201';
const address=(n:string)=>'0x'+n.repeat(40),hash='0x'+'d'.repeat(64),owners=['1','2','3'].map(address);
function view(){return{record:{requestId:id,clubId,chainId:10143,sender:address('a'),owners,saltNonce:'2',createdAt:'2026-10-06T01:00:00.000Z',current:true,transactions:[],verified:null},prepared:null};}
const clubs=[{clubId,name:'Synthetic owned club'}],props={clubs,onBack:vi.fn(),onSaved:vi.fn()};
function prepared(){return{...view(),prepared:{plan:{safe:{context:{verifyingContract:address('e')}}},gas:'120000',gasPrice:'100',maximumFee:'12000000',balance:'12000000'}};}
const memberRows=owners.map((address,i)=>({memberId:`7d100000-0000-4000-8000-00000000050${i}`,name:`Member ${i+1}`,address,status:'ready'}));
beforeEach(()=>{vi.clearAllMocks();m.members.mockResolvedValue({clubId,items:memberRows,nextCursor:null});sessionStorage.clear();m.wallet={provider:{},sendClubSafeCreation:m.send};m.history.mockResolvedValue({items:[],nextCursor:null});m.proof.mockResolvedValue(m.step);m.step.confirm.mockResolvedValue({proofId:'7d100000-0000-4000-8000-000000000401',address:address('a')});m.step.assertCurrent.mockResolvedValue(undefined);m.nominate.mockResolvedValue({});});
afterEach(cleanup);
async function resume(){const v=view();m.history.mockResolvedValue({items:[v.record],nextCursor:null});m.api.mockImplementation(async(_id,body)=>body?.action==='prepare'?prepared():v);render(<ClubTreasuryCreation {...props}/>);fireEvent.click(await screen.findByRole('button',{name:/Resume creation request/}));await screen.findByText(/Saved creation request/);}
async function checkProof(){fireEvent.click(screen.getByRole('button',{name:'Verify my wallet'}));fireEvent.click(await screen.findByRole('button',{name:'Confirm wallet · Privy'}));await screen.findByText(/Wallet control checked/);}
it('requires three explicit distinct owners and wallet proof before saving, and never creates or nominates automatically',async()=>{
 const v=view();m.api.mockResolvedValue(v);render(<ClubTreasuryCreation {...props}/>);await waitFor(()=>expect(m.history).toHaveBeenCalledTimes(1));expect(m.api).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
 for(const member of memberRows)fireEvent.click(await screen.findByLabelText(`Select ${member.name}`));fireEvent.click(screen.getByLabelText(/Use these three members/));expect(screen.getByRole('button',{name:'Save selected members'})).toBeDisabled();
 await checkProof();fireEvent.click(screen.getByRole('button',{name:'Save selected members'}));await screen.findByText(/Saved creation request/);
 expect(m.api.mock.calls[0][1]).toMatchObject({action:'request',clubId,owners,proofId:'7d100000-0000-4000-8000-000000000401'});expect(m.send).not.toHaveBeenCalled();expect(m.nominate).not.toHaveBeenCalled();
});
it('holds an ambiguous wallet response across reload and requires exact receipt verification before separate nomination',async()=>{
 await resume();await checkProof();fireEvent.click(screen.getByRole('button',{name:'Prepare treasury'}));await screen.findByText(/Your network fee/);expect(m.send).not.toHaveBeenCalled();
 const create=screen.getByRole('button',{name:'Create club treasury · Privy'});expect(create).toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));m.send.mockRejectedValueOnce(Error('unknown'));fireEvent.click(create);await screen.findByRole('alert');
 expect(m.send).toHaveBeenCalledTimes(1);expect(sessionStorage.getItem(`podium-safe-creation:synthetic-club-account:${id}`)).toBe('unknown');expect(screen.queryByRole('button',{name:'Create club treasury · Privy'})).not.toBeInTheDocument();cleanup();
 await resume();await screen.findByText(/wallet response was not confirmed/);expect(screen.queryByRole('button',{name:'Prepare treasury'})).not.toBeInTheDocument();expect(m.send).toHaveBeenCalledTimes(1);
 const verified={...view(),record:{...view().record,transactions:[{transactionHash:hash}],verified:{transactionHash:hash,safeAddress:address('e'),blockNumber:'100',blockHash:hash,initializerHash:hash}}};m.api.mockResolvedValue(verified);
 fireEvent.change(screen.getByLabelText('Creation transaction hash'),{target:{value:hash}});fireEvent.click(screen.getByRole('button',{name:'Verify finalized creation receipt'}));await screen.findByText('Club treasury ready');expect(m.nominate).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Nominate this verified treasury'}));await screen.findByText('Nomination saved · awaiting review');expect(m.nominate).toHaveBeenCalledWith(expect.objectContaining({clubId,safeAddress:address('e'),owners,idempotencyKey:`safe-creation-${id}`}));expect(m.send).toHaveBeenCalledTimes(1);
});
it('requires a new acknowledgement when the checked fee changes and never enters the wallet',async()=>{
 await resume();await checkProof();fireEvent.click(screen.getByRole('button',{name:'Prepare treasury'}));await screen.findByText(/Your network fee/);fireEvent.click(screen.getByRole('checkbox'));
 m.api.mockResolvedValue({...prepared(),prepared:{...prepared().prepared,gasPrice:'101',maximumFee:'12120000'}});fireEvent.click(screen.getByRole('button',{name:'Create club treasury · Privy'}));await screen.findByRole('alert');expect(m.send).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
});
it('allows retained history after ownership loss but exposes no deployment or nomination authority',async()=>{
 const v={...view(),record:{...view().record,current:false}};m.history.mockResolvedValue({items:[v.record],nextCursor:null});m.api.mockResolvedValue(v);render(<ClubTreasuryCreation {...props}/>);fireEvent.click(await screen.findByRole('button',{name:/Resume creation request/}));await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Verify my wallet'})).toBeDisabled();expect(m.send).not.toHaveBeenCalled();expect(m.nominate).not.toHaveBeenCalled();
});
