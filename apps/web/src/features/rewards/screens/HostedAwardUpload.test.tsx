vi.mock('./HostedClubClaimReviews',()=>({default:({approvalId}:{approvalId:string})=><p>Club queue {approvalId}</p>}));
vi.mock('./HostedReviewPublication',()=>({default:({autoStart}:{autoStart:boolean})=> <p>{autoStart?'Continue publication automatically':'Publication controls'}</p>}));
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import HostedAwardUpload from './HostedAwardUpload';
vi.mock('./HostedClaimReviews',()=>({default:({approvalId}:{approvalId:string})=><p>Recipient queue {approvalId}</p>}));
const mocks=vi.hoisted(()=>({upload:vi.fn(),handoff:vi.fn()}));
vi.mock('../data/hostedAwardUpload',()=>({readHostedAwardUpload:mocks.upload,readHostedAwardHandoff:mocks.handoff}));
const props={id:'setup',slot:0,approvalId:'approval',contextHash:'c'.repeat(64),documentHash:'d'.repeat(64),hr:false};
const base={current:true,prepared:null,contextHash:props.contextHash,documentHash:props.documentHash};
const prepared={...base,prepared:{id:'package',packageHash:'e'.repeat(64)}};
const handoff={current:true,publication:null,publicationHash:'f'.repeat(64)};
beforeEach(()=>{mocks.upload.mockReset();mocks.handoff.mockReset();});
it('one resume prepares the saved approval and handoff, then continues publication',async()=>{
 mocks.upload.mockResolvedValueOnce(base).mockResolvedValue({...prepared,protocolVersion:5});mocks.handoff.mockResolvedValueOnce(handoff).mockResolvedValueOnce({...handoff,publication:{id:'publication'}});
 render(<HostedAwardUpload {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Resume approved publication'}));
 await screen.findByText('Continue publication automatically');
 expect(mocks.upload.mock.calls[1][1]).toEqual({requestId:expect.any(String),contextHash:props.contextHash,documentHash:props.documentHash});
 expect(mocks.handoff.mock.calls[1][1]).toEqual({action:'publication',requestId:expect.any(String),documentHash:handoff.publicationHash});
 expect(screen.queryByRole('button',{name:'Confirm results handoff'})).not.toBeInTheDocument();
 expect(screen.queryByText('Recipient queue approval')).not.toBeInTheDocument();expect(screen.queryByText('Club queue approval')).not.toBeInTheDocument();
 expect(screen.getByText('Preparation details')).toBeVisible();
 expect(JSON.stringify(mocks.upload.mock.calls[1][1])).not.toMatch(/funding|amount|wallet|source/);
});
it('an uncertain prepare hides private evidence and retries the same commitment',async()=>{
 mocks.upload.mockResolvedValueOnce(base).mockRejectedValueOnce(Error('uncertain')).mockResolvedValueOnce(prepared);mocks.handoff.mockResolvedValue({...handoff,publication:{id:'publication'}});
 render(<HostedAwardUpload {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Resume approved publication'}));
 fireEvent.click(await screen.findByRole('button',{name:'Retry same preparation'}));await screen.findByText('Continue publication automatically');
 expect(mocks.upload.mock.calls[2][1]).toEqual(mocks.upload.mock.calls[1][1]);
});
it('an uncertain publication hides prepared evidence and retries the same publication UUID',async()=>{
 mocks.upload.mockResolvedValue(prepared);mocks.handoff.mockResolvedValueOnce(handoff).mockRejectedValueOnce(Error('uncertain')).mockResolvedValueOnce({...handoff,publication:{id:'publication'}});
 render(<HostedAwardUpload {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Resume approved publication'}));
 const retry=await screen.findByRole('button',{name:'Retry same preparation'});expect(screen.queryByText('Award package prepared.')).not.toBeInTheDocument();
 fireEvent.click(retry);await screen.findByText('Continue publication automatically');
 await waitFor(()=>expect(mocks.handoff).toHaveBeenCalledTimes(3));expect(mocks.handoff.mock.calls[2][1]).toEqual(mocks.handoff.mock.calls[1][1]);
});
it('reload retires an uncertain command and rechecks current funding without another write',async()=>{
 mocks.upload.mockResolvedValueOnce(base).mockRejectedValueOnce(Error('conflict')).mockResolvedValueOnce({...base,current:false});
 render(<HostedAwardUpload {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Resume approved publication'}));
 fireEvent.click(await screen.findByRole('button',{name:'Reload preparation'}));await screen.findByText(/decision is no longer current/);
 expect(mocks.upload.mock.calls[2]).toEqual([{id:props.id,slot:0,approvalId:props.approvalId}]);expect(mocks.handoff).not.toHaveBeenCalled();
});
it('changed review digest fails closed before revealing package or publication evidence',async()=>{
 mocks.upload.mockResolvedValue({...prepared,documentHash:'a'.repeat(64)});render(<HostedAwardUpload {...props}/>);
 await screen.findByRole('alert');expect(mocks.handoff).not.toHaveBeenCalled();expect(screen.queryByText('Award package prepared.')).not.toBeInTheDocument();
});
it('changing approval retires late private reads',async()=>{
 let resolve!:(v:unknown)=>void;mocks.upload.mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValue({...base,current:false});
 const {rerender}=render(<HostedAwardUpload {...props}/>);rerender(<HostedAwardUpload {...props} approvalId="new"/>);
 await screen.findByText(/decision is no longer current/);resolve(prepared);await waitFor(()=>expect(mocks.upload).toHaveBeenCalledTimes(2));
 expect(screen.queryByText('Award package prepared.')).not.toBeInTheDocument();expect(mocks.handoff).not.toHaveBeenCalled();
});

it('a pending handoff replaces its button and cannot unlock the controller before confirmation',async()=>{
 let reject!:(reason:unknown)=>void;
 mocks.upload.mockResolvedValue(prepared);mocks.handoff.mockResolvedValueOnce(handoff).mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));
 render(<HostedAwardUpload {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Resume approved publication'}));
 await waitFor(()=>expect(screen.getByRole('group',{name:'Preparation progress'})).toHaveAttribute('aria-busy','true'));
 expect(screen.queryByRole('button',{name:'Resume approved publication'})).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:'Controller tools'})).not.toBeInTheDocument();
 await act(async()=>reject(Error('uncertain')));
 expect(screen.getByRole('group',{name:'Preparation progress'})).toHaveAttribute('aria-busy','false');
 expect(screen.getByRole('button',{name:'Retry same preparation'})).toBeEnabled();
});
it('a stale publication never unlocks the controller workspace',async()=>{
 mocks.upload.mockResolvedValue(prepared);mocks.handoff.mockResolvedValue({...handoff,current:false,publication:{id:'stale'}});
 render(<HostedAwardUpload {...props}/>);await screen.findByText(/decision is no longer current/);
 expect(screen.queryByRole('link',{name:'Controller tools'})).not.toBeInTheDocument();
 expect(screen.queryByText('Recipient queue approval')).not.toBeInTheDocument();
});

it('continues from a fresh approval without separate preparation or handoff clicks',async()=>{
 mocks.upload.mockResolvedValueOnce(base).mockResolvedValue({...prepared,protocolVersion:5});mocks.handoff.mockResolvedValueOnce(handoff).mockResolvedValue({...handoff,publication:{id:'publication'}});
 render(<HostedAwardUpload {...props} autoStart/>);
 expect(await screen.findByText('Continue publication automatically')).toBeVisible();
 expect(mocks.upload.mock.calls.filter(c=>c[1])).toHaveLength(1);expect(mocks.handoff.mock.calls.filter(c=>c[1])).toHaveLength(1);
});
it('loading existing prepared awards reads status and waits for resume',async()=>{
 mocks.upload.mockResolvedValue(prepared);mocks.handoff.mockResolvedValue({...handoff,publication:{id:'publication'}});
 render(<HostedAwardUpload {...props}/>);await screen.findByText('Publication controls');
 expect(mocks.upload.mock.calls.every(c=>!c[1])).toBe(true);expect(mocks.handoff.mock.calls.every(c=>!c[1])).toBe(true);
});
it('reload after an initial failure stays read-only until explicit resume',async()=>{
 mocks.upload.mockRejectedValueOnce(Error('unavailable')).mockResolvedValue(base);
 render(<HostedAwardUpload {...props} autoStart/>);fireEvent.click(await screen.findByRole('button',{name:'Reload preparation'}));
 await screen.findByRole('button',{name:'Resume approved publication'});
 expect(mocks.upload.mock.calls.every(c=>!c[1])).toBe(true);expect(mocks.handoff).not.toHaveBeenCalled();
});
it('a new approval scope retires automatic continuation and late reads',async()=>{
 let resolve!:(v:unknown)=>void;mocks.upload.mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValue(base);
 const {rerender}=render(<HostedAwardUpload {...props} autoStart/>);rerender(<HostedAwardUpload {...props} approvalId="new" autoStart/>);
 await screen.findByRole('button',{name:'Resume approved publication'});await act(async()=>resolve(prepared));
 expect(mocks.upload.mock.calls.every(c=>!c[1])).toBe(true);expect(mocks.handoff).not.toHaveBeenCalled();
});
