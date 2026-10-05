import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import HostedAwardUpload from './HostedAwardUpload';
const mocks=vi.hoisted(()=>({upload:vi.fn(),handoff:vi.fn()}));
vi.mock('../data/hostedAwardUpload',()=>({readHostedAwardUpload:mocks.upload,readHostedAwardHandoff:mocks.handoff}));
const props={id:'setup',slot:0,approvalId:'approval',contextHash:'c'.repeat(64),documentHash:'d'.repeat(64),hr:false};
const base={current:true,prepared:null,contextHash:props.contextHash,documentHash:props.documentHash};
const prepared={...base,prepared:{id:'package',packageHash:'e'.repeat(64)}};
const handoff={current:true,publication:null,publicationHash:'f'.repeat(64)};
beforeEach(()=>{mocks.upload.mockReset();mocks.handoff.mockReset();});
it('requires explicit funding preparation and results handoff before linking to the controller',async()=>{
 mocks.upload.mockResolvedValueOnce(base).mockResolvedValue(prepared);mocks.handoff.mockResolvedValueOnce(handoff).mockResolvedValueOnce({...handoff,publication:{id:'publication'}});
 render(<HostedAwardUpload {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Verify funding and prepare package'}));
 await screen.findByText('Package prepared for the controller.');expect(mocks.handoff).toHaveBeenCalledTimes(1);
 expect(mocks.upload.mock.calls[1][1]).toEqual({requestId:expect.any(String),contextHash:props.contextHash,documentHash:props.documentHash});
 expect(screen.queryByRole('link',{name:'Open controller workspace'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Confirm results handoff'}));expect(await screen.findByRole('link',{name:'Open controller workspace'})).toHaveAttribute('href','/rewards/control?campaign=setup&pot=0');
 expect(mocks.handoff.mock.calls[1][1]).toEqual({action:'publication',requestId:expect.any(String),documentHash:handoff.publicationHash});
 expect(JSON.stringify(mocks.upload.mock.calls[1][1])).not.toMatch(/funding|amount|wallet|source/);
});
it('an uncertain prepare hides private evidence and retries the same commitment',async()=>{
 mocks.upload.mockResolvedValueOnce(base).mockRejectedValueOnce(Error('uncertain')).mockResolvedValueOnce(prepared);mocks.handoff.mockResolvedValue(handoff);
 render(<HostedAwardUpload {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Verify funding and prepare package'}));
 fireEvent.click(await screen.findByRole('button',{name:'Retry same preparation'}));await screen.findByText('Package prepared for the controller.');
 expect(mocks.upload.mock.calls[2][1]).toEqual(mocks.upload.mock.calls[1][1]);
});
it('an uncertain publication hides prepared evidence and retries the same publication UUID',async()=>{
 mocks.upload.mockResolvedValue(prepared);mocks.handoff.mockResolvedValueOnce(handoff).mockRejectedValueOnce(Error('uncertain')).mockResolvedValueOnce({...handoff,publication:{id:'publication'}});
 render(<HostedAwardUpload {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Confirm results handoff'}));
 const retry=await screen.findByRole('button',{name:'Retry same preparation'});expect(screen.queryByText('Package prepared for the controller.')).not.toBeInTheDocument();
 fireEvent.click(retry);await screen.findByRole('link',{name:'Open controller workspace'});
 await waitFor(()=>expect(mocks.handoff).toHaveBeenCalledTimes(3));expect(mocks.handoff.mock.calls[2][1]).toEqual(mocks.handoff.mock.calls[1][1]);
});
it('reload retires an uncertain command and rechecks current funding without another write',async()=>{
 mocks.upload.mockResolvedValueOnce(base).mockRejectedValueOnce(Error('conflict')).mockResolvedValueOnce({...base,current:false});
 render(<HostedAwardUpload {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Verify funding and prepare package'}));
 fireEvent.click(await screen.findByRole('button',{name:'Reload preparation'}));await screen.findByText(/decision is no longer current/);
 expect(mocks.upload.mock.calls[2]).toEqual([{id:props.id,slot:0,approvalId:props.approvalId}]);expect(mocks.handoff).not.toHaveBeenCalled();
});
it('changed review digest fails closed before revealing package or publication evidence',async()=>{
 mocks.upload.mockResolvedValue({...prepared,documentHash:'a'.repeat(64)});render(<HostedAwardUpload {...props}/>);
 await screen.findByRole('alert');expect(mocks.handoff).not.toHaveBeenCalled();expect(screen.queryByText('Package prepared for the controller.')).not.toBeInTheDocument();
});
it('changing approval retires late private reads',async()=>{
 let resolve!:(v:unknown)=>void;mocks.upload.mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValue({...base,current:false});
 const {rerender}=render(<HostedAwardUpload {...props}/>);rerender(<HostedAwardUpload {...props} approvalId="new"/>);
 await screen.findByText(/decision is no longer current/);resolve(prepared);await waitFor(()=>expect(mocks.upload).toHaveBeenCalledTimes(2));
 expect(screen.queryByText('Package prepared for the controller.')).not.toBeInTheDocument();expect(mocks.handoff).not.toHaveBeenCalled();
});
