import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import Entry from './PrivyOperationalWallet';
const mocks=vi.hoisted(()=>({ready:true,authenticated:true,subject:'did:privy:owner',custom:false,wallets:[] as unknown[],create:vi.fn(),grant:vi.fn(),login:vi.fn(),logout:vi.fn(),provider:vi.fn(),select:vi.fn(),busy:vi.fn()}));
vi.mock('@privy-io/react-auth',()=>({PrivyProvider:(props:{children:React.ReactNode})=>{mocks.provider(props);return props.children;},usePrivy:()=>({ready:mocks.ready,authenticated:mocks.authenticated,user:mocks.authenticated?{id:mocks.subject,linkedAccounts:[...mocks.wallets,...(mocks.custom?[{type:'custom_auth'}]:[])]}:null,login:mocks.login,logout:mocks.logout}),useCreateWallet:()=>({createWallet:mocks.create}),useSigners:()=>({addSigners:mocks.grant})}));
const address=(n:string)=>'0x'+n.repeat(40);
const wallet=(n:string)=>({type:'wallet',id:`wallet-${n}`,address:address(n),chainType:'ethereum',connectorType:'embedded',walletClientType:'privy',imported:false});
const preparation={ownerSubject:'did:privy:owner',deployment:{version:1 as const,appId:'fixture-app',walletId:'wallet-1',address:address('1'),ownerId:'owner',signerId:'signer',policyId:'policy',factory:address('4')},revision:0,fingerprint:'a'.repeat(64)};
const ui=()=> <Entry preparation={preparation} onSelected={mocks.select} onBusy={mocks.busy}/>;
beforeEach(()=>{vi.clearAllMocks();mocks.ready=true;mocks.authenticated=true;mocks.subject='did:privy:owner';mocks.custom=false;mocks.wallets=[wallet('1')];mocks.create.mockResolvedValue(wallet('2'));mocks.grant.mockResolvedValue({user:{linkedAccounts:[wallet('1'),wallet('2')]}});});
it('never creates on mount and refuses sponsor/custom-auth or a different native owner',()=>{
 mocks.custom=true;const view=render(ui());expect(screen.getByRole('button',{name:'Switch Privy account'})).toBeVisible();expect(screen.queryByRole('button',{name:'Create deployment wallet · Privy'})).not.toBeInTheDocument();
 mocks.custom=false;mocks.subject='did:privy:other';view.rerender(ui());expect(screen.getByRole('status')).toHaveTextContent('does not own');expect(mocks.create).not.toHaveBeenCalled();expect(mocks.grant).not.toHaveBeenCalled();
 expect(mocks.provider.mock.calls[0][0].config.embeddedWallets.ethereum.createOnLogin).toBe('off');
});
it('creates an additional wallet, grants only after acknowledgement, and selects only after an explicit action',async()=>{
 render(ui());expect(mocks.create).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Create deployment wallet · Privy'}));
 await screen.findByText(address('2'));expect(mocks.create).toHaveBeenCalledWith({createAdditional:true});expect(mocks.grant).not.toHaveBeenCalled();
 const approve=screen.getByRole('button',{name:'Approve restricted access in Privy'});expect(approve).toBeDisabled();expect(screen.getByRole('button',{name:'Use this wallet for verification'})).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(approve);await screen.findByRole('button',{name:'Permission submitted'});
 expect(mocks.grant).toHaveBeenCalledWith({address:address('2'),signers:[{signerId:'signer',policyIds:['policy']}]});expect(mocks.select).not.toHaveBeenCalledWith('wallet-2');
 fireEvent.click(screen.getByRole('button',{name:'Use this wallet for verification'}));expect(mocks.select).toHaveBeenLastCalledWith('wallet-2');
});
it('can recover an existing wallet without creating another; canceled grant cannot select it',async()=>{
 mocks.wallets=[wallet('1'),wallet('2')];mocks.grant.mockRejectedValueOnce(Error('cancelled'));render(ui());
 fireEvent.change(screen.getByLabelText('Or use another wallet on this account'),{target:{value:address('2')}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve restricted access in Privy'}));
 await screen.findByRole('alert');expect(mocks.create).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Use this wallet for verification'})).toBeDisabled();expect(mocks.select).not.toHaveBeenCalledWith('wallet-2');
});
it('does not retry uncertain creation or allow a double-click to create two wallets',async()=>{
 let reject!:(reason:Error)=>void;mocks.create.mockImplementation(()=>new Promise((_resolve,no)=>{reject=no;}));render(ui());
 const create=screen.getByRole('button',{name:'Create deployment wallet · Privy'});fireEvent.click(create);fireEvent.click(create);expect(mocks.create).toHaveBeenCalledTimes(1);
 await act(async()=>reject(Error('timeout')));expect(await screen.findByRole('alert')).toHaveTextContent('Nothing has been activated');expect(create).toBeDisabled();
});
it('discard a late creation result after the Privy identity changes',async()=>{
 let resolve!:(value:unknown)=>void;mocks.create.mockImplementation(()=>new Promise(yes=>{resolve=yes;}));const view=render(ui());fireEvent.click(screen.getByRole('button',{name:'Create deployment wallet · Privy'}));
 mocks.subject='did:privy:other';view.rerender(ui());await act(async()=>resolve(wallet('2')));
 expect(screen.queryByText(address('2'))).not.toBeInTheDocument();expect(mocks.select).not.toHaveBeenCalledWith('wallet-2');expect(mocks.busy).toHaveBeenLastCalledWith(false);
});
it('does not hand off a wallet ID while provider metadata is still unavailable',async()=>{
 mocks.create.mockResolvedValue({...wallet('2'),id:null});mocks.grant.mockResolvedValue({user:{linkedAccounts:[]}});render(ui());fireEvent.click(screen.getByRole('button',{name:'Create deployment wallet · Privy'}));await screen.findByText(address('2'));
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Approve restricted access in Privy'}));await screen.findByRole('button',{name:'Permission submitted'});
 expect(screen.getByRole('button',{name:'Use this wallet for verification'})).toBeDisabled();expect(screen.getByText(/Waiting for Privy’s wallet ID/)).toBeVisible();
});
it('sign-in never creates a wallet or grants access',()=>{mocks.authenticated=false;render(ui());fireEvent.click(screen.getByRole('button',{name:'Sign in with Privy'}));expect(mocks.login).toHaveBeenCalledTimes(1);expect(mocks.create).not.toHaveBeenCalled();expect(mocks.grant).not.toHaveBeenCalled();});
