import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, useState, type ReactNode } from "react";
import PrivyRewardRuntime from "./PrivyRewardRuntime";
import RewardEmbeddedWalletControls from "@/features/rewards/components/RewardEmbeddedWalletControls";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { RewardEmbeddedWalletContext, type RewardEmbeddedState } from "@/features/rewards/components/RewardEmbeddedWalletContext";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), sendProgramme: vi.fn(), auth: { user: { id: "demo-user" }, account: { userId: "demo-user", hasAthleteAccess: true },
  session: { access_token: "synthetic" }, isLoading: false }, walletList: [] as unknown[], walletsReady: true, authenticated: true,
  customUserId: "demo-user", privyUserId: "privy-demo-user", privyReady: true, linkedWallet: false, jwtStatus: "done", unstableCreate: false, provider: vi.fn(), sync: vi.fn(), create: vi.fn(), token: vi.fn(), logout: vi.fn() }));
vi.mock("@/features/rewards/data/sponsorProgrammeWallet", () => ({sendProgrammeTransaction: mocks.sendProgramme}));
vi.mock("@/lib/auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/supabase", () => ({ getSupabaseBrowserClient: () => ({ auth: {} }) }));
vi.mock("@/features/rewards/data/privyAuthToken", () => ({ getRewardPrivyToken: mocks.token }));
vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: (props: { children: ReactNode }) => {
    mocks.provider(props);
    if (mocks.unstableCreate && mocks.provider.mock.calls.length > 30) throw new Error("Wallet provider render loop");
    return props.children;
  },
  usePrivy: () => ({ ready: mocks.privyReady, authenticated: mocks.authenticated, logout: mocks.logout, user: { id: mocks.privyUserId, linkedAccounts: [{ type: "custom_auth", customUserId: mocks.customUserId }, ...(mocks.linkedWallet ? [{ type:"wallet",chainType:"ethereum",walletClientType:"privy" }] : [])] } }),
  useAuthorizationSignature: () => ({generateAuthorizationSignature:mocks.authorize}),
  useWallets: () => ({ ready: mocks.walletsReady, wallets: mocks.walletList }),
  useCreateWallet: () => {
    const create = mocks.create;
    return { createWallet: mocks.unstableCreate ? (...args: unknown[]) => create(...args) : create };
  },
  useSubscribeToJwtAuthWithFlag: (props: unknown) => { mocks.sync(props); return { state: { status: mocks.jwtStatus } }; },
}));
const configuration = { appId: "c".repeat(25), origin: "http://127.0.0.1:3102", issuer: "http://127.0.0.1:55321/auth/v1" };
function Harness({ locale, sessionKey }: { locale: "en" | "hr"; sessionKey: string }) {
  const [state, setState] = useState<RewardEmbeddedState>({ status: "loading", wallet: null });
  const onState = useCallback((_key: string, value: RewardEmbeddedState) => setState(value), []);
  return <I18nProvider initialLocale={locale}><RewardEmbeddedWalletContext.Provider value={state}>
    <RewardEmbeddedWalletControls /><PrivyRewardRuntime configuration={configuration} sessionKey={sessionKey} walletUserId="demo-user" onState={onState} />
  </RewardEmbeddedWalletContext.Provider></I18nProvider>;
}
const view = (locale: "en" | "hr" = "en", sessionKey = "test-session") => <Harness locale={locale} sessionKey={sessionKey} />;
beforeEach(() => {
  vi.clearAllMocks(); mocks.walletList = []; mocks.walletsReady = true; mocks.customUserId = "demo-user"; mocks.privyUserId = "privy-demo-user"; mocks.authenticated = true; mocks.jwtStatus = "done"; mocks.unstableCreate = false;
  mocks.auth.isLoading = false; mocks.auth.account.hasAthleteAccess = true; mocks.auth.session = { access_token: "synthetic" }; mocks.token.mockResolvedValue("synthetic");
  mocks.create.mockResolvedValue({ address: `0x${"ab".repeat(20)}` });
  mocks.privyReady = true; mocks.linkedWallet = false; mocks.logout.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
describe("isolated Privy SDK adapter (mock provider, not acceptance)", () => {
  it("waits for Privy hydration, then ends a foreign session before releasing the next JWT", async () => {
    mocks.privyReady=false; mocks.customUserId="previous-athlete";
    const page=render(view());
    expect(mocks.sync.mock.lastCall?.[0].enabled).toBe(false);
    expect(await mocks.sync.mock.lastCall?.[0].getExternalJwt()).toBeUndefined();
    expect(mocks.logout).not.toHaveBeenCalled();
    mocks.privyReady=true;page.rerender(view("en","hydrated"));await act(async()=>{});
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(mocks.sync.mock.lastCall?.[0].enabled).toBe(false);
    expect(await mocks.sync.mock.lastCall?.[0].getExternalJwt()).toBeUndefined();
    expect(mocks.token).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
    mocks.authenticated=false;page.rerender(view("en","privy-cleared"));await act(async()=>{});
    expect(mocks.sync.mock.lastCall?.[0].enabled).toBe(true);
    expect(await mocks.sync.mock.lastCall?.[0].getExternalJwt()).toBe("synthetic");
    mocks.authenticated=true;mocks.customUserId="demo-user";page.rerender(view("en","new-identity"));await act(async()=>{});
    expect(screen.getByRole("button",{name:"Create my Privy wallet"})).toBeVisible();
    expect(mocks.logout).toHaveBeenCalledTimes(1);expect(mocks.create).not.toHaveBeenCalled();
  });
  it("keeps the same wallet binding when Auth re-emits identical session credentials", async () => {
    const address = `0x${"ab".repeat(20)}`;
    mocks.auth.session = { access_token: "synthetic", refresh_token: "synthetic-refresh",
      user: { id: "demo-user" }, expires_at: 9999999999, token_type: "bearer" } as typeof mocks.auth.session;
    const provider = { request: vi.fn().mockResolvedValue([address]), on: vi.fn(), removeListener: vi.fn() };
    mocks.walletList = [{ address, walletClientType: "privy", connectorType: "embedded", linked: true, imported: false,
      getEthereumProvider: async () => provider }];
    const onState = vi.fn();
    const runtime = (key: string) => <PrivyRewardRuntime configuration={configuration} sessionKey={key} walletUserId="demo-user" onState={onState} />;
    const page = render(runtime("before-focus")); await act(async () => {});
    const binding = onState.mock.lastCall?.[1].wallet; expect(binding).not.toBeNull();
    mocks.auth.session = { ...mocks.auth.session }; mocks.auth.user = { id: "demo-user" };
    page.rerender(runtime("after-focus")); await act(async () => {});
    expect(onState.mock.lastCall?.[1].wallet).toBe(binding);
    expect(provider.removeListener).not.toHaveBeenCalled();
    await expect(binding.provider.request({ method: "eth_accounts" })).resolves.toEqual([address]);
  });
  it("bounds stalled wallet initialization and retries without creating a wallet or changing Auth", async () => {
    vi.useFakeTimers(); mocks.walletsReady = false; mocks.linkedWallet = true;
    const session = mocks.auth.session;
    const page = render(view());
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Privy did not finish loading in this browser");
    fireEvent.click(screen.getByRole("button", { name: "Connect with Privy" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.auth.session).toBe(session); expect(mocks.create).not.toHaveBeenCalled();
    const address = `0x${"ab".repeat(20)}`;
    mocks.walletsReady = true;
    mocks.walletList = [{ address, walletClientType: "privy", connectorType: "embedded", linked: true, imported: false,
      getEthereumProvider: async () => ({ request: vi.fn(), on: vi.fn(), removeListener: vi.fn() }) }];
    page.rerender(view("en", "recovered")); await act(async () => {});
    expect(screen.getByText(address)).toBeVisible();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("retains the verified binding during same-session SDK JWT resynchronization, but retires it on error", async () => {
    const address = `0x${"ab".repeat(20)}`;
    const provider = { request: vi.fn().mockResolvedValue([address]), on: vi.fn(), removeListener: vi.fn() };
    mocks.walletList = [{ address, walletClientType: "privy", connectorType: "embedded", linked: true, imported: false,
      getEthereumProvider: async () => provider }];
    const onState = vi.fn();
    const runtime = (key: string) => <PrivyRewardRuntime configuration={configuration} sessionKey={key} walletUserId="demo-user" onState={onState} />;
    mocks.jwtStatus = "loading";
    const page = render(runtime("initial"));
    await act(async () => {});
    expect(onState.mock.lastCall?.[1].wallet).toBeNull();
    mocks.jwtStatus = "done"; page.rerender(runtime("bound"));
    await act(async () => {});
    const binding = onState.mock.lastCall?.[1].wallet;
    expect(binding).not.toBeNull();
    mocks.jwtStatus = "loading"; page.rerender(runtime("modal-open"));
    await act(async () => {});
    expect(onState.mock.lastCall?.[1].wallet).toBe(binding);
    expect(provider.removeListener).not.toHaveBeenCalled();
    await expect(binding.provider.request({ method: "eth_accounts" })).resolves.toEqual([address]);
    mocks.jwtStatus = "error"; page.rerender(runtime("auth-failed"));
    await act(async () => {});
    expect(onState.mock.lastCall?.[1].wallet).toBeNull();
    await expect(binding.provider.request({ method: "eth_accounts" })).rejects.toMatchObject({ code: "wallet_changed" });
    mocks.jwtStatus = "loading"; page.rerender(runtime("retry-must-verify"));
    await act(async () => {});
    expect(onState.mock.lastCall?.[1].wallet).toBeNull();
  });
  it.each(["session", "privy-user", "custom-user", "logout"])("invalidates a verified binding on %s change during JWT loading", async change => {
    const address = `0x${"ab".repeat(20)}`;
    mocks.walletList = [{ address, walletClientType: "privy", connectorType: "embedded", linked: true, imported: false,
      getEthereumProvider: async () => ({ request: vi.fn(), on: vi.fn(), removeListener: vi.fn() }) }];
    const onState = vi.fn();
    const runtime = (key: string) => <PrivyRewardRuntime configuration={configuration} sessionKey={key} walletUserId="demo-user" onState={onState} />;
    const page = render(runtime("initial")); await act(async () => {});
    const binding = onState.mock.lastCall?.[1].wallet;
    expect(binding).not.toBeNull();
    mocks.jwtStatus = "loading";
    if (change === "session") mocks.auth.session = { access_token: "other-synthetic-session" };
    if (change === "privy-user") mocks.privyUserId = "other-privy-user";
    if (change === "custom-user") mocks.customUserId = "other-user";
    if (change === "logout") mocks.authenticated = false;
    page.rerender(runtime("changed")); await act(async () => {});
    expect(onState.mock.lastCall?.[1].wallet).toBeNull();
    await expect(binding.provider.request({ method: "eth_accounts" })).rejects.toMatchObject({ code: "wallet_changed" });
  });
  it("settles with a fresh SDK creation callback each render and invokes the latest callback only on click", async () => {
    mocks.unstableCreate = true;
    const page = render(view());
    expect(screen.getByRole("button", { name: "Create my Privy wallet" })).toBeVisible();
    expect(mocks.provider.mock.calls.length).toBeLessThan(10);
    const providerConfig = mocks.provider.mock.calls[0][0].config;
    const renderCount = mocks.provider.mock.calls.length;
    page.rerender(view());
    expect(mocks.provider.mock.calls.length).toBe(renderCount);
    const latestCreate = vi.fn().mockResolvedValue({});
    const originalCreate = mocks.create;
    mocks.create = latestCreate;
    page.rerender(view("en", "next-session"));
    expect(mocks.provider.mock.calls.every(([props]) => props.config === providerConfig)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Create my Privy wallet" }));
    await act(async () => {});
    expect(latestCreate).toHaveBeenCalledExactlyOnceWith();
    expect(originalCreate).not.toHaveBeenCalled();
    mocks.create = originalCreate;
  });
  it("does not offer a second wallet when an existing embedded wallet is disconnected", async () => {
    mocks.linkedWallet = true; mocks.walletList = [];
    render(view()); await screen.findByRole("alert");
    expect(screen.queryByRole("button", {name: "Create my Privy wallet"})).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("keeps automatic creation off and makes one explicit user-owned request", async () => {
    render(view()); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.provider.mock.calls[0][0]).toMatchObject({ appId: configuration.appId, config: {
      defaultChain: { id: 10143, blockExplorers: { default: { url: "https://testnet.monadvision.com" } } }, supportedChains: [{ id: 10143 }],
      embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" }, showWalletUIs: true },
    } });
    fireEvent.click(screen.getByRole("button", { name: "Create my Privy wallet" }));
    await act(async () => {});
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(); // No additional signer or backend owner.
  });
  it("does not create a wallet if the RacesOn session expires", async () => {
    mocks.token.mockResolvedValue(undefined); render(view());
    fireEvent.click(screen.getByRole("button", { name: "Create my Privy wallet" }));
    await screen.findByRole("alert"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not expose another Privy user's wallet or sign-in method", () => {
    mocks.customUserId = "different-user"; render(view());
    expect(screen.queryByRole("button", { name: "Create my Privy wallet" })).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("recovers an existing linked wallet without creating another, then hides it on logout", async () => {
    const address = `0x${"ab".repeat(20)}`, on = vi.fn(), removeListener = vi.fn();
    mocks.walletList = [{ address, type: "ethereum", walletClientType: "privy", connectorType: "embedded", linked: true, imported: false,
      getEthereumProvider: async () => ({ request: vi.fn(), on, removeListener }) }];
    const page = render(view("hr")); expect(await screen.findByText(address)).toBeVisible();
    expect(mocks.create).not.toHaveBeenCalled(); expect(on).toHaveBeenCalledTimes(3);
    mocks.auth.isLoading = true; page.rerender(view("hr", "signed-out"));
    expect(screen.queryByText(address)).not.toBeInTheDocument();
    expect(removeListener).toHaveBeenCalledTimes(3);
    expect(mocks.sync.mock.lastCall?.[0]).toMatchObject({ isAuthenticated: false });
    expect(await mocks.sync.mock.lastCall?.[0].getExternalJwt()).toBeUndefined();
  });
  it("leaves creation unavailable when JWT integration is not enabled", () => {
    mocks.jwtStatus = "not-enabled"; render(view());
    expect(screen.getByRole("alert")).toHaveTextContent("Wallet access could not be verified");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

it("lets an authenticated sponsor explicitly create a wallet without an athlete role", async () => {
  mocks.auth.account.hasAthleteAccess = false;
  render(view());
  fireEvent.click(await screen.findByRole("button", { name: "Create my Privy wallet" }));
  await act(async () => {});
  expect(mocks.create).toHaveBeenCalledOnce();
});

it("routes operator transactions through the validated Privy capability and rejects foreign addresses, chains and retired sessions", async () => {
 const address = `0x${"ab".repeat(20)}`;
 const provider = {request: vi.fn(), on: vi.fn(), removeListener: vi.fn()};
 mocks.walletList = [{address, walletClientType: "privy", connectorType: "embedded", linked: true, imported: false, getEthereumProvider: async () => provider}];
 const onState=vi.fn();
 let sessionKey="operator";
 const runtime=()=> <PrivyRewardRuntime configuration={configuration} sessionKey={sessionKey} walletUserId="demo-user" onState={onState}/>;
 const page=render(runtime());await act(async()=>{});
 const binding=onState.mock.lastCall?.[1].wallet;
 const view={transaction:{from:address,chainId:10143}};
 mocks.sendProgramme.mockImplementation(async (_provider, _view, current) => {if(!current())throw Error("wallet_changed");return "0x"+"aa".repeat(32);});
 await expect(binding.sendProgrammeTransaction(view,()=>true)).resolves.toBe("0x"+"aa".repeat(32));
 expect(mocks.sendProgramme).toHaveBeenCalledWith(provider,view,expect.any(Function));
 await expect(binding.sendProgrammeTransaction(view,()=>false)).rejects.toThrow("wallet_changed");
 mocks.sendProgramme.mockClear();
 for(const transaction of [null,{from:"0x"+"cd".repeat(20),chainId:10143},{from:address,chainId:1}]){
  await expect(binding.sendProgrammeTransaction({transaction},()=>true)).rejects.toThrow("wallet_changed");
 }
 expect(mocks.sendProgramme).not.toHaveBeenCalled();
 // The ordinary embedded provider still cannot send arbitrary transactions.
 await expect(binding.provider.request({method:"eth_sendTransaction",params:[]})).rejects.toThrow();
 expect(provider.request).not.toHaveBeenCalled();
 mocks.auth.session={access_token:"next-session"};sessionKey="next-session";page.rerender(runtime());await act(async()=>{});
 await expect(binding.sendProgrammeTransaction(view,()=>true)).rejects.toThrow("wallet_changed");
 expect(mocks.sendProgramme).not.toHaveBeenCalled();
});

it('authorizes the exact publication request for the verified reviewer without creating or requiring a linked personal wallet',async()=>{
 const {encodeFunctionData}=await import('viem');const {sponsorLifecycleAbi}=await import('@raceson/rewards-chain/sponsor-lifecycle-v4');
 const onState=vi.fn(),id='00000000-0000-4000-a000-000000000001',address='0x'+'11'.repeat(20),digest='0x'+'22'.repeat(32);
 render(<PrivyRewardRuntime configuration={configuration} sessionKey="reviewer" walletUserId="demo-user" onState={onState}/>);await act(async()=>{});
 const state=onState.mock.lastCall![1];expect(state.reviewerConnected).toBe(true);expect(state.wallet).toBeNull();
 const view={schema:'podium-review-publication-v1' as const,approvalId:id,slot:0,documentHash:'d'.repeat(64),operator:address,campaignAddress:address,state:2,claimsOpen:false,next:'activate' as const,ownership:'owned' as const,pending:{hash:null,confirmed:false,action:'activate' as const},authorization:{transactionId:id,request:{version:1 as const,method:'POST' as const,url:'https://api.privy.io/v1/wallets/wallet/rpc',headers:{'privy-app-id':configuration.appId,'privy-request-expiry':String(Date.now()+90000)},body:{method:'eth_signTransaction' as const,chain_type:'ethereum' as const,params:{transaction:{type:0 as const,chain_id:10143 as const,to:address,data:encodeFunctionData({abi:sponsorLifecycleAbi,functionName:'activate',args:[digest as `0x${string}`,digest as `0x${string}`]}),value:'0x0' as const,nonce:0,gas_limit:'0x1d4c0',gas_price:'0x1'}}}}}};
 mocks.authorize.mockResolvedValue({signature:'S'.repeat(88)});
 const signed=await state.authorizePublication(view,()=>true);expect(signed.transactionId).toBe(id);expect(mocks.authorize).toHaveBeenCalledWith(view.authorization.request);expect(mocks.create).not.toHaveBeenCalled();
 mocks.authorize.mockRejectedValue(Error('private provider detail'));
 await expect(state.authorizePublication(view,()=>true)).rejects.toThrow('review_publication_client_authorization_failed');
 const expired={...view,authorization:{...view.authorization,request:{...view.authorization.request,headers:{...view.authorization.request.headers,'privy-request-expiry':String(Date.now()-1)}}}};
 const attempts=mocks.authorize.mock.calls.length;
 await expect(state.authorizePublication(expired,()=>true)).rejects.toThrow('review_publication_request_expired');
 expect(mocks.authorize).toHaveBeenCalledTimes(attempts);
 let active=true;mocks.authorize.mockImplementation(async()=>{active=false;return {signature:'S'.repeat(88)};});
 await expect(state.authorizePublication(view,()=>active)).rejects.toThrow('review_publication_session_changed');
});
