import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes,useLocation} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import {createGuidedSetup} from '@raceson/domain/rewards/guided-setup-editor';
import CopySponsorCampaign from './CopySponsorCampaign';

const mocks=vi.hoisted(()=>({read:vi.fn(),save:vi.fn(),session:{access_token:'test-only'},userId:'sponsor'}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({isLoading:false,user:{id:mocks.userId},session:mocks.session,account:{userId:mocks.userId}})}));
vi.mock('@/shared/i18n/I18nContext',()=>({useI18n:()=>({locale:'en'})}));
vi.mock('../data/distributionSetups',()=>({readRewardSetup:mocks.read,saveRewardSetup:mocks.save}));
vi.mock('../data/copyCatalogue',()=>({useSponsorCatalogue:()=>({copy:{name:'Copied event',sourceSeasonId:'season',categories:[],rounds:[]},loading:false,error:false})}));
vi.mock('../components/SponsorCampaignStudio',()=>({default:(props)=> <><p>{props.saveStatus}</p><button onClick={()=>props.onChange({...props.configuration,budgetMon:'200'})}>Change budget</button><button disabled={props.busy} onClick={props.onFinish}>Continue to funding</button>{props.error}{props.saveAction}</>}));
const id='72000000-0000-4000-8000-000000000001';
function RouteProbe(){const location=useLocation();return <output aria-label="Route">{location.pathname}</output>;}
function view(){return <MemoryRouter initialEntries={[`/rewards/create?setup=${id}`]}><Routes><Route path="/rewards/create" element={<CopySponsorCampaign/>}/><Route path="/rewards/campaigns/:id" element={<h1>Funding</h1>}/></Routes><RouteProbe/></MemoryRouter>;}
beforeEach(()=>{
 mocks.read.mockReset();mocks.save.mockReset();mocks.userId='sponsor';mocks.session={access_token:'test-only'};
 const configuration=createGuidedSetup(()=>crypto.randomUUID());configuration.budgetMon='100';
 mocks.read.mockResolvedValue({id,revision:2,configuration});
 mocks.save.mockImplementation(async(_id,command)=>({id,revision:3,configuration:command.configuration}));
});
it('continues an unchanged saved revision without another write',async()=>{
 render(view());await screen.findByText('Saved · revision 2');fireEvent.click(screen.getByText('Continue to funding'));
 await screen.findByRole('heading',{name:'Funding'});expect(screen.getByLabelText('Route')).toHaveTextContent(`/rewards/campaigns/${id}`);expect(mocks.save).not.toHaveBeenCalled();
});
it('leaves setup only after a changed revision is confirmed',async()=>{
 let resolve; mocks.save.mockImplementation(()=>new Promise(done=>{resolve=done;}));
 render(view());await screen.findByText('Saved · revision 2');fireEvent.click(screen.getByText('Change budget'));fireEvent.click(screen.getByText('Continue to funding'));
 await waitFor(()=>expect(mocks.save).toHaveBeenCalledOnce());expect(screen.getByLabelText('Route')).toHaveTextContent('/rewards/create');
 await act(async()=>resolve({id,revision:3,configuration:mocks.save.mock.calls[0][1].configuration}));
 await screen.findByRole('heading',{name:'Funding'});expect(mocks.save.mock.calls[0][1].expectedRevision).toBe(2);
});
it('stays in setup after a lost reply and retries the identical save',async()=>{
 mocks.save.mockRejectedValueOnce(Error('lost response'));
 render(view());await screen.findByText('Saved · revision 2');fireEvent.click(screen.getByText('Change budget'));fireEvent.click(screen.getByText('Continue to funding'));
 await screen.findByRole('alert');expect(screen.getByLabelText('Route')).toHaveTextContent('/rewards/create');fireEvent.click(screen.getByText('Retry save'));
 await screen.findByRole('heading',{name:'Funding'});expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]);
});
it('keeps save-as-draft in the editor',async()=>{
 render(view());await screen.findByText('Saved · revision 2');fireEvent.click(screen.getByText('Change budget'));fireEvent.click(screen.getByText('Save campaign'));
 await screen.findByText('Saved · revision 3');expect(screen.getByLabelText('Route')).toHaveTextContent('/rewards/create');
});
it('discards a late save reply after the authenticated user changes',async()=>{
 let resolve;mocks.save.mockImplementation(()=>new Promise(done=>{resolve=done;}));
 const page=render(view());await screen.findByText('Saved · revision 2');fireEvent.click(screen.getByText('Change budget'));fireEvent.click(screen.getByText('Continue to funding'));
 await waitFor(()=>expect(mocks.save).toHaveBeenCalledOnce());mocks.userId='other';page.rerender(view());
 await act(async()=>resolve({id,revision:3,configuration:mocks.save.mock.calls[0][1].configuration}));expect(screen.getByLabelText('Route')).toHaveTextContent('/rewards/create');
});
