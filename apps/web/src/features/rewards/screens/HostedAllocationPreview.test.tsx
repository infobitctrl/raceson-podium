import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import HostedAllocationPreview from './HostedAllocationPreview';
const api=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@/lib/api',()=>({apiRequest:api.request,ApiError:class extends Error {status=503;}}));
const id='00000000-0000-4000-8000-000000000001';
const group={nodeId:'group',name:'Long Female',slot:0,type:'athlete_standings',beneficiaryKind:'athlete',budgetWei:'101',proposedWei:'101',heldWei:'0',unusedWei:'0',unallocatedWei:'0',hold:null,awards:[{beneficiaryId:'athlete',name:'Races Mon1',place:1,value:'100',amountWei:'101'}]};
const result={version:'podium-copy-allocation-v1',state:'unapproved',payableWei:'0',setupId:id,revision:2,sourceHash:'a'.repeat(64),configurationHash:'b'.repeat(64),budgetWei:'101',proposedWei:'101',heldWei:'0',unallocatedWei:'0',unusedWei:'0',groups:[group],reviewNote:'Round 3 uses Long and Races Club29.',sourceCounts:{results:471,finished:444,countedCombinedFinishes:443,unclassifiedFinishes:51}};
beforeEach(()=>{api.request.mockReset();});
it('results-team preview uses its role-checked reader and cannot download through sponsor authority',async()=>{
 api.request.mockResolvedValue(result);render(<HostedAllocationPreview id={id} revision={2} source="reviewer"/>);
 fireEvent.click(screen.getByRole('button',{name:'Preview allocations'}));await screen.findByText('Races Mon1');
 expect(api.request).toHaveBeenCalledWith({path:`/v1/rewards/demo-copy/reviews/${id}`,cache:'no-store'});
 expect(screen.queryByRole('button',{name:'Prepare review record'})).not.toBeInTheDocument();
 expect(screen.getByText(/Not approved/)).toBeInTheDocument();
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('requests the exact saved revision and renders every wei without money actions',async()=>{
 api.request.mockResolvedValue(result);render(<HostedAllocationPreview id={id} revision={2}/>);
 fireEvent.click(screen.getByRole('button',{name:'Preview allocations'}));await screen.findByText('Races Mon1');
 expect(api.request).toHaveBeenCalledWith({path:`/v1/rewards/demo-copy/sponsor-setups/${id}/allocation/2`,cache:'no-store'});
 expect(screen.getAllByText('0.000000000000000101').length).toBeGreaterThan(0);
 expect(screen.getByText(/Not approved/)).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/claim|pay|fund/i})).not.toBeInTheDocument();
});
it.each([{revision:3},{payableWei:'1'},{proposedWei:'102'}])('rejects a mismatched or nonconserving result %j',async change=>{
 api.request.mockResolvedValue({...result,...change});render(<HostedAllocationPreview id={id} revision={2}/>);
 fireEvent.click(screen.getByRole('button',{name:'Preview allocations'}));await screen.findByRole('alert');
 expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
it('ignores a calculation that resolves after the saved view is unmounted',async()=>{
 let finish!:(value:unknown)=>void;api.request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<HostedAllocationPreview id={id} revision={2}/>);fireEvent.click(screen.getByRole('button',{name:'Preview allocations'}));
 view.unmount();finish(result);await waitFor(()=>expect(screen.queryByText('Races Mon1')).not.toBeInTheDocument());
});
it('explains a held club metric and does not display proposed recipients',async()=>{
 api.request.mockResolvedValue({...result,proposedWei:'0',heldWei:'101',groups:[{...group,type:'club_metres',proposedWei:'0',heldWei:'101',hold:'unattributed_club',awards:[]}]});
 render(<HostedAllocationPreview id={id} revision={2}/>);fireEvent.click(screen.getByRole('button',{name:'Preview allocations'}));
 expect(await screen.findByRole('status')).toHaveTextContent('Some finishes have no confirmed club attribution');
 expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
const handoff=()=>({version:'podium-copy-review-handoff-v1',documentHash:'c'.repeat(64),document:{version:'podium-copy-review-document-v1',chainId:10143,state:'unapproved',payableWei:'0',setup:{id,revision:2},allocation:result}});
it('prepares an explicit save link after a fresh authenticated request and revokes it on recalculation',async()=>{
 const create=vi.fn(()=> 'blob:review'),revoke=vi.fn();vi.stubGlobal('URL',Object.assign(class {},{createObjectURL:create,revokeObjectURL:revoke}));
 api.request.mockResolvedValueOnce(result).mockResolvedValueOnce(handoff());render(<HostedAllocationPreview id={id} revision={2}/>);
 fireEvent.click(screen.getByRole('button',{name:'Preview allocations'}));fireEvent.click(await screen.findByRole('button',{name:'Prepare review record'}));
 expect(await screen.findByRole('status')).toHaveTextContent('c'.repeat(64));expect(create.mock.calls[0]![0]).toBeInstanceOf(Blob);
 expect(screen.getByRole('link',{name:'Save review JSON'})).toHaveAttribute('download',`podium-review-${id}-r2-cccccccccccc.json`);
 expect(screen.getByRole('link',{name:'Save review JSON'})).toHaveAttribute('href','blob:review');
 expect(api.request).toHaveBeenLastCalledWith({path:`/v1/rewards/demo-copy/sponsor-setups/${id}/allocation/2/handoff`,cache:'no-store'});
 api.request.mockResolvedValueOnce(result);fireEvent.click(screen.getByRole('button',{name:'Recalculate saved rules'}));await screen.findByText('Races Mon1');
 expect(revoke).toHaveBeenCalledWith('blob:review');expect(screen.queryByRole('link',{name:'Save review JSON'})).not.toBeInTheDocument();
});
it('does not download a stale response or one completing after the view is removed',async()=>{
 const create=vi.fn();vi.stubGlobal('URL',Object.assign(class {},{createObjectURL:create,revokeObjectURL:vi.fn()}));
 const wrong=handoff();wrong.document.setup.revision=3;
 api.request.mockResolvedValueOnce(result).mockResolvedValueOnce(wrong);const view=render(<HostedAllocationPreview id={id} revision={2}/>);
 fireEvent.click(screen.getByRole('button',{name:'Preview allocations'}));fireEvent.click(await screen.findByRole('button',{name:'Prepare review record'}));await screen.findByRole('alert');expect(create).not.toHaveBeenCalled();
 let finish!:(value:unknown)=>void;api.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 fireEvent.click(screen.getByRole('button',{name:'Prepare review record'}));view.unmount();finish(handoff());await waitFor(()=>expect(create).not.toHaveBeenCalled());
});
