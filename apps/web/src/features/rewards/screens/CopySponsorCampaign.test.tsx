import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes,useLocation} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import {createGuidedSetup} from '@raceson/domain/rewards/guided-setup-editor';
import CopySponsorCampaign from './CopySponsorCampaign';

const mocks=vi.hoisted(()=>({read:vi.fn(),save:vi.fn(),brandingRead:vi.fn(),brandingSave:vi.fn(),session:{access_token:'test-only'},userId:'sponsor'}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({isLoading:false,user:{id:mocks.userId},session:mocks.session,account:{userId:mocks.userId}})}));
vi.mock('@/shared/i18n/I18nContext',()=>({useI18n:()=>({locale:'en'})}));
vi.mock('../data/campaignBranding',()=>({readCampaignBranding:mocks.brandingRead,saveCampaignBranding:mocks.brandingSave,prepareSponsorLogo:vi.fn()}));
vi.mock('../data/distributionSetups',()=>({readRewardSetup:mocks.read,saveRewardSetup:mocks.save}));
vi.mock('../data/copyCatalogue',()=>({useSponsorCatalogue:()=>({copy:{name:'Copied event',sourceSeasonId:'season',categories:[],rounds:[]},loading:false,error:false})}));
vi.mock('../components/SponsorCampaignStudio',()=>({default:(props)=> <>{props.sponsorDetails?.editor}<p>{props.saveStatus}</p><button onClick={()=>props.onChange({...props.configuration,budgetMon:'200'})}>Change budget</button><button disabled={props.busy} onClick={props.onFinish}>Continue to funding</button>{props.error}{props.saveAction}</>}));
const id='72000000-0000-4000-8000-000000000001';
function RouteProbe(){const location=useLocation();return <output aria-label="Route">{location.pathname}</output>;}
function view(){return <MemoryRouter initialEntries={[`/rewards/create?setup=${id}`]}><Routes><Route path="/rewards/create" element={<CopySponsorCampaign/>}/><Route path="/rewards/campaigns/:id" element={<h1>Funding</h1>}/></Routes><RouteProbe/></MemoryRouter>;}
beforeEach(()=>{
 mocks.read.mockReset();mocks.save.mockReset();mocks.brandingRead.mockReset();mocks.brandingSave.mockReset();mocks.brandingRead.mockResolvedValue([{id,name:null,logo:null,website:null,promotion:null,revision:0}]);mocks.brandingSave.mockImplementation(async(_id,body)=>({id,...body,revision:body.expectedRevision+1}));mocks.userId='sponsor';mocks.session={access_token:'test-only'};
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
it('saves sponsor promotion before leaving setup and does not rewrite unchanged prize rules',async()=>{
 render(view());await screen.findByText('Saved · revision 2');
 fireEvent.change(screen.getByLabelText('Sponsor name'),{target:{value:'Trail partners'}});
 fireEvent.change(screen.getByLabelText('Website'),{target:{value:'https://example.com/trail'}});
 fireEvent.change(screen.getByLabelText('About your promotion'),{target:{value:'Meet us at the finish line.'}});
 fireEvent.click(screen.getByText('Continue to funding'));await screen.findByRole('heading',{name:'Funding'});
 expect(mocks.save).not.toHaveBeenCalled();expect(mocks.brandingSave).toHaveBeenCalledWith(id,{name:'Trail partners',logo:null,website:'https://example.com/trail',promotion:'Meet us at the finish line.',expectedRevision:0});
});
it('keeps a failed promotion save in setup and retries without a new economic revision',async()=>{
 mocks.brandingSave.mockRejectedValueOnce(Error('offline'));
 render(view());await screen.findByText('Saved · revision 2');
 fireEvent.change(screen.getByLabelText('Sponsor name'),{target:{value:'Retry sponsor'}});
 fireEvent.click(screen.getByText('Change budget'));fireEvent.click(screen.getByText('Continue to funding'));
 expect(await screen.findByRole('alert')).toHaveTextContent('Sponsor details were not confirmed');
 expect(screen.getByLabelText('Sponsor name')).toHaveValue('Retry sponsor');
 fireEvent.click(screen.getByText('Save campaign'));await screen.findByRole('heading',{name:'Funding'});
 expect(mocks.save).toHaveBeenCalledOnce();expect(mocks.brandingSave.mock.calls[1]).toEqual(mocks.brandingSave.mock.calls[0]);
});
it('recovers an exact confirmed branding revision after a lost reply',async()=>{
 mocks.brandingSave.mockImplementation(async(_id,body)=>{mocks.brandingRead.mockResolvedValue([{id,...body,revision:1}]);throw Error('lost');});
 render(view());await screen.findByText('Saved · revision 2');fireEvent.change(screen.getByLabelText('Sponsor name'),{target:{value:'Confirmed sponsor'}});fireEvent.click(screen.getByText('Continue to funding'));
 await screen.findByRole('heading',{name:'Funding'});expect(mocks.brandingSave).toHaveBeenCalledOnce();expect(mocks.save).not.toHaveBeenCalled();
});
it('blocks incomplete or unsafe promotion fields before any save',async()=>{
 render(view());await screen.findByText('Saved · revision 2');fireEvent.change(screen.getByLabelText('Website'),{target:{value:'javascript:alert(1)'}});
 expect(await screen.findByRole('alert')).toHaveTextContent('HTTPS website');fireEvent.click(screen.getByText('Continue to funding'));
 expect(mocks.brandingSave).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();expect(screen.getByLabelText('Route')).toHaveTextContent('/rewards/create');
});
