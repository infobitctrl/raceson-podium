vi.mock('../data/operations',()=>({reviewIssues:vi.fn(async()=>({revision:0,contextHash:'c'.repeat(64),canReport:true,issues:[]})),readSupportSettings:vi.fn(async()=>({revision:0,settings:{gasAlertWei:null,supportWallet:null,supportLimitWei:'0'},history:[],gas:null}))}));
import {I18nProvider} from "@/shared/i18n/I18nProvider";
import {act,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import WalletAdministration from './WalletAdministration';
import {OperationalWalletRuntimeContext} from '../components/OperationalWalletRuntime';
const mock=vi.hoisted(()=>({auth:{user:{id:'master'},isLoading:false,account:{platformRole:'super_admin'}} as {user:{id:string}|null;isLoading:boolean;account:{platformRole:string}},read:vi.fn(),review:vi.fn(),activate:vi.fn(),prepare:vi.fn(),upgrade:vi.fn()}));
vi.mock('@/lib/auth',()=>({useAuth:()=>mock.auth}));
vi.mock('../data/walletAdministration',()=>({readWalletAdministration:mock.read,reviewWalletReplacement:mock.review,activateWalletReplacement:mock.activate,prepareWalletCreation:mock.prepare,prepareDeploymentUpgrade:mock.upgrade}));
const address=(n:string)=>'0x'+n.repeat(40);
const settings={deployment:{version:1,appId:'app',walletId:'old',address:address('1'),ownerId:'owner',signerId:'signer',policyId:'policy',factory:address('4')},controller:{subject:'did:privy:owner',wallet:address('1')}};
const snapshot={revision:0,settings,fingerprint:'a'.repeat(64),history:[]};
const review={revision:0,candidate:{...settings,deployment:{...settings.deployment,address:address('2'),walletId:'new'}},fingerprint:'b'.repeat(64)};
beforeEach(()=>{vi.clearAllMocks();mock.auth={user:{id:'master'},isLoading:false,account:{platformRole:'super_admin'}};mock.read.mockResolvedValue(snapshot);mock.review.mockResolvedValue(review);mock.activate.mockResolvedValue({...snapshot,revision:1,settings:review.candidate});});
const mount=()=>render(<MemoryRouter><WalletAdministration/></MemoryRouter>);
async function verify(){mount();fireEvent.click(await screen.findByRole('button',{name:'Replace deployment wallet'}));fireEvent.change(screen.getByLabelText('New Privy wallet ID'),{target:{value:'new'}});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Verify replacement'})));}
it.each(['site_admin','organizer','sponsor'])('denies %s without loading operational settings',role=>{mock.auth.account.platformRole=role;mount();expect(screen.getByRole('heading',{name:'Master-admin access required'})).toBeVisible();expect(mock.read).not.toHaveBeenCalled();});
it('requires sign-in before settings access',()=>{mock.auth.user=null;mount();expect(screen.getByRole('link',{name:'Sign in'})).toBeVisible();expect(mock.read).not.toHaveBeenCalled();});
it('separates operational areas without granting activation or changing settings',async()=>{
 mount();await screen.findByRole('button',{name:'Replace deployment wallet'});
 fireEvent.mouseDown(screen.getByRole('tab',{name:'Creation gas'}),{button:0,ctrlKey:false});
 expect(screen.getByRole('button',{name:'Replace deployment wallet'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'Replace distribution controller'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Replace deployment wallet'}));
 fireEvent.change(screen.getByLabelText('New Privy wallet ID'),{target:{value:'draft-deployment'}});
 fireEvent.mouseDown(screen.getByRole('tab',{name:'Controller authority'}),{button:0,ctrlKey:false});
 expect(screen.getByRole('button',{name:'Replace distribution controller'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'Replace deployment wallet'})).not.toBeInTheDocument();
 expect(screen.queryByLabelText('New Privy wallet ID')).not.toBeInTheDocument();
 expect(mock.review).not.toHaveBeenCalled();expect(mock.activate).not.toHaveBeenCalled();
});
it('review does not write; activation requires reason and explicit acknowledgement',async()=>{await verify();expect(mock.activate).not.toHaveBeenCalled();const activate=screen.getByRole('button',{name:'Activate replacement'});expect(activate).toBeDisabled();fireEvent.change(screen.getByLabelText('Reason for change'),{target:{value:'Separate creation queue'}});expect(activate).toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));await act(async()=>fireEvent.click(activate));expect(mock.activate).toHaveBeenCalledWith(snapshot,'deployment','new',review,'Separate creation queue');expect(screen.getByText(/Wallet settings saved · revision 1/)).toBeVisible();});
it('editing the wallet invalidates the reviewed replacement',async()=>{await verify();fireEvent.change(screen.getByLabelText('New Privy wallet ID'),{target:{value:'different'}});expect(screen.queryByRole('button',{name:'Activate replacement'})).not.toBeInTheDocument();expect(mock.activate).not.toHaveBeenCalled();});
it('activation conflict keeps original wallet and offers reload, without a success claim',async()=>{mock.activate.mockRejectedValueOnce(Error('conflict'));await verify();fireEvent.change(screen.getByLabelText('Reason for change'),{target:{value:'Separate creation queue'}});fireEvent.click(screen.getByRole('checkbox'));await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Activate replacement'})));expect(screen.getByRole('alert')).toHaveTextContent('No change was confirmed');expect(screen.queryByText(/Wallet settings saved/)).not.toBeInTheDocument();expect(screen.queryByText(address('2'))).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Reload settings'})).toBeEnabled();});

it('keeps the existing ID path available if no native runtime is configured',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'Replace deployment wallet'}));
 expect(screen.getByRole('button',{name:'Create new wallet with Privy'})).toBeDisabled();
 expect(screen.getByLabelText('New Privy wallet ID')).toBeEnabled();expect(mock.prepare).not.toHaveBeenCalled();
});

