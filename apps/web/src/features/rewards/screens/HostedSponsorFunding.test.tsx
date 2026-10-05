import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import {createGuidedSetup} from '@raceson/domain/rewards/guided-setup-editor';
import {ApiError} from '@/lib/api';
import HostedSponsorFunding from './HostedSponsorFunding';
const mocks=vi.hoisted(()=>({read:vi.fn(),userId:'sponsor',signedIn:true}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({isLoading:false,user:mocks.signedIn?{id:mocks.userId}:null,session:{access_token:'test-only'},account:{userId:mocks.userId}})}));
vi.mock('@/shared/i18n/I18nContext',()=>({useI18n:()=>({locale:'en'})}));
vi.mock('../data/hostedSponsorCampaign',()=>({readHostedSponsorCampaign:mocks.read}));
vi.mock('../data/copyCatalogue',()=>({useSponsorCatalogue:()=>({copy:{name:'Copied event',categories:[],rounds:[]},loading:false,error:false,retry:vi.fn()})}));
vi.mock('../components/SponsorWallet',()=>({default:({onWallet})=><button onClick={()=>onWallet({address:'0x'+'1'.repeat(40),wallet:{id:'synthetic',provider:{request:vi.fn()}}})}>Connect test wallet</button>}));
vi.mock('../components/SponsorWalletBalance',()=>({default:()=> <p>Read-only wallet balance</p>}));
vi.mock('./HostedAllocationPreview',()=>({default:({revision})=> <p>Exact allocation revision {revision}</p>}));
const id='72000000-0000-4000-8000-000000000001';
function saved(){const configuration=createGuidedSetup(()=>crypto.randomUUID());configuration.name='Saved event';configuration.budgetMon='100';return {record:{id,chainId:10143,revision:2,configuration},fundedWei:'0'};}
function view(){return <MemoryRouter initialEntries={[`/rewards/campaigns/${id}`]}><Routes><Route path="/rewards/campaigns/:id" element={<HostedSponsorFunding/>}/></Routes></MemoryRouter>;}
beforeEach(()=>{mocks.read.mockReset();mocks.read.mockResolvedValue(saved());mocks.userId='sponsor';mocks.signedIn=true;});
it('resumes the confirmed revision with preserved terms and zero deposited funds',async()=>{
 render(view());await screen.findByRole('heading',{name:'Saved event'});
 expect(screen.getByText('Saved · revision 2')).toBeVisible();expect(screen.getByRole('link',{name:'Edit rules'})).toHaveAttribute('href',`/rewards/create?setup=${id}`);
 expect(screen.getByText('365 days')).toBeVisible();expect(screen.getByText('RacesOn treasury')).toBeVisible();expect(screen.getByText('Exact allocation revision 2')).toBeInTheDocument();expect(screen.getByText('Deposited prize funds').nextElementSibling).toHaveTextContent('0 test MON');
 fireEvent.click(screen.getByText('Connect test wallet'));expect(screen.getByRole('heading',{name:'Create your reward contract'})).toBeVisible();expect(screen.getByRole('button',{name:'Create reward contract'})).toBeDisabled();expect(screen.getByText('Deposited prize funds').nextElementSibling).toHaveTextContent('0 test MON');
});
it('does not read private rules for a guest',()=>{mocks.signedIn=false;render(view());expect(screen.getByRole('link',{name:'Sign in'})).toBeVisible();expect(mocks.read).not.toHaveBeenCalled();});
it('keeps permission failures explicit without a local draft fallback',async()=>{mocks.read.mockRejectedValue(new ApiError('denied',{status:403}));render(view());await screen.findByRole('alert');expect(screen.getByRole('link',{name:'Sign in'})).toBeVisible();expect(screen.queryByText('Connect test wallet')).not.toBeInTheDocument();});
it('retries a read failure without requesting creation or a deposit',async()=>{mocks.read.mockRejectedValueOnce(Error('network'));render(view());fireEvent.click(await screen.findByRole('button',{name:'Retry'}));await screen.findByRole('heading',{name:'Saved event'});expect(mocks.read).toHaveBeenCalledTimes(2);});
it('does not reveal a late previous-account response',async()=>{
 let resolve;mocks.read.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const page=render(view());await waitFor(()=>expect(mocks.read).toHaveBeenCalledOnce());mocks.userId='other';mocks.read.mockRejectedValueOnce(new ApiError('denied',{status:403}));page.rerender(view());await screen.findByRole('alert');await act(async()=>resolve(saved()));expect(screen.queryByRole('heading',{name:'Saved event'})).not.toBeInTheDocument();
});
