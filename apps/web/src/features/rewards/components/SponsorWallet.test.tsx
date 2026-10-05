import {act, fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, expect, it, vi} from 'vitest';
import SponsorWallet from './SponsorWallet';
import type {RewardEmbeddedState} from './RewardEmbeddedWalletContext';
const mocks=vi.hoisted(()=>({wallets:[] as unknown[],embedded:{status:'off',wallet:null,enable:vi.fn()} as RewardEmbeddedState,calls:vi.fn()}));
vi.mock('./RewardEmbeddedWalletContext',()=>({useRewardWallets:(open:boolean)=>{mocks.calls(open);return open?mocks.wallets:[];},useRewardEmbeddedWallet:()=>mocks.embedded}));
const address='0x'+'ab'.repeat(20);
function provider(){const listeners=new Map<string,()=>void>();return {on:vi.fn((key:string,cb:()=>void)=>listeners.set(key,cb)),removeListener:vi.fn((key:string)=>listeners.delete(key)),
 request:vi.fn(async({method}:{method:string}):Promise<unknown>=>method==='eth_chainId'?'0x279f':[address]),listeners};}
beforeEach(()=>{vi.clearAllMocks();mocks.wallets=[];mocks.embedded={status:'off',wallet:null,enable:vi.fn()};});
async function choose(){fireEvent.click(screen.getByRole('button',{name:'Advanced · external wallet'}));fireEvent.change(screen.getByLabelText('Existing wallet'),{target:{value:'browser'}});fireEvent.click(screen.getByRole('button',{name:'Connect wallet'}));}
it('discovers only on explicit entry, tolerates the permission event, and never signs or sends',async()=>{
 const p=provider();p.request.mockImplementation(async({method})=>{if(method==='eth_requestAccounts')p.listeners.get('accountsChanged')?.();return method==='eth_chainId'?'0x279f':[address];});
 mocks.wallets=[{id:'browser',name:'Test wallet',provider:p}];render(<SponsorWallet chainId={10143} hr={false}/>);
 expect(mocks.calls).toHaveBeenLastCalledWith(false);expect(p.request).not.toHaveBeenCalled();await choose();
 await screen.findByText(/Connected for this visit/);expect(screen.getByText(new RegExp(address))).toBeVisible();
 expect(p.request.mock.calls.map(([r])=>r.method)).toEqual(['eth_requestAccounts','eth_accounts','eth_chainId']);
 act(()=>p.listeners.get('accountsChanged')?.());expect(screen.queryByText(new RegExp(address))).not.toBeInTheDocument();
});
it('rejects mainnet and drops an in-flight connection on unmount',async()=>{
 const p=provider();p.request.mockResolvedValueOnce([address]).mockResolvedValueOnce([address]).mockResolvedValueOnce('0x1');
 mocks.wallets=[{id:'browser',name:'Test wallet',provider:p}];const page=render(<SponsorWallet chainId={10143} hr={false}/>);await choose();
 await screen.findByRole('alert');expect(screen.queryByText(/Connected for this visit/)).not.toBeInTheDocument();
 let reply!:(v:string[])=>void;p.request.mockImplementationOnce(()=>new Promise(resolve=>reply=resolve));fireEvent.click(screen.getByRole('button',{name:'Connect wallet'}));page.unmount();
 await act(async()=>reply([address]));expect(p.request).toHaveBeenCalledTimes(4);expect(p.removeListener).toHaveBeenCalledTimes(3);
});

