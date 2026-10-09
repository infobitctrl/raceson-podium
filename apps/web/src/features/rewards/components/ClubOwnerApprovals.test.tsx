import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import ClubOwnerApprovals from './ClubOwnerApprovals';
const m=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../data/clubOwnerApprovals',()=>({clubOwnerAwards:m.read}));
vi.mock('./DirectClubClaims',()=>({DirectClubClaim:({fixedCreation})=><p>Selected treasury {fixedCreation.creationId}</p>}));
vi.mock('./RewardClaimDialog',()=>({default:({children,onClose})=><div role="dialog">{children(()=>{})}<button onClick={onClose}>Close approval</button></div>}));
const item={cursor:'one',creationId:'selected-only',clubName:'Demo Club 36',safeAddress:'0x'+'12'.repeat(20),award:{slot:1,amountWei:'1000000000000000000',directClaim:{paid:false}}};
beforeEach(()=>{m.read.mockReset();m.read.mockResolvedValue({items:[item],nextCursor:null});});
it('opens the selected treasury directly without requiring club management privileges',async()=>{
 render(<ClubOwnerApprovals hr={false}/>);fireEvent.click(await screen.findByRole('button',{name:'Review club reward'}));expect(await screen.findByText('Selected treasury selected-only')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Close approval'}));await waitFor(()=>expect(m.read).toHaveBeenCalledTimes(2));
});
it('failed refresh clears stale private awards and reports lost access',async()=>{
 const lost=vi.fn();render(<ClubOwnerApprovals hr={false} onAccessError={lost}/>);await screen.findByText('Demo Club 36');
 const error={status:401};m.read.mockRejectedValue(error);fireEvent.click(screen.getByRole('button',{name:'Refresh approvals'}));await screen.findByRole('alert');expect(screen.queryByText('Demo Club 36')).not.toBeInTheDocument();expect(lost).toHaveBeenCalledWith(error);
});
it('account remount ignores late results from the previous account',async()=>{
 let finish:(value:unknown)=>void=()=>{};m.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const first=render(<ClubOwnerApprovals hr={false}/>);first.unmount();
 m.read.mockResolvedValue({items:[],nextCursor:null});render(<ClubOwnerApprovals hr={false}/>);await screen.findByText('No club rewards awaiting your treasury approval.');
 finish({items:[item],nextCursor:null});await waitFor(()=>expect(screen.queryByText('Demo Club 36')).not.toBeInTheDocument());
});
it('filters a selected club while retaining pagination to its later awards',async()=>{
 m.read.mockResolvedValueOnce({items:[{...item,award:{...item.award,clubId:'other'}}],nextCursor:'next'}).mockResolvedValueOnce({items:[{...item,cursor:'two',clubName:'Selected club',award:{...item.award,clubId:'chosen'}}],nextCursor:null});
 render(<ClubOwnerApprovals hr={false} clubId="chosen"/>);fireEvent.click(await screen.findByRole('button',{name:'Load more approvals'}));
 expect(await screen.findByText('Selected club')).toBeVisible();expect(screen.queryByText('Demo Club 36')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Review club reward'}));expect(await screen.findByText('Selected treasury selected-only')).toBeVisible();
});
