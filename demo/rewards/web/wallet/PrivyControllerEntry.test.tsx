import {act,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {StrictMode} from "react";
const mocks=vi.hoisted(()=>({ready:true,walletsReady:true,linkedWallet:false,authenticated:false,custom:false,login:vi.fn(),logout:vi.fn(),create:vi.fn(),provider:vi.fn(),token:vi.fn(),wallets:[] as unknown[]}));
vi.mock("@/lib/public-env",()=>({publicEnv:{rewardDemo:{chainId:10143},rewardPortalEnabled:true}}));
vi.mock("@privy-io/react-auth",()=>({PrivyProvider:(p:{children:React.ReactNode})=>{mocks.provider(p);return p.children;},
 usePrivy:()=>({ready:mocks.ready,authenticated:mocks.authenticated,login:mocks.login,logout:mocks.logout,user:mocks.authenticated?{id:"did:privy:fixture",linkedAccounts:mocks.custom?[{type:"custom_auth"}]:mocks.linkedWallet?[{type:"wallet",chainType:"ethereum",walletClientType:"privy"}]:[]}:null,getAccessToken:mocks.token}),
 useSignTransaction:()=>({signTransaction:vi.fn()}),useSigners:()=>({addSigners:vi.fn()}),
 useWallets:()=>({ready:mocks.walletsReady,wallets:mocks.wallets}),useCreateWallet:()=>({createWallet:mocks.create})}));
import Entry from "./PrivyControllerEntry";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
beforeEach(()=>{vi.clearAllMocks();mocks.ready=true;mocks.walletsReady=true;mocks.linkedWallet=false;mocks.authenticated=false;mocks.custom=false;mocks.wallets=[];vi.stubEnv("NEXT_PUBLIC_RACESON_REWARD_PRIVY_APP_ID","cmtx921we00fu0cifaab7exez");});
it("mounts direct Privy only after opt-in, with automatic wallet creation disabled",()=>{
 render(<Entry/>);expect(mocks.provider).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Continue with Privy"}));
 expect(mocks.provider.mock.calls[0][0].config.embeddedWallets.ethereum.createOnLogin).toBe("off");
 fireEvent.click(screen.getByRole("button",{name:"Sign in with Privy"}));expect(mocks.login).toHaveBeenCalledTimes(1);expect(mocks.create).not.toHaveBeenCalled();
});
it("does not create a substitute wallet or switch accounts for a reviewer awaiting handover",async()=>{
 mocks.authenticated=true;mocks.custom=true;render(<Entry/>);fireEvent.click(screen.getByRole("button",{name:"Continue with Privy"}));
 expect(screen.getByRole("heading",{name:"Reviewer wallet ownership"})).toBeVisible();expect(screen.getByRole('link',{name:'Back to award review'})).toHaveAttribute('href','/rewards/review');
 expect(screen.queryByRole("button",{name:"Create controller wallet · Privy"})).not.toBeInTheDocument();expect(mocks.logout).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
});
it('uses a retained reviewer wallet session without another login, while the server enforces assignment',async()=>{
 mocks.authenticated=true;mocks.custom=true;mocks.token.mockResolvedValue('reviewer-token');mocks.wallets=[{address:'0x1111111111111111111111111111111111111111',walletClientType:'privy',connectorType:'embedded',linked:true,imported:false}];
 const fetch=vi.fn().mockResolvedValue({ok:false,json:async()=>({error:{code:'controller_auth_required'}})});vi.stubGlobal('fetch',fetch);
 render(<Entry/>);fireEvent.click(screen.getByRole('button',{name:'Continue with Privy'}));await waitFor(()=>expect(fetch).toHaveBeenCalled());
 expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer reviewer-token');expect(mocks.login).not.toHaveBeenCalled();expect(mocks.logout).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
});
it("creates a wallet only on the signed-in controller's explicit action",async()=>{
 mocks.authenticated=true;render(<Entry/>);fireEvent.click(screen.getByRole("button",{name:"Continue with Privy"}));
 expect(mocks.create).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Create controller wallet · Privy"}));await waitFor(()=>expect(mocks.create).toHaveBeenCalledTimes(1));
});
it("keeps a signed-in wallet current through Strict Mode effect replay",async()=>{
 mocks.authenticated=true;mocks.token.mockResolvedValue("test-token");
 mocks.wallets=[{address:"0x1111111111111111111111111111111111111111",walletClientType:"privy",connectorType:"embedded",linked:true,imported:false}];
 const fetch=vi.fn().mockResolvedValue({ok:false,json:async()=>({error:{code:"controller_not_configured"}})});
 vi.stubGlobal("fetch",fetch);
 render(<StrictMode><Entry/></StrictMode>);
 fireEvent.click(screen.getByRole("button",{name:"Continue with Privy"}));
 await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("Wallet connected. Controller access still needs to be enabled"));
 expect(fetch).toHaveBeenCalled();
 expect(screen.queryByText(/Your account or wallet changed/)).not.toBeInTheDocument();
});
it("does not send a pending authenticated request after leaving Control",async()=>{
 mocks.authenticated=true;
 let resolveToken!:(token:string)=>void;
 mocks.token.mockImplementation(()=>new Promise<string>(resolve=>{resolveToken=resolve;}));
 mocks.wallets=[{address:"0x1111111111111111111111111111111111111111",walletClientType:"privy",connectorType:"embedded",linked:true,imported:false}];
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 const view=render(<Entry/>);fireEvent.click(screen.getByRole("button",{name:"Continue with Privy"}));
 expect(mocks.token).toHaveBeenCalled();view.unmount();resolveToken("test-token");
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(fetch).not.toHaveBeenCalled();
});
it("offers retry after stalled wallet initialization and preserves the existing account",async()=>{
 vi.useFakeTimers();mocks.authenticated=true;mocks.walletsReady=false;
 mocks.wallets=[{address:"0x1111111111111111111111111111111111111111",walletClientType:"privy",connectorType:"embedded",linked:true,imported:false}];
 mocks.token.mockResolvedValue("test-token");
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,json:async()=>({error:{code:"controller_not_configured"}})}));
 render(<Entry/>);fireEvent.click(screen.getByRole("button",{name:"Continue with Privy"}));
 expect(screen.getByRole("status")).toHaveTextContent("Connecting your controller wallet");
 expect(mocks.token).not.toHaveBeenCalled();expect(screen.queryByRole("button",{name:"Create controller wallet · Privy"})).not.toBeInTheDocument();
 await act(()=>vi.advanceTimersByTimeAsync(15_000));
 expect(screen.getByRole("status")).toHaveTextContent("Wallet connection paused");
 mocks.walletsReady=true;
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Retry connection"}));});
 expect(screen.getByRole("alert")).toHaveTextContent("Wallet connected");
 fireEvent.click(screen.getByText("Account details"));expect(screen.getByText("did:privy:fixture")).toBeVisible();
 expect(mocks.create).not.toHaveBeenCalled();expect(mocks.logout).not.toHaveBeenCalled();
});
it("never offers a replacement wallet when an existing embedded wallet is disconnected",()=>{
 mocks.authenticated=true;mocks.linkedWallet=true;
 render(<Entry/>);fireEvent.click(screen.getByRole("button",{name:"Continue with Privy"}));
 expect(screen.getByRole("button",{name:"Retry connection"})).toBeVisible();
 expect(screen.queryByRole("button",{name:"Create controller wallet · Privy"})).not.toBeInTheDocument();
 expect(mocks.create).not.toHaveBeenCalled();
});
it("clears the loading timer when the wallet becomes ready",async()=>{
 vi.useFakeTimers();mocks.authenticated=true;mocks.walletsReady=false;
 const view=render(<Entry/>);fireEvent.click(screen.getByRole("button",{name:"Continue with Privy"}));
 await act(()=>vi.advanceTimersByTimeAsync(5_000));mocks.walletsReady=true;view.rerender(<Entry/>);
 await act(()=>vi.advanceTimersByTimeAsync(15_000));
 expect(screen.getByRole("button",{name:"Create controller wallet · Privy"})).toBeVisible();
 expect(screen.queryByRole("button",{name:"Retry connection"})).not.toBeInTheDocument();
});
it('carries a selected historical controller to the authenticated API request',async()=>{
 window.history.replaceState({},'', '/rewards/control?wallet=0x2222222222222222222222222222222222222222');
 mocks.authenticated=true;mocks.token.mockResolvedValue('test-token');
 mocks.wallets=[{address:'0x2222222222222222222222222222222222222222',walletClientType:'privy',connectorType:'embedded',linked:true,imported:false}];
 const fetch=vi.fn().mockResolvedValue({ok:false,json:async()=>({error:{code:'controller_not_configured'}})});vi.stubGlobal('fetch',fetch);
 render(<Entry/>);fireEvent.click(screen.getByRole('button',{name:'Continue with Privy'}));
 await waitFor(()=>expect(fetch).toHaveBeenCalled());
 expect(fetch.mock.calls[0][1].headers['X-Podium-Controller-Wallet']).toBe('0x2222222222222222222222222222222222222222');
 window.history.replaceState({},'', '/');
});