it('loads native creation only after explicit master action and requires independent server review',async()=>{
 const preparation={ownerSubject:'did:privy:owner',deployment:settings.deployment,revision:0,fingerprint:snapshot.fingerprint};
 mock.prepare.mockResolvedValue(preparation);
 const loader=vi.fn().mockResolvedValue({default:({onSelected}:{onSelected:(id:string)=>void})=><button onClick={()=>onSelected('created-id')}>Use created wallet fixture</button>});
 render(<MemoryRouter><OperationalWalletRuntimeContext.Provider value={loader}><WalletAdministration/></OperationalWalletRuntimeContext.Provider></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Replace deployment wallet'}));expect(loader).not.toHaveBeenCalled();expect(mock.prepare).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Create new wallet with Privy'}));fireEvent.click(await screen.findByRole('button',{name:'Use created wallet fixture'}));
 expect(mock.prepare).toHaveBeenCalledWith(snapshot,'deployment');expect(screen.getByLabelText('New Privy wallet ID')).toHaveValue('created-id');expect(mock.review).not.toHaveBeenCalled();expect(mock.activate).not.toHaveBeenCalled();
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Verify replacement'})));expect(mock.review).toHaveBeenCalledWith(snapshot,'deployment','created-id');expect(screen.getByRole('button',{name:'Activate replacement'})).toBeDisabled();
});
it('controller creation selects the native controller role and still requires review and activation',async()=>{
 mock.prepare.mockResolvedValue({ownerSubject:'did:privy:owner',role:'controller',currentWalletAddress:settings.controller.wallet,deployment:settings.deployment,revision:0,fingerprint:snapshot.fingerprint});
 const loader=vi.fn().mockResolvedValue({default:({onSelected})=><button onClick={()=>onSelected('new-controller-id')}>Use created controller fixture</button>});
 render(<MemoryRouter><OperationalWalletRuntimeContext.Provider value={loader}><WalletAdministration/></OperationalWalletRuntimeContext.Provider></MemoryRouter>);
 await screen.findByRole('button',{name:'Replace deployment wallet'});fireEvent.mouseDown(screen.getByRole('tab',{name:'Controller authority'}),{button:0,ctrlKey:false});
 fireEvent.click(screen.getByRole('button',{name:'Replace distribution controller'}));expect(mock.prepare).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Create new wallet with Privy'}));fireEvent.click(await screen.findByRole('button',{name:'Use created controller fixture'}));
 expect(mock.prepare).toHaveBeenCalledWith(snapshot,'controller');expect(screen.getByLabelText('New Privy wallet ID')).toHaveValue('new-controller-id');expect(mock.review).not.toHaveBeenCalled();expect(mock.activate).not.toHaveBeenCalled();
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Verify replacement'})));expect(mock.review).toHaveBeenCalledWith(snapshot,'controller','new-controller-id');expect(screen.getByRole('button',{name:'Activate replacement'})).toBeDisabled();
});
it('failed creation preparation never starts the Privy SDK',async()=>{
 mock.prepare.mockRejectedValue(Error('access revoked'));const loader=vi.fn();
 render(<MemoryRouter><OperationalWalletRuntimeContext.Provider value={loader}><WalletAdministration/></OperationalWalletRuntimeContext.Provider></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Replace deployment wallet'}));fireEvent.click(screen.getByRole('button',{name:'Create new wallet with Privy'}));
 await screen.findByRole('alert');expect(loader).not.toHaveBeenCalled();expect(mock.activate).not.toHaveBeenCalled();
});

it('Croatian review retains explicit authority and activation gates',async()=>{
 render(<I18nProvider initialLocale="hr"><MemoryRouter><WalletAdministration/></MemoryRouter></I18nProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Zamijeni novčanik za stvaranje kampanja'}));
 fireEvent.change(screen.getByLabelText('ID novog Privy novčanika'),{target:{value:'new'}});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Provjeri zamjenu'})));
 expect(screen.getByRole('button',{name:'Aktiviraj zamjenu'})).toBeDisabled();
 expect(screen.getByRole('checkbox')).not.toBeChecked();
 expect(mock.review).toHaveBeenCalledWith(snapshot,'deployment','new');
 expect(mock.activate).not.toHaveBeenCalled();
 expect(screen.getByText(/postojeće kampanje i transakcije na čekanju zadržavaju izvornu ovlast/)).toBeVisible();
});

it('prepares existing-wallet V5 permission only on explicit action, without activation',async()=>{
 mock.upgrade.mockResolvedValue({ownerSubject:'did:privy:owner',role:'deployment',mode:'upgrade',deployment:{...settings.deployment,protocolVersion:5},revision:0,fingerprint:snapshot.fingerprint});
 const loader=vi.fn().mockResolvedValue({default:({preparation,onSelected})=><button onClick={()=>onSelected(preparation.deployment.walletId)}>Use existing wallet fixture</button>});
 render(<MemoryRouter><OperationalWalletRuntimeContext.Provider value={loader}><WalletAdministration/></OperationalWalletRuntimeContext.Provider></MemoryRouter>);
 expect(mock.upgrade).not.toHaveBeenCalled();
 fireEvent.click(await screen.findByRole('button',{name:'Review new creation permission'}));
 fireEvent.click(await screen.findByRole('button',{name:'Use existing wallet fixture'}));
 expect(mock.upgrade).toHaveBeenCalledWith(snapshot);expect(mock.prepare).not.toHaveBeenCalled();
 expect(screen.getByLabelText('New Privy wallet ID')).toHaveValue('old');expect(mock.activate).not.toHaveBeenCalled();
});
