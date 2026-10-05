/** Public configuration policy only: no credentials, provider calls or Node
 * APIs. A valid configuration is not proof that infrastructure is provisioned
 * or that a data export/release has been authorized. */
export type RewardDemoTarget={mode:"local"|"local-testnet"|"testnet";chainId:31337|10143;origin:string;supabaseUrl:string};
const protectedHosts=new Set(["raceson.com","www.raceson.com","staging.raceson.com","raceson-staging.vercel.app",
  "sitrail.com","www.sitrail.com","sibenik.trail"]);
const protectedProjects=new Set(["icdtinbmtvzhswrrzjxq","gnnmnhhvujdvyohcidki","whffzvkqwmzbkrybadkq"]);
function exactOrigin(value:unknown):URL|null{
  if(typeof value!=="string"||value.length>2048)return null;
  // DNS treats a trailing dot as the same host. Do not let that alternate
  // spelling bypass protected-host checks or the explicit-origin contract.
  try{const u=new URL(value);return u.origin===value&&!u.username&&!u.password&&!u.hostname.endsWith(".")?u:null;}catch{return null;}
}
function loopback(u:URL):boolean{
  return u.protocol==="http:"&&["127.0.0.1","localhost"].includes(u.hostname)&&/^[1-9][0-9]{0,4}$/.test(u.port);
}
function concreteDnsHostname(hostname:string):boolean{
  // An approved browser origin names one host, never a wildcard or a DNS
  // pattern. URL parsing alone accepts stars, empty labels and underscores.
  return hostname.length<=253&&hostname.includes(".")&&hostname.split(".").every(
    label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
export function rewardDemoTarget(input:{mode:unknown;origin:unknown;supabaseUrl:unknown}):RewardDemoTarget|null{
  const site=exactOrigin(input.origin);const database=exactOrigin(input.supabaseUrl);
  if(!site||!database||protectedHosts.has(site.hostname)||protectedHosts.has(database.hostname))return null;
  if((input.mode==="local"||input.mode==="local-testnet")&&loopback(site)&&loopback(database)){
    return{mode:input.mode,chainId:input.mode==="local"?31337:10143,origin:site.origin,supabaseUrl:database.origin};
  }
  if(input.mode!=="testnet"||site.protocol!=="https:"||site.port||database.protocol!=="https:"||database.port)return null;
  // No custom Supabase aliases: the project reference must be independently
  // visible and must not be a production/legacy RacesOn project.
  const match=/^([a-z]{20})\.supabase\.co$/.exec(database.hostname);
  if(!match||protectedProjects.has(match[1])||site.hostname===database.hostname
    ||!concreteDnsHostname(site.hostname)||/^[0-9.]+$/.test(site.hostname))return null;
  return{mode:"testnet",chainId:10143,origin:site.origin,supabaseUrl:database.origin};
}

/** Message origin syntax is not hosting approval. New challenges must also use
 * the exact server-validated demo target; browser signing rechecks its own origin.
 * The legacy www exception is ONLY for reconstructing immutable proof history. */
export function isRewardWalletOrigin(origin: unknown, chainId: unknown, allowLegacyProduction = false): boolean {
  if (typeof origin !== "string" || origin.length > 100) return false;
  if (allowLegacyProduction && chainId === 10143 && origin === "https://www.raceson.com") return true;
  const site = exactOrigin(origin);
  if (!site || protectedHosts.has(site.hostname) || ![31337, 10143].includes(chainId as number)) return false;
  if (loopback(site)) return true;
  return chainId === 10143 && site.protocol === "https:" && !site.port
    && concreteDnsHostname(site.hostname) && !/^[0-9.]+$/.test(site.hostname)
    && !site.hostname.endsWith(".supabase.co");
}

export const REWARD_DEMO_STORAGE_KEY = "raceson-rewards-demo-auth";
export type RewardDemoBrowserEnvironment = Readonly<RewardDemoTarget & { apiBaseUrl: string; storageKey: string }>;

/** Validate the complete browser transport/Auth boundary, even if reward UI is
 * temporarily disabled in a demo. Never silently turn a misconfigured demo into
 * an ordinary portal. API calls stay on the one declared demo origin. */
export function rewardDemoBrowserEnvironment(input: {
  enabled: string | undefined;
  mode: string | undefined;
  origin: string | undefined;
  supabaseUrl: string | undefined;
  actualSupabaseUrl: string;
  publicSupabaseUrl: string;
  apiBaseUrl: string;
  authRedirectBaseUrl: string;
  storageKey: string;
}): RewardDemoBrowserEnvironment | null {
  const fail = (): never => { throw new Error("reward_demo_configuration_required"); };
  if (input.mode === undefined || input.mode === "disabled") {
    if (input.enabled === "true" || input.origin || input.supabaseUrl) return fail();
    return null;
  }
  const target = rewardDemoTarget(input);
  if (!target || (input.enabled !== undefined && !["true", "false"].includes(input.enabled))
    || input.actualSupabaseUrl !== target.supabaseUrl || input.publicSupabaseUrl !== target.supabaseUrl
    || input.authRedirectBaseUrl !== target.origin || input.storageKey !== REWARD_DEMO_STORAGE_KEY
    || !["/api", `${target.origin}/api`].includes(input.apiBaseUrl)) return fail();
  return Object.freeze({ ...target, apiBaseUrl: `${target.origin}/api`, storageKey: REWARD_DEMO_STORAGE_KEY });
}

/** Check before returning a cached client, reading any session or making a
 * request. A valid demo build must not operate when served under another host. */
export function assertRewardDemoBrowserOrigin(demo: RewardDemoBrowserEnvironment | null | undefined, origin: string | null): void {
  if (demo && origin !== null && origin !== demo.origin) throw new Error("reward_demo_origin_mismatch");
}

export function rewardDemoServerEnvironment(input: {
  mode: string | undefined; origin: string | undefined; supabaseUrl: string | undefined;
  publicEnabled: string | undefined; publicMode: string | undefined;
  nodeEnv: string | undefined;
}, actual: {
  appBaseUrl: string | null; supabaseUrl: string; apiCorsOrigin: string | null;
  externalIntegrationsConfigured: boolean;
}): RewardDemoTarget | null {
  const requested = (input.mode !== undefined && input.mode !== "disabled") || input.origin || input.supabaseUrl
    || input.publicEnabled === "true" || (input.publicMode !== undefined && input.publicMode !== "disabled");
  if (!requested) return null;
  const target = rewardDemoTarget(input);
  if (!target || (target.mode !== "testnet" && input.nodeEnv === "production")
    || target.origin !== actual.appBaseUrl || target.supabaseUrl !== actual.supabaseUrl
    || (actual.apiCorsOrigin !== null && actual.apiCorsOrigin !== target.origin)
    || (input.publicMode !== undefined && input.publicMode !== target.mode)
    || actual.externalIntegrationsConfigured) throw new Error("reward_demo_configuration_required");
  return Object.freeze(target);
}