it('places Privy first and connects an existing Privy wallet with one click after initialization',async()=>{
 const p=provider(), enable=vi.fn(), onWallet=vi.fn();
 mocks.embedded={status:'off',wallet:null,enable};
 const page=render(<SponsorWallet chainId={10143} hr={false} onWallet={onWallet}/>);
 expect(screen.getAllByRole('button').map(button=>button.textContent)).toEqual(['Continue with Privy','Advanced · external wallet']);
 expect(screen.queryByLabelText('Existing wallet')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Continue with Privy'}));expect(enable).toHaveBeenCalledTimes(1);
 mocks.embedded={status:'loading',wallet:null};page.rerender(<SponsorWallet chainId={10143} hr={false} onWallet={onWallet}/>);
 expect(screen.getByRole('button',{name:'Opening Privy…'})).toBeDisabled();expect(p.request).not.toHaveBeenCalled();
 const wallet={id:'privy:test',name:'Privy',provider:p};mocks.embedded={status:'ready',wallet,address};
 page.rerender(<SponsorWallet chainId={10143} hr={false} onWallet={onWallet}/>);
 await screen.findByText('Privy wallet connected');expect(onWallet).toHaveBeenLastCalledWith({wallet,address});
 expect(p.request.mock.calls.map(([r])=>r.method)).toEqual(['eth_requestAccounts','eth_accounts','eth_chainId']);
 expect(mocks.calls).toHaveBeenLastCalledWith(false);
 act(()=>p.listeners.get('disconnect')?.());expect(onWallet).toHaveBeenLastCalledWith(null);
 expect(screen.queryByText('Privy wallet connected')).not.toBeInTheDocument();expect(p.request).toHaveBeenCalledTimes(3);
});
it('requires explicit creation as the second click, then connects without the existing-wallet selector',async()=>{
 const p=provider(), create=vi.fn(async()=>{});
 const page=render(<SponsorWallet chainId={10143} hr={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Continue with Privy'}));
 mocks.embedded={status:'ready',wallet:null,create};page.rerender(<SponsorWallet chainId={10143} hr={false}/>);
 expect(create).not.toHaveBeenCalled();expect(p.request).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Create my Privy wallet'}));expect(create).toHaveBeenCalledTimes(1);
 mocks.embedded={status:'loading',wallet:null};page.rerender(<SponsorWallet chainId={10143} hr={false}/>);
 mocks.embedded={status:'ready',wallet:{id:'privy:test',name:'Privy',provider:p},address};
 page.rerender(<SponsorWallet chainId={10143} hr={false}/>);
 await screen.findByText('Privy wallet connected');expect(screen.queryByLabelText('Existing wallet')).not.toBeInTheDocument();
 expect(p.request).toHaveBeenCalledTimes(3);
});
it('does not connect a ready Privy wallet until chosen, or after switching to existing wallets',async()=>{
 const p=provider(), wallet={id:'privy:test',name:'Privy',provider:p};mocks.embedded={status:'ready',wallet,address};
 const page=render(<SponsorWallet chainId={10143} hr={false}/>);expect(p.request).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Continue with Privy'}));await screen.findByText('Privy wallet connected');
 page.unmount();p.request.mockClear();mocks.embedded={status:'off',wallet:null,enable:vi.fn()};
 const second=render(<SponsorWallet chainId={10143} hr={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Continue with Privy'}));
 fireEvent.click(screen.getByRole('button',{name:'Advanced · external wallet'}));
 mocks.embedded={status:'ready',wallet,address};second.rerender(<SponsorWallet chainId={10143} hr={false}/>);
 expect(p.request).not.toHaveBeenCalled();expect(screen.getByLabelText('Existing wallet')).toBeVisible();
});
it('shows Privy recovery and connects on an explicit retry',async()=>{
 const p=provider(), retry=vi.fn();mocks.embedded={status:'error',wallet:null,enable:retry};
 const page=render(<SponsorWallet chainId={10143} hr={false}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('Privy could not open your wallet');
 fireEvent.click(screen.getByRole('button',{name:'Try Privy again'}));expect(retry).toHaveBeenCalledTimes(1);
 mocks.embedded={status:'ready',wallet:{id:'privy:test',name:'Privy',provider:p},address};page.rerender(<SponsorWallet chainId={10143} hr={false}/>);
 await screen.findByText('Privy wallet connected');
});
it('explains browser initialization timeouts without offering another wallet creation',()=>{
 mocks.embedded={status:'error',wallet:null,errorReason:'initialization_timeout',enable:vi.fn()};
 render(<SponsorWallet chainId={10143} hr={false}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('Open this campaign in Chrome and sign in to the same RacesOn account');
 expect(screen.queryByRole('button',{name:'Create my Privy wallet'})).not.toBeInTheDocument();
 expect(mocks.embedded.enable).not.toHaveBeenCalled();
});
it('clears the funding preview when the Privy session/provider changes and rejects wrong networks',async()=>{
 const p=provider(), onWallet=vi.fn();mocks.embedded={status:'ready',wallet:{id:'privy:test',name:'Privy',provider:p},address};
 const page=render(<SponsorWallet chainId={10143} hr={false} onWallet={onWallet}/>);
 fireEvent.click(screen.getByRole('button',{name:'Continue with Privy'}));await screen.findByText('Privy wallet connected');
 mocks.embedded={status:'loading',wallet:null};page.rerender(<SponsorWallet chainId={10143} hr={false} onWallet={onWallet}/>);
 expect(onWallet).toHaveBeenLastCalledWith(null);expect(screen.queryByText('Privy wallet connected')).not.toBeInTheDocument();
 p.request.mockImplementation(async({method})=>method==='eth_chainId'?'0x1':[address]);
 mocks.embedded={status:'ready',wallet:{id:'privy:new',name:'Privy',provider:p},address};page.rerender(<SponsorWallet chainId={10143} hr={false} onWallet={onWallet}/>);
 expect(p.request).toHaveBeenCalledTimes(3);
 fireEvent.click(screen.getByRole('button',{name:'Continue with Privy'}));await screen.findByRole('alert');
 expect(onWallet).toHaveBeenLastCalledWith(null);
});
it('keeps external wallets available when Privy is unconfigured or the campaign is local simulation',()=>{
 mocks.embedded={status:'unconfigured',wallet:null};const page=render(<SponsorWallet chainId={10143} hr={false}/>);
 expect(screen.getByText(/Privy is unavailable/)).toBeVisible();expect(screen.queryByRole('button',{name:'Continue with Privy'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Advanced · external wallet'}));expect(screen.getByLabelText('Existing wallet')).toBeVisible();
 page.rerender(<SponsorWallet chainId={31337} hr={false}/>);expect(screen.queryByText('Privy wallet')).not.toBeInTheDocument();
});

it.each(['operator', 'recipient'] as const)('defaults the %s picker to Privy and explains an assigned-wallet mismatch', async purpose => {
 const p=provider(), wallet={id:'privy:test',name:'Privy',provider:p}, onWallet=vi.fn();
 mocks.embedded={status:'ready',wallet,address};mocks.wallets=[wallet,{id:'browser',name:'External',provider:provider()}];
 render(<SponsorWallet chainId={10143} hr={false} purpose={purpose} requiredAddress={'0x'+'cd'.repeat(20)} onWallet={onWallet}/>);
 expect(screen.getByRole('button',{name:'Advanced · external wallet'})).toHaveAttribute('aria-expanded','false');
 expect(mocks.calls).toHaveBeenLastCalledWith(false);
 fireEvent.click(screen.getByRole('button',{name:'Continue with Privy'}));
 await screen.findByText(/does not match the wallet assigned/);
 expect(onWallet).toHaveBeenLastCalledWith({wallet,address});
 expect(p.request.mock.calls.map(([r])=>r.method)).toEqual(['eth_requestAccounts','eth_accounts','eth_chainId']);
 fireEvent.click(screen.getByRole('button',{name:'Advanced · external wallet'}));
 expect(onWallet).toHaveBeenLastCalledWith(null);
 expect(screen.queryByRole('option',{name:'Privy'})).not.toBeInTheDocument();
 expect(screen.getByRole('option',{name:'External'})).toBeVisible();
});


it('keeps a compact connected wallet visible once and preserves connection when options collapse',async()=>{
 const p=provider(), onWallet=vi.fn();
 const wallet={id:'privy:test',name:'Privy',provider:p};mocks.embedded={status:'ready',wallet,address};
 render(<SponsorWallet compact chainId={10143} hr={false} onWallet={onWallet}/>);
 fireEvent.click(screen.getByRole('button',{name:'Continue with Privy'}));
 await screen.findByText('Privy wallet connected and ready to use.');
 expect(screen.getByRole('link',{name:address})).toBeVisible();
 expect(screen.queryByRole('button',{name:'Advanced · external wallet'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Change'}));
 expect(screen.getByRole('link',{name:address})).toBeVisible();
 expect(screen.getByRole('button',{name:'Advanced · external wallet'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Done'}));
 expect(screen.getByRole('link',{name:address})).toBeVisible();
 expect(onWallet).toHaveBeenLastCalledWith({wallet,address});expect(p.request).toHaveBeenCalledTimes(3);
 act(()=>p.listeners.get('disconnect')?.());
 expect(onWallet).toHaveBeenLastCalledWith(null);expect(screen.getByRole('button',{name:'Continue with Privy'})).toBeVisible();
});

it('shows funding funds on connection and rereads them after a verified deposit without reconnecting',async()=>{
 const listeners=new Map<string,Set<()=>void>>();let balance='0x1bc16d674ec80000';
 const p={on:vi.fn((event:string,cb:()=>void)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(cb);}),removeListener:vi.fn((event:string,cb:()=>void)=>listeners.get(event)?.delete(cb)),
  request:vi.fn(async({method}:{method:string})=>method==='eth_chainId'?'0x279f':method==='eth_getBalance'?balance:[address])};
 const wallet={id:'privy:test',name:'Privy',provider:p};mocks.embedded={status:'ready',wallet,address};
 const page=render(<SponsorWallet compact showBalance chainId={10143} hr={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Continue with Privy'}));
 await screen.findByRole('button',{name:'Refresh balance'});
 expect(screen.getByLabelText('Funding wallet funds')).toHaveTextContent('2 test MON');
 expect(screen.getByRole('link',{name:address})).toBeVisible();
 balance='0x0';page.rerender(<SponsorWallet compact showBalance balanceRevision={'0x'+'aa'.repeat(32)} chainId={10143} hr={false}/>);
 await screen.findByRole('button',{name:'Refresh balance'});
 expect(screen.getByLabelText('Funding wallet funds')).toHaveTextContent('0 test MON');
 expect(p.request.mock.calls.filter(([call])=>call.method==='eth_requestAccounts')).toHaveLength(1);
 act(()=>Array.from(listeners.get('disconnect')??[]).forEach(listener=>listener()));
 expect(screen.queryByLabelText('Funding wallet funds')).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:address})).not.toBeInTheDocument();
 expect(p.request.mock.calls.every(([call])=>['eth_requestAccounts','eth_accounts','eth_chainId','eth_getBalance'].includes(call.method))).toBe(true);
});
