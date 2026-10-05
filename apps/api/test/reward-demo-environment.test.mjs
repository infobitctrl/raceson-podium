import assert from "node:assert/strict";
import test from "node:test";
import { rewardDemoTarget, rewardDemoBrowserEnvironment, assertRewardDemoBrowserOrigin, REWARD_DEMO_STORAGE_KEY, isRewardWalletOrigin } from "../../../packages/domain/dist/rewards/demo-environment.js";
import { walletOriginCases } from "./fixtures/reward-wallet-origins.mjs";
import { rewardPortalConfig } from "../dist/features/rewards/request-identity.js";

// Reserved .invalid host and syntactically valid, synthetic project reference.
// No network requests or actual provider configuration are made in these tests.
const target={mode:"testnet",origin:"https://reward-demo.invalid",supabaseUrl:"https://abcdefghijklmnopqrst.supabase.co"};
const actual={appBaseUrl:target.origin,supabaseUrl:target.supabaseUrl};
const values={RACESON_REWARD_PORTAL_MODE:"testnet",RACESON_REWARD_DEMO_ORIGIN:target.origin,RACESON_REWARD_DEMO_SUPABASE_URL:target.supabaseUrl};
const browserInput = { ...target, enabled: "true", actualSupabaseUrl: target.supabaseUrl, publicSupabaseUrl: target.supabaseUrl,
  apiBaseUrl: "/api", authRedirectBaseUrl: target.origin, storageKey: REWARD_DEMO_STORAGE_KEY };

test("testnet configuration requires separate declared and actual origins/database to agree",()=>{
  assert.deepEqual(rewardDemoTarget(target),{...target,chainId:10143});
  assert.deepEqual(rewardPortalConfig(values,actual),{chainId:10143,origin:target.origin});
  for(const changed of [{...actual,appBaseUrl:"https://www.raceson.com"},{...actual,supabaseUrl:"https://icdtinbmtvzhswrrzjxq.supabase.co"},
    {...actual,appBaseUrl:"https://other-demo.invalid"},{...actual,supabaseUrl:"https://bcdefghijklmnopqrstu.supabase.co"}]){
    assert.throws(()=>rewardPortalConfig(values,changed),{code:"reward_portal_configuration_required"});
  }
  for(const missing of ["RACESON_REWARD_DEMO_ORIGIN","RACESON_REWARD_DEMO_SUPABASE_URL"]){
    assert.throws(()=>rewardPortalConfig({...values,[missing]:undefined},actual),{code:"reward_portal_configuration_required"});
  }
});
test("production and legacy origins/projects cannot be declared as a rewards demo",()=>{
  for(const host of ["raceson.com","www.raceson.com","staging.raceson.com","raceson-staging.vercel.app","sitrail.com","www.sitrail.com","sibenik.trail"]){
    assert.equal(rewardDemoTarget({...target,origin:`https://${host}`}),null);
    assert.equal(rewardDemoTarget({...target,origin:`https://${host}.`}),null);
  }
  for(const ref of ["icdtinbmtvzhswrrzjxq","gnnmnhhvujdvyohcidki","whffzvkqwmzbkrybadkq"]){
    assert.equal(rewardDemoTarget({...target,supabaseUrl:`https://${ref}.supabase.co`}),null);
    assert.throws(()=>rewardPortalConfig({...values,RACESON_REWARD_DEMO_SUPABASE_URL:`https://${ref}.supabase.co`},
      {...actual,supabaseUrl:`https://${ref}.supabase.co`}),{code:"reward_portal_configuration_required"});
  }
});
test("demo policy rejects ambiguous URLs, aliases, credentials, paths, insecure remote hosts and mainnet",()=>{
  for(const origin of ["https://reward-demo.invalid/","https://reward-demo.invalid/path","https://user:password@reward-demo.invalid",
    "https://reward-demo.invalid?query=1","https://reward-demo.invalid#hash","http://reward-demo.invalid","https://localhost",
    "https://localhost.","https://reward-demo.invalid.",
    "https://127.0.0.1","https://[::1]","https://reward-demo.invalid:8443"," https://reward-demo.invalid",target.supabaseUrl]){
    assert.equal(rewardDemoTarget({...target,origin}),null,origin);
  }
  for(const supabaseUrl of ["https://database.reward-demo.invalid",target.supabaseUrl+"/",target.supabaseUrl+"/auth/v1",
    target.supabaseUrl+":8443","http://abcdefghijklmnopqrst.supabase.co","https://abcdefghijklmnopqrst.supabase.co.evil.invalid"]){
    assert.equal(rewardDemoTarget({...target,supabaseUrl}),null,supabaseUrl);
  }
  for(const mode of [undefined,"production","mainnet",143])assert.equal(rewardDemoTarget({...target,mode}),null);
});
test("local demo configuration is explicitly loopback-only on both sides",()=>{
  const local={mode:"local",origin:"http://127.0.0.1:5173",supabaseUrl:"http://127.0.0.1:54321"};
  assert.deepEqual(rewardDemoTarget(local),{...local,chainId:31337});
  for(const patch of [{origin:"http://0.0.0.0:5173"},{supabaseUrl:target.supabaseUrl},{origin:target.origin},
    {supabaseUrl:"http://127.0.0.1:54321/proxy"},{origin:"http://localhost"}])assert.equal(rewardDemoTarget({...local,...patch}),null);
});

