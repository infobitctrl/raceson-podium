vi.mock('../data/operations',()=>({reviewIssues:vi.fn(async()=>({revision:0,contextHash:'c'.repeat(64),canReport:true,issues:[]})),readSupportSettings:vi.fn(async()=>({revision:0,settings:{gasAlertWei:null,supportWallet:null,supportLimitWei:'0'},history:[],gas:null}))}));
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,it,expect,vi} from 'vitest';
import {ApiError} from '@/lib/api';
import SponsorProgramme from './SponsorProgramme';
const m=vi.hoisted(()=>({request:vi.fn(),send:vi.fn()}));
vi.mock('../data/sponsorProgramme',()=>({programmeRequest:m.request}));
vi.mock('../data/sponsorProgrammeWallet',()=>({sendProgrammeTransaction:m.send}));
vi.mock('./SponsorSourceReview',()=>({default:({draftId,slot,onReviewed}:{draftId:string;slot:number;onReviewed:()=>void})=><section aria-label={`Source ${draftId} pot ${slot}`}><button onClick={onReviewed}>Explicit source review</button></section>}));
vi.mock('./SponsorClubClaims',()=>({default:()=> <div>Club claim controls</div>}));
vi.mock('./SponsorClaims',()=>({default:()=> <div>Recipient claim controls</div>}));
vi.mock('./SponsorWallet',()=>({default:({onWallet}:{onWallet:(value:{address:string;wallet:{provider:object}})=>void})=><button onClick={()=>onWallet({address:'0xoperator',wallet:{provider:{}}})}>Connect operator</button>}));
const id='73000000-0000-4000-8000-000000000001',approval='73000000-0000-4000-8000-000000000002';
const base={schema:'raceson-sponsor-allocation-review-v4',setupId:id,slot:1,contextHash:'c'.repeat(64),documentHash:'d'.repeat(64),reasons:[],recipients:[],budgetWei:'10',proposedWei:'9',retainedWei:'1',recipientCounts:{athletes:2,clubs:0},approval:null};
const ui=(slot=1)=><MemoryRouter><SponsorProgramme setupId={id} slot={slot} chainId={31337} hr={false}/></MemoryRouter>;
beforeEach(()=>{m.request.mockReset();m.send.mockReset();sessionStorage.clear();});
it('keeps permissionless sponsorship separate from organizer result access',async()=>{
 m.request.mockRejectedValue(new ApiError('denied',{status:404}));render(ui());expect(m.request).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:/Review selected pot/}));await screen.findByText(/Sponsoring stays open to everyone/);expect(screen.queryByRole('button',{name:'Approve exact awards'})).not.toBeInTheDocument();
});
it('connects exact review, upload preparation, publication and activation controls',async()=>{
 let approved=false,prepared=false,bound=false;
 m.request.mockImplementation(async(_id,slot,step,_approval,body)=>{
  if(step==='review'){if(body)approved=true;return {...base,slot,approval:approved?{id:approval,current:true,decision:'approved'}:null};}
  if(step==='upload'){if(body)prepared=true;return {approvalId:approval,documentHash:base.documentHash,contextHash:base.contextHash,current:true,prepared:prepared?{id}:null};}
  if(body?.action==='publication')bound=true;
  return {approvalId:approval,current:true,publicationHash:'e'.repeat(64),publication:bound?{id}:null,pot:bound?{state:3,paidWei:'0'}:null,transaction:null,receipts:[]};
 });
 render(ui());fireEvent.click(screen.getByRole('button',{name:/Review selected pot/}));fireEvent.click(await screen.findByRole('button',{name:'Approve exact awards'}));
 fireEvent.click(await screen.findByRole('button',{name:'Prepare approved rewards'}));fireEvent.click(await screen.findByRole('button',{name:'Send to Rewards Control'}));
 await screen.findByText(/Claims are open/);expect(screen.getByText('Recipient claim controls')).toBeVisible();expect(m.send).not.toHaveBeenCalled();
 const reviewWrite=m.request.mock.calls.find(c=>c[4]?.decision==='approved');expect(reviewWrite[4]).toMatchObject({expectedApprovalId:null,contextHash:base.contextHash,documentHash:base.documentHash});
});
it('saves a wallet hash and verifies it without automatically sending another transaction',async()=>{
 const transaction={from:'0xoperator',action:'activate',start:2,end:2};
 m.request.mockImplementation(async(_id,_slot,step,_a,body)=>step==='review'?{...base,approval:{id:approval,decision:'approved',current:true}}:step==='upload'?{approvalId:approval,prepared:{id}}:
  {approvalId:approval,current:true,publication:{id},pot:{state:2},transaction,receipts:[]});
 m.send.mockResolvedValue('0x'+'a'.repeat(64));render(ui());fireEvent.click(screen.getByRole('button',{name:/Review selected pot/}));
 fireEvent.click(await screen.findByRole('button',{name:'Connect operator'}));fireEvent.click(screen.getByRole('button',{name:'Open claims'}));
 await screen.findByText(/Transaction sent/);expect(m.send).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Open claims'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Verify transaction'}));await waitFor(()=>expect(m.request.mock.calls.some(c=>c[4]?.action==='receipt')).toBe(true));expect(m.send).toHaveBeenCalledTimes(1);
});
it('changing pots drops prior private state and ignores the previous response',async()=>{
 let resolve!:(v:unknown)=>void;m.request.mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValue({...base,slot:2,reasons:['missing_results']});
 const page=render(ui());fireEvent.click(screen.getByRole('button',{name:/Review selected pot/}));page.rerender(ui(2));await screen.findByText(/Waiting for complete/);
 resolve(base);await waitFor(()=>expect(screen.queryByRole('button',{name:'Approve exact awards'})).not.toBeInTheDocument());
});
it.each([
 ['reward_sponsor_source_not_ready', /Depositing funds does not resolve missing result links/],
 ['reward_sponsor_funding_not_ready', /Finish the sponsor deposit/],
])('distinguishes %s from other readiness blockers',async(code,message)=>{
 m.request.mockRejectedValue(new ApiError('not ready',{status:409,code}));render(ui());
 fireEvent.click(screen.getByRole('button',{name:/Review selected pot/}));
 expect(await screen.findByRole('alert')).toHaveTextContent(message);
 expect(screen.queryByRole('button',{name:'Approve exact awards'})).not.toBeInTheDocument();
});
it('explains result holds, keeps approval disabled and explains manual club claims',async()=>{
 m.request.mockResolvedValue({...base,reasons:['ambiguous_results','incomplete_standings'],recipientCounts:{athletes:2,clubs:1}});
 render(ui());fireEvent.click(screen.getByRole('button',{name:/Review selected pot/}));
 await screen.findByText(/Duplicate athlete entries/);
 expect(screen.getByRole('status')).toHaveTextContent(/Duplicate athlete entries/);
 expect(screen.getByRole('status')).toHaveTextContent(/missing a reward classification/);
 expect(screen.getByText(/Club owners request their rewards in the club portal/)).toBeVisible();
 expect(screen.queryByRole('button',{name:'Approve exact awards'})).not.toBeInTheDocument();
});

