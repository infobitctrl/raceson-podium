import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import HostedReviewQueue from './HostedReviewQueue';
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../data/hostedReviewSources',()=>({readHostedReviewSources:mocks.read}));
vi.mock('./HostedAllocationPreview',()=>({default:({id,revision,source}:{id:string;revision:number;source:string})=><p>Preview {id} r{revision} {source}</p>}));
const item={id:'copied',launchId:'retained',revision:2,name:'Copied campaign',budgetWei:'1000000000000000001',executionState:'awaiting_contract'};
beforeEach(()=>{mocks.read.mockReset();});
it('opens retained contract rules through reviewer authority and preserves every wei',async()=>{
 mocks.read.mockResolvedValue({items:[item]});render(<HostedReviewQueue hr={false}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Copied campaign'}));
 expect(screen.getByText('Preview copied r2 reviewer')).toBeInTheDocument();
 expect(screen.getByText('Awaiting contract')).toBeInTheDocument();expect(screen.getByTitle('1.000000000000000001 test MON')).toBeInTheDocument();
});
it('clears selected private rows during a failed refresh and offers a fresh read',async()=>{
 mocks.read.mockRejectedValue(Error('revoked'));render(<HostedReviewQueue hr={false}/>);
 await screen.findByRole('alert');expect(screen.queryByText('Copied campaign')).not.toBeInTheDocument();
 mocks.read.mockResolvedValue({items:[]});fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 await screen.findByText(/No sponsor has continued/);expect(mocks.read).toHaveBeenCalledTimes(2);
});
it('retires a late response after an account-driven unmount',async()=>{
 let resolve!:(value:unknown)=>void;mocks.read.mockReturnValue(new Promise(r=>resolve=r));
 const old=render(<HostedReviewQueue hr={false}/>);old.unmount();resolve({items:[item]});
 await waitFor(()=>expect(screen.queryByText('Copied campaign')).not.toBeInTheDocument());
});