it('keeps the native controller account menu separate and retires pending access on sign out',async()=>{
 mocks.authenticated=true;let resolveToken!:(token:string)=>void;
 mocks.token.mockImplementation(()=>new Promise<string>(resolve=>{resolveToken=resolve;}));
 mocks.wallets=[{address:'0x1111111111111111111111111111111111111111',walletClientType:'privy',connectorType:'embedded',linked:true,imported:false}];
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 render(<Entry/>);fireEvent.click(screen.getByRole('button',{name:'Continue with Privy'}));
 expect(within(screen.getByRole('navigation',{name:'Main navigation'})).getByRole('link',{name:'Review'})).toHaveAttribute('href','/rewards/control');
 fireEvent.click(screen.getByLabelText('Account menu'));
 const menu=within(screen.getByLabelText('Account menu').closest('details')!);
 expect(menu.getAllByRole('link').map(link=>link.textContent)).toEqual(['Profile','Wallet']);
 expect(menu.getByRole('link',{name:'Wallet'})).toHaveAttribute('href','#controller-wallet');
 fireEvent.click(menu.getByRole('button',{name:'Sign out'}));await waitFor(()=>expect(mocks.logout).toHaveBeenCalledTimes(1));
 await act(async()=>{resolveToken('synthetic-token');});
 expect(fetch).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
});
