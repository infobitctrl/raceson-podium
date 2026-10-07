import {sendDirectClubClaimV5} from "@/features/rewards/data/clubDirectClaimsV5";
import {sendDirectClaimV5} from "@/features/rewards/data/directClaimsV5";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthorizationSignature, useCreateWallet, usePrivy, useSubscribeToJwtAuthWithFlag, useWallets, type PrivyClientConfig } from "@privy-io/react-auth";
import PrivyUiProvider from "./PrivyUiProvider";
import { useAuth } from "@/lib/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { type RewardEmbeddedState, type RewardWalletRuntimeProps } from "@/features/rewards/components/RewardEmbeddedWalletContext";
import { bindEmbeddedRewardWallet } from "@/features/rewards/data/embeddedWalletProvider";
import { getRewardPrivyToken } from "@/features/rewards/data/privyAuthToken";
import { useRewardSessionEpoch } from "@/features/rewards/model/useRewardSessionEpoch";
import {sendProgrammeTransaction} from "@/features/rewards/data/sponsorProgrammeWallet";
import {sendClubSafeCreation} from "@/features/rewards/data/clubSafeCreation";
import {checkSponsorTransaction, sendSponsorTransaction, sponsorTransactionSender} from "@/features/rewards/data/sponsorTransaction";
import {checkedPublicationAuthorization,type ReviewPublication,type ReviewPublicationAuthorization} from '@/features/rewards/data/reviewPublication';

const monadTestnet = {
  id: 10143, name: "Monad Testnet", testnet: true,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://testnet.monadvision.com" } },
};
// Provider configuration participates in SDK Auth dependencies. A new config
// on each reported state can continuously restart JWT synchronization.
const privyConfig: PrivyClientConfig = {
  defaultChain: monadTestnet, supportedChains: [monadTestnet],
  embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" }, showWalletUIs: true },
};

/** Thin SDK adapter owned by the separate demo package. Product proof/payment
 * logic stays in the rewards feature. No login(), extra signers or server keys. */