it('opens source-only review immediately and refreshes awards after explicit source review',async()=>{
 let confirmed=false;
 m.request.mockImplementation(async()=>({...base,reasons:confirmed?[]:['source_held'],sourceReview:{draftId:id,name:'Synthetic Raslina',status:confirmed?'confirmed':'unreviewed'}}));
 render(<MemoryRouter><SponsorProgramme setupId={id} slot={1} chainId={31337} hr={false} sourceOnly/></MemoryRouter>);
 await screen.findByText('Synthetic Raslina');
 expect(screen.getByText('Official source review is required before awards can be approved.')).not.toBeVisible();
 expect(screen.queryByRole('button',{name:'Approve exact awards'})).not.toBeInTheDocument();
 expect(m.request.mock.calls.every(c=>!c[4])).toBe(true);expect(m.send).not.toHaveBeenCalled();
 confirmed=true;fireEvent.click(screen.getByRole('button',{name:'Explicit source review'}));
 await screen.findByRole('button',{name:'Approve exact awards'});
 expect(m.request.mock.calls.every(c=>!c[4])).toBe(true);expect(m.send).not.toHaveBeenCalled();
});

const resultRows={name:'Synthetic results',estimated:false,blocked:false,allocatedWei:'9',retainedWei:'1',sourceAvailable:true,scope:'race',rows:[]};
it.each([
 {name:'held results',reasons:['missing_results'],decision:null,current:false,stage:0,lifeCurrent:false,expected:'Review results'},
 {name:'unapproved results',reasons:[],decision:null,current:false,stage:0,lifeCurrent:false,expected:'Approve rewards'},
 {name:'rejected awards',reasons:[],decision:'rejected',current:true,stage:0,lifeCurrent:false,expected:'Approve rewards'},
 {name:'approved awards',reasons:[],decision:'approved',current:true,stage:0,lifeCurrent:true,expected:'Controller handoff'},
 {name:'open claims',reasons:[],decision:'approved',current:true,stage:3,lifeCurrent:true,expected:'Claims open'},
 {name:'stale lifecycle',reasons:[],decision:'approved',current:true,stage:3,lifeCurrent:false,expected:'Controller handoff'},
])('shows the verified review step for $name without submitting actions',async state=>{
 m.request.mockImplementation(async(_id,_slot,step)=>step==='review'?{...base,results:resultRows,reasons:state.reasons,approval:state.decision?{id:approval,current:state.current,decision:state.decision}:null}:step==='upload'?{approvalId:approval,prepared:{id}}:{approvalId:approval,current:state.lifeCurrent,publication:{id},pot:{state:state.stage,paidWei:'0'},transaction:null,receipts:[]});
 render(<MemoryRouter><SponsorProgramme setupId={id} slot={1} chainId={31337} hr={false} sourceOnly/></MemoryRouter>);
 const progress=await screen.findByRole('list',{name:'Reward progress'});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh'})).toBeEnabled());
 if(state.lifeCurrent&&state.decision==='approved'&&state.current){
  expect(progress.querySelector('[aria-current="step"]')).toBeNull();
  expect(screen.getByRole('heading',{name:'Handoff recorded'})).toBeVisible();
 }else{
  await waitFor(()=>expect(progress.querySelector('[aria-current="step"]')).toHaveTextContent(state.expected));
  expect(progress.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
 }
 expect(m.request.mock.calls.every(c=>!c[4])).toBe(true);expect(m.send).not.toHaveBeenCalled();
});

it('does not mark a current stage when lifecycle verification fails',async()=>{
 m.request.mockImplementation(async(_id,_slot,step)=>{
  if(step==='review')return {...base,results:resultRows,approval:{id:approval,current:true,decision:'approved'}};
  if(step==='upload')return {approvalId:approval,prepared:{id}};
  throw Error('provider unavailable');
 });
 render(<MemoryRouter><SponsorProgramme setupId={id} slot={1} chainId={31337} hr={false} sourceOnly/></MemoryRouter>);
 await screen.findByRole('alert');
 expect(screen.getByRole('list',{name:'Reward progress'}).querySelector('[aria-current="step"]')).toBeNull();
 expect(m.send).not.toHaveBeenCalled();
});


it.each(['reward_league_publication_not_ready','reward_final_allocation_source_not_ready'])('explains %s and refreshes only the selected review',async code=>{
 m.request.mockRejectedValueOnce(new ApiError('not ready',{status:409,code})).mockResolvedValue({...base,reasons:['missing_results']});
 render(<MemoryRouter><SponsorProgramme setupId={id} slot={1} chainId={31337} hr={false} sourceOnly/></MemoryRouter>);
 expect(await screen.findByRole('status',{name:'Official results are not ready yet'})).toHaveTextContent('The RacesOn results team must confirm');
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 const steps=screen.getByRole('list',{name:'What happens next'});
 expect(steps.querySelector('[aria-current="step"]')).toHaveTextContent('Confirm official results');
 expect(screen.queryByRole('button',{name:'Approve exact awards'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Connect operator'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
 await screen.findByText('Waiting for complete, official results.');
 expect(screen.queryByRole('heading',{name:'Official results are not ready yet'})).not.toBeInTheDocument();
 expect(m.request.mock.calls).toEqual([[id,1,'review'],[id,1,'review']]);
 expect(m.send).not.toHaveBeenCalled();
});

it('explains off-chain preparation, shows pending progress, and links the exact pot to controller signing',async()=>{
 let prepared=false,bound=false,finishPrepare!:()=>void,finishHandoff!:()=>void;
 m.request.mockImplementation(async(_id,_slot,step,_approval,body)=>{
  if(step==='review')return {...base,results:resultRows,approval:{id:approval,current:true,decision:'approved'}};
  if(step==='upload'){
   if(body)await new Promise<void>(resolve=>{finishPrepare=()=>{prepared=true;resolve();};});
   return {approvalId:approval,documentHash:base.documentHash,contextHash:base.contextHash,current:true,prepared:prepared?{id}:null};
  }
  if(body?.action==='publication')await new Promise<void>(resolve=>{finishHandoff=()=>{bound=true;resolve();};});
  return {approvalId:approval,current:true,publicationHash:'e'.repeat(64),publication:bound?{id}:null,pot:null,transaction:null,receipts:[]};
 });
 render(<MemoryRouter><SponsorProgramme setupId={id} slot={1} chainId={10143} hr={false} sourceOnly/></MemoryRouter>);
 const prepare=await screen.findByRole('button',{name:'Prepare approved rewards'});
 expect(screen.getByText(/This saves the approved reward package/)).toBeVisible();fireEvent.click(prepare);
 expect(await screen.findByText(/No wallet signature is needed on this page/)).toHaveAttribute('role','status');expect(prepare).toBeDisabled();
 finishPrepare();const send=await screen.findByRole('button',{name:'Send to Rewards Control'});
 expect(screen.getByText(/Rewards prepared. Send the handoff below/)).toHaveAttribute('role','status');fireEvent.click(send);
 expect(await screen.findByText(/Wallet signing follows in Rewards Control/)).toHaveAttribute('role','status');expect(send).toBeDisabled();
 finishHandoff();
 expect(await screen.findByRole('link',{name:'Check distribution status'})).toHaveAttribute('href',`/rewards/control?campaign=${id}&pot=1`);
 expect(screen.queryByText(/Rewards prepared. Send the handoff below/)).not.toBeInTheDocument();expect(m.send).not.toHaveBeenCalled();
});
it('does not suggest sending a handoff if prepared-package lifecycle loading fails',async()=>{
 m.request.mockImplementation(async(_id,_slot,step)=>{
  if(step==='review')return {...base,approval:{id:approval,current:true,decision:'approved'}};
  if(step==='upload')return {approvalId:approval,prepared:{id}};
  throw Error('unavailable');
 });
 render(<MemoryRouter><SponsorProgramme setupId={id} slot={1} chainId={10143} hr={false} sourceOnly/></MemoryRouter>);
 await screen.findByRole('alert');expect(screen.queryByText(/Rewards prepared. Send the handoff below/)).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Send to Rewards Control'})).not.toBeInTheDocument();
});

it('keeps the handoff in the workflow sidebar and uses the off-chain endpoint for the ready link',async()=>{
 let resolve!:(v:unknown)=>void;
 m.request.mockImplementation(async(_id,_slot,step)=>{
  if(step==='review')return {...base,results:resultRows,approval:{id:approval,decision:'approved',current:true}};
  if(step==='upload')return {approvalId:approval,prepared:{id}};
  expect(step).toBe('handoff');return new Promise(r=>{resolve=r;});
 });
 render(<MemoryRouter><SponsorProgramme setupId={id} slot={1} chainId={31337} hr={false} sourceOnly/></MemoryRouter>);
 const status=await screen.findByText('Checking the approved reward package and controller handoff…');expect(status).toHaveAttribute('role','status');
 resolve({approvalId:approval,current:true,publication:{id},pot:null,transaction:null,receipts:[]});
 const link=await screen.findByRole('link',{name:'Check distribution status'});
 expect(link).toHaveAttribute('href',`/rewards/control?campaign=${id}&pot=1`);
 expect(screen.getByRole('complementary',{name:'Distribution progress'})).toContainElement(link);
 expect(screen.getByRole('complementary',{name:'Distribution progress'})).toContainElement(screen.getByRole('list',{name:'Reward progress'}));
 expect(m.request.mock.calls.some(c=>c[2]==='lifecycle')).toBe(false);expect(m.send).not.toHaveBeenCalled();
});

it('does not present a stale saved publication as a ready controller handoff',async()=>{
 m.request.mockImplementation(async(_id,_slot,step)=>step==='review'?{...base,results:resultRows,approval:{id:approval,decision:'approved',current:true}}:
  step==='upload'?{approvalId:approval,prepared:{id}}:{approvalId:approval,current:false,publication:{id},pot:null,transaction:null,receipts:[]});
 render(<MemoryRouter><SponsorProgramme setupId={id} slot={1} chainId={31337} hr={false} sourceOnly/></MemoryRouter>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh'})).toBeEnabled());
 expect(screen.queryByRole('link',{name:'Check distribution status'})).not.toBeInTheDocument();
 expect(m.send).not.toHaveBeenCalled();
});
