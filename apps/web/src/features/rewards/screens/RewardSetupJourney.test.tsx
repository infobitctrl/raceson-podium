vi.mock('../data/publicDirectory',()=>({usePublicDirectory:()=>({data:{items:[]},isError:false})}));
import {createRewardSetup,defaultRewardSetupPolicy} from '@raceson/domain/rewards/distribution-setup';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import {I18nProvider} from '@/shared/i18n/I18nProvider';
import RewardSetup from './RewardSetup';
import OrganizerProgrammeDirectory from './OrganizerProgrammeDirectory';
const api=vi.hoisted(()=>({session:{access_token:'session'},events:vi.fn(),event:vi.fn(),results:vi.fn(),save:vi.fn(),read:vi.fn(),list:vi.fn()}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({user:{id:'owner'},session:api.session,account:{userId:'owner',hasOrganizerAccess:true},isLoading:false})}));
vi.mock('../data/setupEvents',()=>({listSetupEvents:api.events,readSetupEvent:api.event,readSetupEventResults:api.results}));
vi.mock('../data/distributionSetups',()=>({listRewardSetups:api.list,saveRewardSetup:api.save,readRewardSetup:api.read}));
vi.mock('../data/planningDrafts',()=>({listPlanningDrafts:vi.fn().mockResolvedValue([]),readPlanningDraft:vi.fn()}));
vi.mock('../components/TestProgrammeLibrary',()=>({default:()=>null}));
const id=(n:number)=>`78000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const event={id:id(1),name:'Synthetic Trail 2026',date:'2026-10-03',organizationName:'Synthetic organizer',catalogueHash:'a'.repeat(64),races:[{id:id(2),name:'Long',distanceKm:25,minimumAge:18,maximumAge:null,genders:['F','M'],missing:['Club ranking is not configured'],groups:[{key:'overall',label:'Overall finishers',kind:'overall',gender:null,minimumAge:null,maximumAge:null},{key:'age:18-39',label:'Age 18–39',kind:'age',gender:null,minimumAge:18,maximumAge:39}]}]};
const step=(n:number)=>fireEvent.click(screen.getByRole('button',{name:new RegExp(`^${n} `)}));
const view=(component=<RewardSetup/>,path='/rewards/create?legacy=1')=><I18nProvider initialLocale="en"><MemoryRouter initialEntries={[path]}>{component}</MemoryRouter></I18nProvider>;
beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();api.events.mockResolvedValue([event]);api.event.mockResolvedValue(event);api.results.mockResolvedValue({catalogueHash:event.catalogueHash,publicationId:null,publicationState:null,publishedAt:null,groups:[]});api.list.mockResolvedValue([]);let saved:unknown;api.save.mockImplementation(async(setupId,change)=>(saved={id:setupId,chainId:31337,revision:1,updatedAt:'2026-09-21T12:00:00.000Z',configuration:change.configuration}));api.read.mockImplementation(async()=>saved);vi.spyOn(window,'confirm').mockReturnValue(true);});
async function chooseEvent(){
 step(2);fireEvent.click(await screen.findByRole('button',{name:/Synthetic Trail 2026/}));await screen.findByRole('button',{name:'Choose what to reward'});step(4);
}
async function addReward(parent:string,name:string,winners:number,groupKey:string,approved=true){
 const graph=within(screen.getByRole('group',{name:'Distribution network'}));
 fireEvent.click(graph.getByRole('button',{name:new RegExp(`^${parent},`)}));fireEvent.click(graph.getByRole('button',{name:`Add subpot to ${parent}`}));
 fireEvent.change(screen.getByLabelText('Branch name'),{target:{value:name}});fireEvent.click(screen.getByRole('tab',{name:'Reward winners'}));
 fireEvent.change(screen.getByLabelText('Number of rewarded places'),{target:{value:String(winners)}});fireEvent.click(screen.getByRole('button',{name:'Set reward count'}));
 await screen.findByRole('option',{name:'Long · Age 18–39'});fireEvent.change(screen.getByLabelText('Category for this branch'),{target:{value:`${id(2)}|${groupKey}`}});
 if(approved)fireEvent.click(screen.getByLabelText('Eligibility reviewed'));fireEvent.click(screen.getByRole('button',{name:'Connect category'}));
}
it('builds independent rewards directly on one circular chart, finishes and reopens the same programme',async()=>{
 render(view());fireEvent.change(screen.getByLabelText('Programme name'),{target:{value:'Standalone autumn rewards'}});await chooseEvent();
 expect(screen.queryByRole('button',{name:'Generate distribution'})).not.toBeInTheDocument();expect(screen.queryByText('Create only the groups you choose')).not.toBeInTheDocument();
 const graph=screen.getByRole('group',{name:'Distribution network'});fireEvent.click(within(graph).getByRole('button',{name:'Add subpot to Main pot'}));fireEvent.change(screen.getByLabelText('Branch name'),{target:{value:'Long'}});
 await addReward('Long','Overall finishers',2,'overall');await addReward('Long','Age 18–39',7,'age:18-39');
 fireEvent.click(within(graph).getByRole('button',{name:/^Long,/}));fireEvent.click(screen.getByRole('button',{name:'Split equally'}));
 step(5);expect(screen.getByRole('group',{name:'Distribution network'})).toBe(graph);expect(within(graph).getByRole('button',{name:/^Overall finishers, 50%/})).toBeVisible();expect(within(graph).getByRole('button',{name:/^Age 18–39, 50%/})).toBeVisible();
 step(4);expect(screen.getByRole('group',{name:'Distribution network'})).toBe(graph);step(6);expect(screen.getByRole('button',{name:'Finish setup'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'Finish setup'}));await screen.findByRole('heading',{name:'Ready for results'});
 const saved=api.save.mock.calls[0][1].configuration;expect(saved).toMatchObject({version:4,programmeKind:'event',context:null,stage:'ready',name:'Standalone autumn rewards'});expect(saved.root.children[0].children.map(n=>n.rule.sharesBps.length)).toEqual([2,7]);
 expect(await screen.findAllByText('Waiting for official results. Your setup is saved.')).toHaveLength(2);expect(api.results).toHaveBeenCalledWith(id(1),id(2));
 step(1);fireEvent.change(screen.getByLabelText('Programme name'),{target:{value:'Revised autumn rules'}});expect(screen.queryByRole('heading',{name:'Ready for results'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Save draft'})).toBeEnabled();
});
it('requires reviewed eligibility for chart-built rewards and adds no unchosen categories',async()=>{
 render(view());await chooseEvent();await addReward('Main pot','Overall finishers',2,'overall',false);step(6);expect(screen.getByRole('button',{name:'Finish setup'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findByText(/Saved to your account/);expect(api.save.mock.calls[0][1].configuration.root.children).toHaveLength(1);expect(api.save.mock.calls[0][1].configuration.event.choices[0]).toMatchObject({groupKey:'overall',approved:false});
});
it('lists saved setups beside the existing programme directory and links the exact saved setup',async()=>{
 api.list.mockResolvedValue([{id:id(9),revision:3,configuration:{name:'Autumn rewards',budgetMon:'100',stage:'ready',event:{name:event.name,date:event.date}}}]);render(view(<OrganizerProgrammeDirectory/>,'/rewards/manage'));for(const link of await screen.findAllByRole('link',{name:/Autumn rewards/}))expect(link).toHaveAttribute('href',`/rewards/setup?setup=${id(9)}&view=results`);expect(screen.getByText('Ready for results')).toBeVisible();
});
it('connects a manually added branch to an event category without regenerating the tree',async()=>{
 render(view());step(2);fireEvent.click(await screen.findByRole('button',{name:/Synthetic Trail 2026/}));await screen.findByRole('button',{name:'Choose what to reward'});step(5);
 fireEvent.change(screen.getByLabelText('Number of new branches'),{target:{value:'1'}});fireEvent.click(screen.getByRole('button',{name:'Add branches'}));
 fireEvent.click(within(screen.getByRole('region',{name:'Selected branch'})).getByRole('button',{name:'Branch 1 ↗'}));fireEvent.click(screen.getByRole('tab',{name:'Reward winners'}));fireEvent.click(screen.getByRole('tab',{name:'Connect results'}));
 await screen.findByRole('option',{name:'Long · Age 18–39'});fireEvent.change(screen.getByLabelText('Category for this branch'),{target:{value:`${id(2)}|age:18-39`}});
 fireEvent.click(within(screen.getByRole('region',{name:'Selected branch'})).getByLabelText('Eligibility reviewed'));fireEvent.click(screen.getByRole('button',{name:'Connect category'}));step(6);expect(screen.getByRole('button',{name:'Finish setup'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findByText(/Saved to your account/);const configuration=api.save.mock.calls[0][1].configuration;expect(configuration.root.children).toHaveLength(1);expect(configuration.root.children[0].name).toBe('Branch 1');expect(configuration.event.choices[0]).toMatchObject({groupKey:'age:18-39',approved:true});
});

it('refreshes changed event categories without rebuilding the chart and requires renewed eligibility review',async()=>{
 const base=createRewardSetup(id(20)),leaf={...base.root,id:id(21),name:'My custom award',shareBps:10000,rule:{basis:'race_position',sharesBps:[7000,3000],source:null}};
 api.read.mockResolvedValue({id:id(9),chainId:31337,revision:2,updatedAt:'2026-09-21T12:00:00.000Z',configuration:{...base,version:4,programmeKind:'event',stage:'ready',policy:defaultRewardSetupPolicy(),context:null,event:{editionId:event.id,name:event.name,date:event.date,catalogueHash:event.catalogueHash,choices:[{nodeId:leaf.id,raceId:id(2),groupKey:'overall',approved:true}]},root:{...base.root,children:[leaf]}}});
 api.event.mockResolvedValue({...event,catalogueHash:'b'.repeat(64)});render(view(<RewardSetup/>,`/rewards/setup?setup=${id(9)}&step=3`));
 fireEvent.click(await screen.findByRole('button',{name:'Refresh categories'}));step(4);fireEvent.click(screen.getByRole('button',{name:/^My custom award, 100%/}));
 expect(await screen.findByLabelText('Eligibility reviewed')).not.toBeChecked();expect(screen.getByLabelText('Place 1 %')).toHaveValue(70);expect(screen.getByLabelText('Place 2 %')).toHaveValue(30);step(6);expect(screen.getByRole('button',{name:'Finish setup'})).toBeDisabled();
});
