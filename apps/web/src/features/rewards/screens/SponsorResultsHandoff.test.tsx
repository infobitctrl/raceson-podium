import {act,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import {I18nProvider} from '@/shared/i18n/I18nProvider';
import SponsorResultsHandoff from './SponsorResultsHandoff';
const mocks=vi.hoisted(()=>({user:{id:'owner'} as {id:string}|null,read:vi.fn()}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({user:mocks.user,isLoading:false})}));
vi.mock('@/lib/public-env',()=>({publicEnv:{rewardDemo:{chainId:10143}}}));
vi.mock('../data/publicCampaign',()=>({readPublicCampaign:mocks.read,publicCampaignPath:(id:string)=>`/rewards/campaigns/${id}/public`}));
vi.mock('../components/SponsorProgramme',()=>({default:({slot,sourceOnly}:{slot:number;sourceOnly:boolean})=><p>Selected pot {slot} · {sourceOnly?'source review only':'wallet actions'}</p>}));
const id='73000000-0000-4000-8000-000000000001';
const ui=(query="?pot=4")=> <I18nProvider initialLocale="en"><MemoryRouter initialEntries={[`/rewards/manage/campaigns/${id}${query}`]}><Routes><Route path="/rewards/manage/campaigns/:id" element={<SponsorResultsHandoff/>}/></Routes></MemoryRouter></I18nProvider>;
beforeEach(()=>{mocks.user={id:'owner'};mocks.read.mockReset().mockResolvedValue({id,name:'Verified two-pot campaign',pots:[{slot:2,name:'Coastal race'},{slot:4,name:'Forest race'}]});});
it('retains the selected campaign and pot through official review and controller handoff',async()=>{
 render(ui());expect(screen.getByText('Selected pot 4 · source review only')).toBeVisible();
 expect(screen.getByRole('link',{name:/Rewards Control/})).toHaveAttribute('href',`/rewards/control?campaign=${id}&pot=4`);
 fireEvent.change(await screen.findByRole('combobox',{name:'Prize pot'}),{target:{value:'2'}});
 expect(screen.getByRole('link',{name:/Rewards Control/})).toHaveAttribute('href',`/rewards/control?campaign=${id}&pot=2`);
});
it('preserves the exact pot in the platform sign-in return URL',()=>{
 mocks.user=null;render(ui());expect(screen.getByRole('link',{name:'Sign in to the platform results workspace'})).toHaveAttribute('href',`/auth?next=${encodeURIComponent(`/rewards/manage/campaigns/${id}?pot=4`)}`);
});
it('offers only verified pots, without assuming five rounds',async()=>{
 render(ui());expect(await screen.findByRole('option',{name:'Forest race'})).toBeVisible();
 expect(screen.getAllByRole('option')).toHaveLength(2);expect(screen.queryByRole('option',{name:'League'})).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Campaign overview'})).toHaveAttribute('href',`/rewards/campaigns/${id}/public?pot=4`);
});
it('preserves exact source review when public context is unavailable',async()=>{
 mocks.read.mockRejectedValue(new Error('not published'));render(ui());await act(async()=>{});
 expect(screen.getByText('Selected pot 4 · source review only')).toBeVisible();expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:/Rewards Control/})).toHaveAttribute('href',`/rewards/control?campaign=${id}&pot=4`);
});
it('does not silently replace a linked pot missing from verified context',async()=>{
 mocks.read.mockResolvedValue({id,name:'League-only campaign',pots:[{slot:0,name:'League standings'}]});render(ui());
 expect(await screen.findByRole('alert')).toHaveTextContent('This pot is not listed');expect(screen.queryByText('Selected pot 4 · source review only')).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:/Rewards Control/})).toHaveAttribute('href',`/rewards/control?campaign=${id}&pot=4`);
});
it('ignores public context delivered after the review unmounts',async()=>{
 let resolve!:(v:unknown)=>void;mocks.read.mockImplementation(()=>new Promise(r=>{resolve=r;}));const page=render(ui());page.unmount();
 await act(async()=>resolve({id,name:'Late private context',pots:[{slot:4,name:'Late pot'}]}));expect(screen.queryByText('Late pot')).not.toBeInTheDocument();
});

it('leaves the single pot title to source review and retains its overview link',async()=>{
 mocks.read.mockResolvedValue({id,name:'One-pot campaign',pots:[{slot:4,name:'Forest race'}]});render(ui());
 expect(await screen.findByRole('link',{name:'Campaign overview'})).toHaveAttribute('href',`/rewards/campaigns/${id}/public?pot=4`);
 expect(screen.queryByRole('heading',{name:'Forest race'})).not.toBeInTheDocument();
 expect(screen.getByRole('combobox')).toHaveValue('4');
 expect(screen.getByText('Selected pot 4 · source review only')).toBeVisible();
});

it('asks for the verified single race pot instead of defaulting to league slot zero',async()=>{
 mocks.read.mockResolvedValue({id,name:'Single race',pots:[{slot:1,name:'Race rewards'}]});render(ui(''));
 expect(screen.queryByText(/Selected pot/)).not.toBeInTheDocument();
 fireEvent.change(await screen.findByRole('combobox',{name:'Prize pot'}),{target:{value:'1'}});
 expect(screen.getByText('Selected pot 1 · source review only')).toBeVisible();
 expect(screen.getByRole('link',{name:/Rewards Control/})).toHaveAttribute('href',`/rewards/control?campaign=${id}&pot=1`);
});
it.each(['?pot=wrong','?pot=1&pot=2','?pot=9'])('keeps an invalid explicit link unresolved: %s',async query=>{
 render(ui(query));await screen.findByRole('combobox');
 expect(screen.getByRole('alert')).toHaveTextContent('This pot is not listed');
 expect(screen.queryByText(/Selected pot/)).not.toBeInTheDocument();expect(screen.getByRole('combobox')).toHaveValue('');
});
