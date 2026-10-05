import {StrictMode} from 'react';
import {act,fireEvent,render,screen,within} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import {I18nProvider} from '@/shared/i18n/I18nProvider';
import {ApiError} from '@/lib/api';
import {createRewardSetup,decodeRewardSetup,type SavedRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import {legacyConversionFixture} from '../../../../../../apps/api/test/fixtures/guided-conversion.mjs';
import RewardSetup from './RewardSetup';
const mocks=vi.hoisted(()=>({user:'owner',organizer:false,programmes:vi.fn(),programme:vi.fn(),mapping:vi.fn(),session:{access_token:'a'},save:vi.fn(),read:vi.fn(),list:vi.fn()}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({user:mocks.user?{id:mocks.user}:null,session:mocks.session,account:{userId:mocks.user,hasOrganizerAccess:mocks.organizer},isLoading:false})}));
vi.mock('../data/planningDrafts',()=>({listPlanningDrafts:mocks.programmes,readPlanningDraft:mocks.programme}));
vi.mock('../data/setupEvents',()=>({listSetupEvents:vi.fn().mockResolvedValue([]),readSetupEvent:vi.fn(),readSetupEventResults:vi.fn()}));
vi.mock('../data/sourceMapping',()=>({readSourceMapping:mocks.mapping}));
vi.mock('../data/distributionSetups',()=>({readRewardSetup:mocks.read,saveRewardSetup:mocks.save,listRewardSetups:mocks.list}));
vi.mock('../components/DistributionFlowChart',()=>({default:()=> <div>Funding flow chart</div>}));
const id='72000000-0000-4000-8000-000000000001';
const record:SavedRewardSetup={id,chainId:31337,revision:1,updatedAt:'2026-09-20T12:00:00.000Z',configuration:createRewardSetup(id)};
beforeEach(()=>{mocks.organizer=false;mocks.programmes.mockReset();mocks.programme.mockReset();mocks.mapping.mockReset();sessionStorage.clear();mocks.user='owner';mocks.session={access_token:'a'};mocks.save.mockReset();mocks.read.mockReset();mocks.list.mockReset();vi.spyOn(window,'confirm').mockReturnValue(true);});
const view=(path='/rewards/setup?step=5&legacy=1',locale:'en'|'hr'='en')=><I18nProvider initialLocale={locale}><MemoryRouter initialEntries={[path]}><RewardSetup/></MemoryRouter></I18nProvider>;
const step=(n:number)=>fireEvent.click(screen.getByRole('button',{name:new RegExp(`^${n} `)}));
const finishButton=()=>{step(6);return screen.getByRole('button',{name:'Finish setup'});};
const inspector=()=>within(screen.getByRole('region',{name:'Selected branch'}));
it('creates a new guided record and retries uncertain creation without updating the original',async()=>{
 const f=legacyConversionFixture(),original={...record,revision:2,configuration:decodeRewardSetup(f.source)},before=JSON.stringify(original);
 let copy:SavedRewardSetup|undefined;
 mocks.read.mockImplementation(async(requested)=>requested===id?original:copy);
 mocks.save.mockRejectedValueOnce(Error('connection lost')).mockImplementationOnce(async(copyId,request)=>(copy={...record,id:copyId,configuration:request.configuration}));
 render(view(`/rewards/setup?setup=${id}`));fireEvent.click(await screen.findByRole('button',{name:'Review guided copy'}));
 await screen.findByLabelText('League pot');
 f.potIds.forEach((value:string,i:number)=>fireEvent.change(screen.getByLabelText(i===0?'League pot':`Round ${i}`),{target:{value}}));
 fireEvent.click(screen.getByRole('button',{name:'Continue to reward rules'}));
 for(const [name,type] of [['Athlete Participation','athlete_finishes'],['Athlete Kms','athlete_metres'],['Club Kms','club_metres'],...Array.from({length:5},(_,i)=>[`Category ${i+1}`,'athlete_standings'])])fireEvent.change(screen.getByLabelText(`Reward type · ${name}`),{target:{value:type}});
 fireEvent.click(screen.getByRole('button',{name:'Compare distributions'}));fireEvent.click(screen.getByLabelText('I reviewed the mapped rules and new prize choices'));fireEvent.click(screen.getByRole('button',{name:'Create guided copy'}));
 await screen.findByText(/Creation is not confirmed/);expect(screen.getByRole('button',{name:'Back to original'})).toBeDisabled();expect(screen.getByLabelText('I reviewed the mapped rules and new prize choices')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Retry creating the same copy'}));await screen.findByRole('heading',{name:'League and data'});
 expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);expect(mocks.save.mock.calls[0][0]).not.toBe(id);
 expect(mocks.save.mock.calls[0][1]).toMatchObject({expectedRevision:0,configuration:{version:5,stage:'draft'}});expect(JSON.stringify(original)).toBe(before);
});
it('starts new programmes in the five-step guided flow and saves/reopens the same semantic draft',async()=>{
 let stored:SavedRewardSetup;
 mocks.save.mockImplementation(async(id,request)=>(stored={...record,id,configuration:request.configuration}));mocks.read.mockImplementation(async()=>stored);
 render(view('/rewards/create'));
 expect(within(screen.getByRole('list',{name:'Setup progress'})).getAllByRole('button')).toHaveLength(5);
 fireEvent.change(screen.getByLabelText('Programme name'),{target:{value:'Guided season rewards'}});step(2);
 fireEvent.change(screen.getByLabelText('Round 1 %'),{target:{value:'12'}});
 expect(screen.getByLabelText('Round 2 %')).toHaveValue(10);
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findAllByText(/Saved to your account/);
 expect(mocks.save.mock.calls[0][1].configuration).toMatchObject({version:5,name:'Guided season rewards',stage:'draft'});
 expect(await screen.findByLabelText('Round 1 %')).toHaveValue(12);
 expect(screen.queryByRole('button',{name:'Add branches'})).not.toBeInTheDocument();
});
it('starts from one pot, builds unequal independent branches, sets different winner counts, and saves the complete tree',async()=>{
 let saved:SavedRewardSetup;
 mocks.save.mockImplementation(async(id,request)=>(saved={...record,id,configuration:request.configuration}));mocks.read.mockImplementation(async()=>saved);
 render(view());fireEvent.click(screen.getByRole('button',{name:'Add branches'}));
 fireEvent.click(inspector().getByRole('button',{name:/Branch 1 ↗/}));
 fireEvent.change(screen.getByLabelText('Branch name'),{target:{value:'League'}});
 fireEvent.change(screen.getByLabelText('Number of new branches'),{target:{value:'3'}});fireEvent.click(screen.getByRole('button',{name:'Add branches'}));
 fireEvent.click(inspector().getByRole('button',{name:/Branch 1 ↗/}));fireEvent.click(screen.getByRole('tab',{name:'Reward winners'}));
 fireEvent.change(screen.getByLabelText('Number of rewarded places'),{target:{value:'25'}});fireEvent.click(screen.getByRole('button',{name:'Set reward count'}));
 expect(within(screen.getByRole('table',{name:'Rewarded places'})).getAllByRole('row')).toHaveLength(26);
 fireEvent.click(screen.getByRole('button',{name:'Whole pot'}));fireEvent.click(inspector().getByRole('button',{name:/Branch 2 ↗/}));
 fireEvent.click(screen.getByRole('tab',{name:'Reward winners'}));fireEvent.change(screen.getByLabelText('Number of rewarded places'),{target:{value:'1'}});fireEvent.click(screen.getByRole('button',{name:'Set reward count'}));
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findByText(/Saved to your account/);
 const configuration=mocks.save.mock.calls[0][1].configuration;expect(configuration.root.children).toHaveLength(2);expect(configuration.root.children[0].children).toHaveLength(3);
 expect(configuration.root.children[0].children[0].rule.sharesBps).toHaveLength(25);expect(configuration.root.children[1].rule.sharesBps).toEqual([10000]);
});
it('manual percentages do not silently rebalance other branches; locking survives equal split and undo restores removed subtree',()=>{
 render(view());fireEvent.click(screen.getByRole('button',{name:'Add branches'}));fireEvent.change(screen.getByLabelText('Branch 1 %'),{target:{value:'70'}});
 expect(screen.getByLabelText('Branch 2 %')).toHaveValue(50);expect(screen.getByText(/Shares exceed/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Lock share: Branch 1'}));fireEvent.click(screen.getByRole('button',{name:'Split equally'}));expect(screen.getByLabelText('Branch 1 %')).toHaveValue(70);expect(screen.getByLabelText('Branch 2 %')).toHaveValue(30);
 fireEvent.click(inspector().getByRole('button',{name:/Branch 2 ↗/}));fireEvent.click(screen.getByRole('button',{name:'Remove branch'}));expect(screen.queryByLabelText('Branch 2 %')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Undo change'}));expect(screen.getByLabelText('Branch 2 %')).toHaveValue(30);
});
it('uncertain saves freeze edits and retry exact bytes',async()=>{
 mocks.read.mockResolvedValue(record);mocks.save.mockRejectedValueOnce(Error('lost')).mockImplementationOnce(async(_id,change)=>({...record,revision:2,configuration:change.configuration}));
 render(view(`/rewards/setup?setup=${id}`));await screen.findByDisplayValue('My reward programme');fireEvent.change(screen.getByLabelText('Programme name'),{target:{value:'Changed'}});fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
 await screen.findByText(/save is not confirmed/);expect(screen.getByLabelText('Programme name')).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Retry save'}));await screen.findByText(/Saved to your account/);expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);
});
it('conflict keeps user edits until an explicit reload',async()=>{
 mocks.read.mockResolvedValueOnce(record).mockResolvedValue({...record,revision:3,configuration:{...record.configuration,name:'Other edit'}});mocks.save.mockRejectedValue(new ApiError('Conflict',{status:409,code:'reward_setup_conflict'}));render(view(`/rewards/setup?setup=${id}`));await screen.findByDisplayValue('My reward programme');fireEvent.change(screen.getByLabelText('Programme name'),{target:{value:'My edit'}});fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findByText(/This draft has changed/);expect(screen.getByLabelText('Programme name')).toHaveValue('My edit');fireEvent.click(screen.getByRole('button',{name:'Reload saved version'}));await screen.findByDisplayValue('Other edit');
});
it('anonymous Croatian setup does not fetch or save private data',()=>{
 mocks.user='';render(view('/rewards/setup?step=5&legacy=1','hr'));expect(screen.getByRole('heading',{name:'Postavljanje nagrada'})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Dodaj grane'}));expect(screen.getByLabelText('Grana 1 %')).toHaveValue(50);expect(mocks.read).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
});
it('session changes retire late private loads',async()=>{
 let finish!:(r:SavedRewardSetup)=>void;mocks.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockRejectedValueOnce(Error('not found'));const page=render(view(`/rewards/setup?setup=${id}`));mocks.user='other';mocks.session={access_token:'b'};page.rerender(view(`/rewards/setup?setup=${id}`));await screen.findByText(/could not be opened/);await act(async()=>finish(record));expect(screen.queryByDisplayValue('My reward programme')).not.toBeInTheDocument();
});

it('preserves the guest tree through sign-in without saving it automatically',()=>{
 const guest=createRewardSetup(id);guest.name='Guest draft';guest.budgetMon='25000';sessionStorage.setItem('raceson.reward-setup.sign-in-draft.v1',JSON.stringify(guest));
 render(<StrictMode>{view()}</StrictMode>);expect(screen.getByLabelText('Programme name')).toHaveValue('Guest draft');expect(screen.getByLabelText('Total pot · test MON')).toHaveValue('25000');
 expect(sessionStorage.getItem('raceson.reward-setup.sign-in-draft.v1')).toBeNull();expect(mocks.save).not.toHaveBeenCalled();
});
it('opens the private draft library with a labelled modal and closes it',async()=>{
 mocks.list.mockResolvedValue([record]);render(view());fireEvent.click(screen.getByRole('button',{name:'My setups'}));
 const dialog=await screen.findByRole('dialog',{name:'My setups'});expect(await within(dialog).findByText('My reward programme')).toBeVisible();
 fireEvent.click(within(dialog).getByRole('button',{name:'Close'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps the main pot, sibling branch, nested criteria and prize places on one canvas',()=>{
 render(view());fireEvent.click(screen.getByRole('button',{name:'Add branches'}));fireEvent.click(inspector().getByRole('button',{name:'Branch 1 ↗'}));
 fireEvent.change(screen.getByLabelText('Branch name'),{target:{value:'League'}});fireEvent.click(screen.getByRole('button',{name:'Add branches'}));
 fireEvent.click(inspector().getByRole('button',{name:'Branch 1 ↗'}));fireEvent.change(screen.getByLabelText('Branch name'),{target:{value:'Criterion'}});fireEvent.click(screen.getByRole('tab',{name:'Reward winners'}));
 const graph=within(screen.getByRole('group',{name:'Distribution network'}));expect(graph.getByRole('button',{name:/^Main pot,/})).toBeVisible();expect(graph.getByRole('button',{name:/^League,/})).toBeVisible();expect(graph.getAllByRole('button',{name:/^Branch 2, 50%/})).toHaveLength(2);expect(graph.getByRole('button',{name:/^Place 10,/})).toBeVisible();
 fireEvent.click(graph.getByRole('button',{name:'Collapse: League'}));expect(graph.queryByRole('button',{name:/^Criterion,/})).not.toBeInTheDocument();expect(graph.getByRole('button',{name:/^Branch 2, 50%/})).toBeVisible();
 fireEvent.click(graph.getByRole('button',{name:'Expand: League'}));expect(graph.getByRole('button',{name:/^Criterion,/})).toBeVisible();
});
it('connects an event once, finishes a saved setup, and returns edits to draft',async()=>{
 mocks.organizer=true;const programme={draftId:id,seasonName:'Trail league',organizationName:'Organizer'};const round='72000000-0000-4000-8000-000000000003',category='72000000-0000-4000-8000-000000000004',edition='72000000-0000-4000-8000-000000000005';
 mocks.programmes.mockResolvedValue([programme]);mocks.programme.mockResolvedValue(programme);mocks.mapping.mockResolvedValue({draftId:id,catalogueHash:'a'.repeat(64),catalogue:{rounds:[{id:round,editionId:edition,name:'Trail race',date:'2026-10-03',status:'published',races:[{competitionId:id}]}],categories:[{id:category,competitionId:id,competitionName:'Long',name:'Overall',target:'individual'}]}});
 let saved:SavedRewardSetup;mocks.save.mockImplementation(async(setupId,request)=>(saved={...record,id:setupId,configuration:request.configuration}));mocks.read.mockImplementation(async()=>saved);
 render(view());step(1);fireEvent.click(screen.getByRole('button',{name:/League \/ season/}));expect(finishButton()).toBeDisabled();step(2);await screen.findByRole('option',{name:'Organizer · Trail league'});fireEvent.change(screen.getByLabelText('League / programme'),{target:{value:id}});await screen.findByRole('option',{name:'Trail race · 2026-10-03'});fireEvent.change(screen.getByLabelText('Event',{selector:'select'}),{target:{value:round}});fireEvent.click(screen.getByRole('button',{name:'Use selected event'}));step(5);
 fireEvent.change(screen.getByLabelText('Number of new branches'),{target:{value:'1'}});fireEvent.click(screen.getByRole('button',{name:'Add branches'}));fireEvent.click(inspector().getByRole('button',{name:'Branch 1 ↗'}));fireEvent.click(screen.getByRole('tab',{name:'Reward winners'}));fireEvent.click(screen.getByRole('tab',{name:'Connect results'}));
 fireEvent.change(screen.getByLabelText('Results for this group'),{target:{value:`${round}|${category}`}});fireEvent.click(screen.getByRole('button',{name:'Connect selected results'}));fireEvent.click(finishButton());
 await screen.findByRole('heading',{name:'Ready for results'});expect(mocks.save.mock.calls[0][1].configuration.stage).toBe('ready');expect(mocks.save.mock.calls[0][1].configuration.context.editionId).toBe(edition);
 fireEvent.change(await screen.findByLabelText('Programme name'),{target:{value:'Revised rules'}});expect(screen.queryByRole('heading',{name:'Ready for results'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Save draft'})).toBeEnabled();
 step(2);await screen.findByRole('option',{name:'Trail race · 2026-10-03'});fireEvent.change(screen.getByLabelText('Event',{selector:'select'}),{target:{value:'league'}});fireEvent.click(screen.getByRole('button',{name:'Use selected event'}));expect(window.confirm).toHaveBeenCalled();expect(finishButton()).toBeDisabled();
});

it('saves the expiry and original-sender treasury choice, reopens it, and makes policy edits drafts',async()=>{
 let saved:SavedRewardSetup;mocks.save.mockImplementation(async(setupId,request)=>(saved={...record,id:setupId,configuration:request.configuration}));mocks.read.mockImplementation(async()=>saved);
 render(view());step(6);expect(screen.getByLabelText('Claim window (days)')).toHaveValue(365);
 fireEvent.change(screen.getByLabelText('Treasury return destination'),{target:{value:'original_sender'}});
 fireEvent.change(screen.getByLabelText('Claim window (days)'),{target:{value:'730'}});
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findByText(/Saved to your account/);
 expect(mocks.save.mock.calls[0][1].configuration).toMatchObject({version:4,stage:'draft',policy:{claimWindowDays:730,treasuryReturn:'original_sender',expiredClaims:'fixed_treasury'}});
 expect(screen.getByLabelText('Treasury return destination')).toHaveValue('original_sender');expect(screen.getByLabelText('Claim window (days)')).toHaveValue(730);
});

it('supports bounded keyboard branch movement and reset without changing money',()=>{
 render(view());fireEvent.click(screen.getByRole('button',{name:'Add branches'}));
 const graph=screen.getByRole('group',{name:'Distribution network'}),branch=within(graph).getByRole('button',{name:/^Branch 1, 50%/});
 expect(graph.querySelectorAll('[data-depth-ring]')).toHaveLength(1);
 fireEvent.keyDown(branch,{key:'ArrowRight'});expect(screen.getByLabelText('Branch 1 %')).toHaveValue(50);
 fireEvent.click(screen.getByRole('button',{name:'Reset positions'}));expect(screen.getByLabelText('Branch 2 %')).toHaveValue(50);
});

it('highlights the same level across branches without hiding nodes or changing the selected allocation',()=>{
 render(view());fireEvent.click(screen.getByRole('button',{name:'Add branches'}));
 fireEvent.click(inspector().getByRole('button',{name:'Branch 1 ↗'}));fireEvent.click(screen.getByRole('button',{name:'Add branches'}));
 const graph=screen.getByRole('group',{name:'Distribution network'}),levels=within(screen.getByRole('group',{name:'Highlight a level'}));
 const nodes=graph.querySelectorAll('[data-node-id]').length;
 fireEvent.click(levels.getByRole('button',{name:/Level 1/}));
 expect(graph.querySelectorAll('[data-level-highlight="true"]')).toHaveLength(2);
 expect(graph.querySelectorAll('[data-node-id]')).toHaveLength(nodes);
 expect(screen.getByLabelText('Branch name')).toHaveValue('Branch 1');
 expect(screen.getByLabelText('Share of parent pot',{selector:'input[type="number"]'})).toHaveValue(50);
 fireEvent.click(levels.getByRole('button',{name:/Level 2/}));
 expect(graph.querySelectorAll('[data-depth="2"][data-level-highlight="true"]')).toHaveLength(2);
 fireEvent.click(within(graph).getByRole('button',{name:'Collapse: Branch 1'}));
 expect(levels.getByRole('button',{name:'All levels'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(levels.getByRole('button',{name:/Level 1/}));fireEvent.click(levels.getByRole('button',{name:'All levels'}));
 expect(graph.querySelector('[data-level-highlight]')).toBeNull();
});

it('opens exact prize data from the chart and moves focus to its editable share',()=>{
 render(view());fireEvent.click(screen.getByRole('button',{name:'Add branches'}));
 fireEvent.click(inspector().getByRole('button',{name:'Branch 1 ↗'}));fireEvent.click(screen.getByRole('tab',{name:'Reward winners'}));
 const graph=screen.getByRole('group',{name:'Distribution network'});
 fireEvent.click(within(graph).getByRole('button',{name:/^Place 3,/}));
 expect(screen.getByRole('heading',{name:'Branch 1 · Place 3'})).toHaveFocus();
 expect(screen.getByRole('region',{name:'Place 3 details'})).toHaveTextContent('5,000 test MON');
 expect(within(graph).getByRole('button',{name:/^Place 3,/})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('tab',{name:'Connect results'}));
 fireEvent.click(screen.getByRole('button',{name:'Edit this place’s share'}));expect(screen.getByLabelText('Place 3 %')).toHaveFocus();
 fireEvent.change(screen.getByLabelText('Place 3 %'),{target:{value:'5'}});
 expect(screen.getByRole('region',{name:'Place 3 details'})).toHaveTextContent('2,500 test MON');
 fireEvent.click(within(graph).getByRole('button',{name:/^Branch 2,/}));expect(screen.getByRole('heading',{name:'Branch 2'})).toHaveFocus();
 expect(screen.queryByRole('region',{name:'Place 3 details'})).not.toBeInTheDocument();
});
it('zooms the full canvas by wheel and buttons and fits it without changing allocations',()=>{
 render(view());fireEvent.click(screen.getByRole('button',{name:'Add branches'}));
 const graph=screen.getByRole('group',{name:'Distribution network'}),before=graph.getAttribute('viewBox');
 fireEvent.wheel(graph,{deltaY:-300,clientX:200,clientY:200});expect(graph.getAttribute('viewBox')).not.toBe(before);
 expect(screen.getByLabelText('Branch 1 %')).toHaveValue(50);
 fireEvent.click(screen.getByRole('button',{name:'Fit all'}));expect(graph.getAttribute('viewBox')).toBe(before);
 fireEvent.click(screen.getByRole('button',{name:'Zoom in'}));expect(graph.getAttribute('viewBox')).not.toBe(before);
 fireEvent.click(screen.getByRole('button',{name:'Fit all'}));expect(graph.getAttribute('viewBox')).toBe(before);
});
it('supports two-finger pinch and ignores remaining-finger motion until the pinch ends',()=>{
 class TouchPointerEvent extends MouseEvent {pointerId:number;pointerType:string;constructor(type:string,options:PointerEventInit){super(type,options);this.pointerId=options.pointerId??0;this.pointerType=options.pointerType??'touch';}}
 vi.stubGlobal('PointerEvent',TouchPointerEvent);
 try{
  render(view());fireEvent.click(screen.getByRole('button',{name:'Add branches'}));
  const graph=screen.getByRole('group',{name:'Distribution network'});
  Object.defineProperty(graph,'setPointerCapture',{value:vi.fn()});
  vi.spyOn(graph,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:800,bottom:650,width:800,height:650,toJSON:()=>({})});
  const before=graph.getAttribute('viewBox');
  fireEvent.pointerDown(graph,{pointerId:1,pointerType:'touch',clientX:300,clientY:300});
  fireEvent.pointerDown(graph,{pointerId:2,pointerType:'touch',clientX:500,clientY:300});
  fireEvent.pointerMove(graph,{pointerId:2,pointerType:'touch',clientX:600,clientY:300});
  const zoomed=graph.getAttribute('viewBox');expect(zoomed).not.toBe(before);
  fireEvent.pointerUp(graph,{pointerId:1,pointerType:'touch'});
  fireEvent.pointerMove(graph,{pointerId:2,pointerType:'touch',clientX:650,clientY:300});expect(graph.getAttribute('viewBox')).toBe(zoomed);
  fireEvent.pointerUp(graph,{pointerId:2,pointerType:'touch'});
  expect(screen.getByLabelText('Branch 1 %')).toHaveValue(50);
  fireEvent.click(screen.getByRole('button',{name:'Fit all'}));expect(graph.getAttribute('viewBox')).toBe(before);
 }finally{vi.unstubAllGlobals();}
});

it('never replaces a private saved URL with an empty guest distribution',()=>{
 mocks.user='';render(view(`/rewards/setup?setup=${id}`));
 expect(screen.getByRole('heading',{name:'Sign in to open your saved setup'})).toBeVisible();
 expect(screen.getByRole('link',{name:'Sign in & open programme'})).toHaveAttribute('href',`/auth?next=${encodeURIComponent(`/rewards/setup?setup=${id}`)}`);
 expect(screen.queryByRole('group',{name:'Distribution network'})).not.toBeInTheDocument();expect(mocks.read).not.toHaveBeenCalled();
});
it('opens a version-one nested distribution intact and preserves it when choosing league setup',async()=>{
 const configuration={...record.configuration,root:{...record.configuration.root,name:'SI TRAIL',children:[{...record.configuration.root,id:'72000000-0000-4000-8000-000000000010',name:'League',shareBps:5000,children:[{...record.configuration.root,id:'72000000-0000-4000-8000-000000000011',name:'Age category',shareBps:10000}]},{...record.configuration.root,id:'72000000-0000-4000-8000-000000000012',name:'Rounds',shareBps:5000}]}};
 mocks.read.mockResolvedValue({...record,configuration});render(view(`/rewards/setup?setup=${id}`));
 await screen.findByRole('button',{name:/^SI TRAIL, 100%/});expect(screen.getByRole('button',{name:/^Age category, 100%/})).toBeVisible();
 step(1);expect(screen.getByRole('button',{name:/Single event/})).toHaveAttribute('aria-pressed','false');fireEvent.click(screen.getByRole('button',{name:/League \/ season/}));step(5);
 expect(screen.getByRole('button',{name:/^League, 50%/})).toBeVisible();expect(screen.getByRole('button',{name:/^Rounds, 50%/})).toBeVisible();expect(screen.getByRole('button',{name:/^Age category, 100%/})).toBeVisible();expect(mocks.save).not.toHaveBeenCalled();
});

it('recovers an unsaved guest allocation after reopening the local page',()=>{
 mocks.user='';const page=render(view());fireEvent.click(screen.getByRole('button',{name:'Add branches'}));fireEvent.change(screen.getByLabelText('Branch 1 %'),{target:{value:'70'}});page.unmount();render(view());
 expect(screen.getByLabelText('Branch 1 %')).toHaveValue(70);expect(screen.getByLabelText('Branch 2 %')).toHaveValue(50);expect(mocks.save).not.toHaveBeenCalled();
});

function CampaignLocation(){const location=useLocation();return <output data-testid="campaign-location">{location.search}</output>;}
it('preserves the selected sponsor opportunity when first saving a campaign',async()=>{
 let stored:SavedRewardSetup;
 mocks.save.mockImplementation(async(id,request)=>(stored={...record,id,configuration:request.configuration}));mocks.read.mockImplementation(async()=>stored);
 render(<I18nProvider initialLocale="en"><MemoryRouter initialEntries={['/rewards/create?opportunity=round-5&step=1']}><RewardSetup campaign/><CampaignLocation/></MemoryRouter></I18nProvider>);
 fireEvent.change(screen.getByLabelText('Total budget · test MON'),{target:{value:'10'}});
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findAllByText(/Saved to your account/);
 expect(screen.getByTestId('campaign-location')).toHaveTextContent('opportunity=round-5');
 expect(screen.getByTestId('campaign-location')).toHaveTextContent('setup=');
 expect(screen.getByLabelText('Campaign name')).toHaveValue('My sponsor campaign');
});