test("local-testnet keeps both services loopback-only while selecting Monad 10143",()=>{
  const local={mode:"local-testnet",origin:"http://127.0.0.1:3102",supabaseUrl:"http://127.0.0.1:55321"};
  assert.deepEqual(rewardDemoTarget(local),{...local,chainId:10143});
  const env={NODE_ENV:"development",RACESON_REWARD_PORTAL_MODE:local.mode,RACESON_REWARD_DEMO_ORIGIN:local.origin,RACESON_REWARD_DEMO_SUPABASE_URL:local.supabaseUrl};
  const configured={appBaseUrl:local.origin,supabaseUrl:local.supabaseUrl};
  assert.deepEqual(rewardPortalConfig(env,configured),{chainId:10143,origin:local.origin});
  assert.throws(()=>rewardPortalConfig({...env,NODE_ENV:"production"},configured));
  for(const patch of [{supabaseUrl:target.supabaseUrl},{origin:target.origin},{origin:"https://www.raceson.com"}])
    assert.equal(rewardDemoTarget({...local,...patch}),null);
});

test("new wallet origins exclude production; the explicit legacy exception is history-only",()=>{
  for(const [origin,chainId,allowed] of walletOriginCases) assert.equal(isRewardWalletOrigin(origin,chainId),allowed,`${origin} ${chainId}`);
  assert.equal(isRewardWalletOrigin("https://www.raceson.com",10143,true),true);
  assert.equal(isRewardWalletOrigin("https://www.raceson.com",31337,true),false);
});

test("testnet origins require concrete bounded DNS labels, not wildcard or malformed host patterns",()=>{
  for(const hostname of ["*.raceson.com","a..invalid","bad_host.invalid","-demo.invalid","demo-.invalid",
    `${"a".repeat(64)}.invalid`,Array(5).fill("a".repeat(63)).join(".")]){
    assert.equal(rewardDemoTarget({...target,origin:`https://${hostname}`}),null,hostname);
  }
  for(const hostname of ["demo-1.example.invalid","xn--bcher-kva.invalid",`${"a".repeat(63)}.invalid`]){
    const origin=`https://${hostname}`;
    assert.equal(rewardDemoTarget({...target,origin})?.origin,origin);
  }
});

test("demo browser transport and auth config require one isolated origin and storage namespace", () => {
  const result = rewardDemoBrowserEnvironment(browserInput);
  assert.deepEqual(result, { ...target, chainId: 10143, apiBaseUrl: `${target.origin}/api`, storageKey: REWARD_DEMO_STORAGE_KEY });
  assert.ok(Object.isFrozen(result));
  for (const enabled of [undefined, "false"]) assert.deepEqual(rewardDemoBrowserEnvironment({ ...browserInput, enabled }), result);
  for (const patch of [
    { enabled: "yes" }, { mode: undefined }, { mode: "disabled" }, { mode: "mainnet" },
    { actualSupabaseUrl: "https://icdtinbmtvzhswrrzjxq.supabase.co" }, { publicSupabaseUrl: "https://icdtinbmtvzhswrrzjxq.supabase.co" },
    { apiBaseUrl: "https://www.raceson.com/api" }, { apiBaseUrl: "http://127.0.0.1:8787/api" }, { apiBaseUrl: "//reward-demo.invalid/api" },
    { apiBaseUrl: `${target.origin}/api/` }, { authRedirectBaseUrl: "https://www.raceson.com" }, { authRedirectBaseUrl: "" },
    { storageKey: "raceson-auth" }, { storageKey: "sitrail-auth" }, { storageKey: "" },
  ]) assert.throws(() => rewardDemoBrowserEnvironment({ ...browserInput, ...patch }), /reward_demo_configuration_required/);
});

test("ordinary portal configuration stays unchanged but cannot silently enable demo rewards", () => {
  const portal = { ...browserInput, enabled: undefined, mode: undefined, origin: undefined, supabaseUrl: undefined };
  assert.equal(rewardDemoBrowserEnvironment(portal), null);
  assert.equal(rewardDemoBrowserEnvironment({ ...portal, enabled: "false", mode: "disabled" }), null);
  assert.throws(() => rewardDemoBrowserEnvironment({ ...portal, enabled: "true" }), /reward_demo_configuration_required/);
  for (const patch of [{ origin: target.origin }, { supabaseUrl: target.supabaseUrl }]) {
    assert.throws(() => rewardDemoBrowserEnvironment({ ...portal, ...patch }), /reward_demo_configuration_required/);
  }
});

test("a demo build cannot operate on a different browser origin, including another loopback port", () => {
  const demo = rewardDemoBrowserEnvironment(browserInput);
  assert.doesNotThrow(() => assertRewardDemoBrowserOrigin(demo, target.origin));
  assert.doesNotThrow(() => assertRewardDemoBrowserOrigin(demo, null));
  assert.doesNotThrow(() => assertRewardDemoBrowserOrigin(null, "https://www.raceson.com"));
  for (const origin of ["https://www.raceson.com", "https://other-demo.invalid", "null", `${target.origin}/`]) {
    assert.throws(() => assertRewardDemoBrowserOrigin(demo, origin), /reward_demo_origin_mismatch/);
  }
  const local = { ...browserInput, mode: "local", origin: "http://127.0.0.1:3101", supabaseUrl: "http://127.0.0.1:54331",
    actualSupabaseUrl: "http://127.0.0.1:54331", publicSupabaseUrl: "http://127.0.0.1:54331", authRedirectBaseUrl: "http://127.0.0.1:3101" };
  assert.throws(() => assertRewardDemoBrowserOrigin(rewardDemoBrowserEnvironment(local), "http://127.0.0.1:3102"), /reward_demo_origin_mismatch/);
});