function AuthenticatedWallet({ configuration, sessionKey, walletUserId, onState }: RewardWalletRuntimeProps) {
  const auth = useAuth();
  const authSession = useRewardSessionEpoch(auth.session);
  const privy = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const {generateAuthorizationSignature}=useAuthorizationSignature();
  const authorizeRef=useRef(generateAuthorizationSignature);
  useEffect(()=>{authorizeRef.current=generateAuthorizationSignature;},[generateAuthorizationSignature]);
  // SDK callbacks may change identity each render. Keep the published create
  // action stable so reporting state to the parent cannot trigger a render loop.
  // Use the latest committed SDK callback only after the existing session guards.
  const createWalletRef = useRef(createWallet);
  useEffect(() => { createWalletRef.current = createWallet; }, [createWallet]);
  const [failure, setFailure] = useState(false), [creating, setCreating] = useState(false);
  const [initializationTimedOut, setInitializationTimedOut] = useState(false);
  const [connected, setConnected] = useState<{ value: RewardEmbeddedState; session: string; address: string } | null>(null);
  const inFlight = useRef(false);
  const authenticated = !auth.isLoading && !!auth.user && auth.user.id === walletUserId && auth.account?.userId === auth.user.id;
  const providerMismatch = privy.ready && privy.authenticated
    && privy.user?.linkedAccounts.some(a => a.type === "custom_auth" && a.customUserId === walletUserId) !== true;
  const jwtAllowed = authenticated && privy.ready && !providerMismatch;
  const current = useRef({ authenticated, jwtAllowed, session: authSession, userId: auth.user?.id });
  current.current = { authenticated, jwtAllowed, session: authSession, userId: auth.user?.id };
  const logoutRef = useRef(privy.logout);
  useEffect(() => { logoutRef.current = privy.logout; }, [privy.logout]);
  const logoutAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (!authenticated || !providerMismatch) return;
    const key = `${authSession}:${privy.user?.id ?? "unknown"}`;
    if (logoutAttempt.current === key) return;
    logoutAttempt.current = key;
    let disposed = false;
    // A retained Privy session must be ended BEFORE supplying another user's
    // JWT. Otherwise the SDK attempts account linking, not a clean login.
    // This clears only Privy, never the RacesOn login, stored wallet or ledger.
    void logoutRef.current().catch(() => { if (!disposed) setFailure(true); });
    return () => { disposed = true; };
  }, [authenticated, providerMismatch, authSession, privy.user?.id]);
  const getExternalJwt = useCallback(async () => {
    try {
      const snapshot = current.current;
      if (!snapshot.jwtAllowed || !snapshot.userId) return undefined;
      const client = getSupabaseBrowserClient();
      if (!client) return undefined;
      return await getRewardPrivyToken(client.auth, configuration.issuer, snapshot.userId, () => current.current.jwtAllowed
        && current.current.userId === snapshot.userId && current.current.session === snapshot.session);
    } catch { return undefined; }
  }, [configuration.issuer]);
  const { state } = useSubscribeToJwtAuthWithFlag({
    enabled: privy.ready && !providerMismatch,
    isAuthenticated: jwtAllowed, isLoading: auth.isLoading || !privy.ready || providerMismatch, getExternalJwt,
  });
  const accountMatches = authenticated && privy.ready && privy.authenticated && !!privy.user?.id
    && privy.user?.linkedAccounts.some(a => a.type === "custom_auth" && a.customUserId === auth.user?.id) === true;
  const [verifiedJwt, setVerifiedJwt] = useState<{ session: string; privyUserId: string } | null>(null);
  // SDK 3.42 rechecks the same JWT when its signing modal changes context. Its
  // transient `loading` is not a logout. Retain only an already-verified exact
  // Auth session + Privy identity, never an initial/unverified or failed binding.
  useEffect(() => {
    if (!accountMatches || state.status === "error" || state.status === "not-enabled" || state.status === "initial") {
      setVerifiedJwt(null);
    } else if (state.status === "done") {
      setVerifiedJwt(previous => previous?.session === authSession && previous.privyUserId === privy.user!.id
        ? previous : { session: authSession, privyUserId: privy.user!.id });
    }
  }, [accountMatches, state.status, authSession, privy.user?.id]);
  const identityMatches = accountMatches && (state.status === "done" || (state.status === "loading"
    && verifiedJwt?.session === authSession && verifiedJwt.privyUserId === privy.user?.id));
  const embedded = wallets.filter(w => w.walletClientType === "privy" && w.connectorType === "embedded" && w.linked && !w.imported);
  // A linked wallet can be disconnected on a new device. Its absence from
  // useWallets is not evidence that this user needs a new embedded wallet.
  const hasLinkedEmbedded = privy.user?.linkedAccounts.some(a => a.type === "wallet" && a.chainType === "ethereum" && a.walletClientType === "privy") === true;
  const wallet = embedded.length === 1 ? embedded[0] : null;
  const scope = useRef({ identityMatches, wallet, session: authSession, privyUserId: privy.user?.id });
  scope.current = { identityMatches, wallet, session: authSession, privyUserId: privy.user?.id };
  useEffect(()=>()=>{scope.current.identityMatches=false;},[]);
  useEffect(() => {
    setConnected(null); setFailure(false);
    if (!identityMatches || !walletsReady || !wallet) return;
    let disposed = false;
    let binding: ReturnType<typeof bindEmbeddedRewardWallet> | null = null;
    const snapshot = scope.current;
    const isCurrent = () => !disposed && scope.current.identityMatches && scope.current.wallet === snapshot.wallet
      && scope.current.session === snapshot.session && scope.current.privyUserId === snapshot.privyUserId;
    void wallet.getEthereumProvider().then(provider => {
      if (!isCurrent()) return;
      binding = bindEmbeddedRewardWallet(provider, wallet.address, isCurrent);
      setConnected({ session: snapshot.session, address: wallet.address,
        value: { status: "ready", address: wallet.address, wallet: { id: `privy:${wallet.address.toLowerCase()}`, name: "Privy", provider: binding.provider,
          checkSponsorTransaction: (input, sponsorCurrent) => {
            if (sponsorTransactionSender(input) !== wallet.address.toLowerCase() || input.plan.chainId !== 10143 || !isCurrent()) return Promise.reject(new Error("sponsor_wallet_changed"));
            return checkSponsorTransaction(provider, input, () => isCurrent() && sponsorCurrent());
          },
          sendDirectClubClaim: (view, signatures, address, clubCurrent) => sendDirectClubClaimV5(provider, view, signatures, address, () => isCurrent() && clubCurrent()),
          sendDirectClaim: (view, athleteCurrent) => {
            if (view.transaction?.from !== wallet.address.toLowerCase() || view.transaction.chainId !== 10143 || !isCurrent()) return Promise.reject(new Error("wallet_changed"));
            return sendDirectClaimV5(provider, view, () => isCurrent() && athleteCurrent());
          },
          sendProgrammeTransaction: (view, operatorCurrent) => {
            if (view.transaction?.from !== wallet.address.toLowerCase() || view.transaction.chainId !== 10143 || !isCurrent()) return Promise.reject(new Error("wallet_changed"));
            return sendProgrammeTransaction(provider, view, () => isCurrent() && operatorCurrent());
          },
          sendClubSafeCreation: (view, ownerCurrent) => {
            if (view.record.sender !== wallet.address.toLowerCase() || view.record.chainId !== 10143 || !isCurrent()) return Promise.reject(new Error("wallet_changed"));
            return sendClubSafeCreation(provider, view, () => isCurrent() && ownerCurrent());
          },
          sendSponsorTransaction: (input, sponsorCurrent) => {
            if (sponsorTransactionSender(input) !== wallet.address.toLowerCase() || input.plan.chainId !== 10143 || !isCurrent()) return Promise.reject(new Error("sponsor_wallet_changed"));
            return sendSponsorTransaction(provider, input, () => isCurrent() && sponsorCurrent());
          } } } });
    }).catch(() => { if (isCurrent()) setFailure(true); });
    return () => { disposed = true; binding?.dispose(); };
  }, [identityMatches, walletsReady, wallet, authSession, privy.user?.id]);
  const create = useCallback(async () => {
    if (inFlight.current || state.status !== "done" || !identityMatches || !walletsReady || embedded.length !== 0 || hasLinkedEmbedded) return;
    const snapshot = current.current;
    inFlight.current = true; setCreating(true); setFailure(false);
    try {
      // Verify the RacesOn session immediately before requesting user-owned
      // creation. No createAdditional, owner key, signer or policy is supplied.
      if (!await getExternalJwt() || current.current.session !== snapshot.session || !scope.current.identityMatches) throw new Error();
      await createWalletRef.current();
    } catch { if (current.current.session === snapshot.session) setFailure(true); }
    finally { inFlight.current = false; setCreating(false); }
  }, [state.status, identityMatches, walletsReady, embedded.length, hasLinkedEmbedded, getExternalJwt]);
  const initializing = authenticated && !creating && (!identityMatches || !walletsReady || (!!wallet && !connected));
  useEffect(() => {
    setInitializationTimedOut(false);
    if (!initializing) return;
    const timer = setTimeout(() => setInitializationTimedOut(true), 60_000);
    return () => clearTimeout(timer);
  }, [initializing, authSession, privy.user?.id]);
  const value: RewardEmbeddedState = useMemo(() => !authenticated ? { status: "off", wallet: null }
    : failure || (!providerMismatch && privy.ready && (state.status === "error" || state.status === "not-enabled")) || embedded.length > 1 ? { status: "error", wallet: null }
      : initializing && initializationTimedOut ? { status: "error", wallet: null, errorReason: "initialization_timeout" }
      : !identityMatches || !walletsReady || creating ? { status: "loading", wallet: null }
        : wallet ? connected?.session === authSession && connected.address === wallet.address ? connected.value : { status: "loading", wallet: null }
          : hasLinkedEmbedded ? { status: "error", wallet: null } : { status: "ready", wallet: null, create },
  [authenticated, failure, providerMismatch, privy.ready, state.status, embedded.length, identityMatches, walletsReady, creating, wallet, connected, authSession, create, hasLinkedEmbedded, initializing, initializationTimedOut]);
  const authorizePublication=useCallback(async(view:ReviewPublication,isCurrent:()=>boolean):Promise<ReviewPublicationAuthorization>=>{
    const snapshot=scope.current;
    const active=()=>isCurrent()&&scope.current.identityMatches&&scope.current.session===snapshot.session&&scope.current.privyUserId===snapshot.privyUserId;
    if(!active())throw Error('review_publication_session_changed');
    const request=checkedPublicationAuthorization(view,configuration.appId);
    const {signature}=await authorizeRef.current(request);
    if(!active())throw Error('review_publication_session_changed');
    return {transactionId:view.authorization!.transactionId,authorizationSignature:signature,requestExpiry:Number(request.headers['privy-request-expiry'])};
  },[configuration.appId]);
  const reported = useMemo(() => ({...value, reviewerConnected:identityMatches,...(identityMatches?{authorizePublication}:{})}), [value,identityMatches,authorizePublication]);
  useEffect(() => onState(sessionKey, reported), [sessionKey, reported, onState]);
  return null;
}

function PrivyRewardRuntime(props: RewardWalletRuntimeProps) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(previous => previous + 1), []);
  const report = useCallback((key: string, value: RewardEmbeddedState) =>
    props.onState(key, value.status === "error" ? { ...value, enable: retry } : value), [props.onState, retry]);
  // Explicit retry remounts the SDK only. It never logs out RacesOn, creates a
  // wallet, bypasses readiness checks, signs a claim or sends a transaction.
  return <PrivyUiProvider key={attempt} appId={props.configuration.appId} config={privyConfig}><AuthenticatedWallet {...props} onState={report} /></PrivyUiProvider>;
}

// State reports update the surrounding portal, not the SDK provider inputs.
// Auth context updates still reach AuthenticatedWallet through React context.
export default memo(PrivyRewardRuntime);
