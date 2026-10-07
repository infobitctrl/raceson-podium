import test from 'node:test';
import assert from 'node:assert/strict';
import {podiumDemoAccounts,podiumDemoAccount,podiumDemoAccountSwitchEnabled} from '../../../packages/domain/dist/rewards/demo-accounts.js';
import {dispatchDemoAccountSignIn} from '../dist/routes/rewards/demo-account-sign-in.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
const path='/api/v1/public/auth/demo-account-sign-in',origin='https://podium.raceson.com';
function fixture(overrides={}){
 const calls=[],headers=new Map();let response=null;
 const req={method:'POST',headers:{origin,'sec-fetch-site':'same-origin'},socket:{remoteAddress:'127.0.0.1'}};
 const res={setHeader:(name,value)=>headers.set(name,value)};
 const deps={enabled:true,config:{chainId:10143,origin},env:{supabaseUrl:'https://niklhlmljiikwbkrmapw.supabase.co',appBaseUrl:origin},
  readJsonBody:async()=>({identifier:'demo.athlete1',password:'fictional-test-only'}),
  applyPrivateSessionHeaders:res=>res.setHeader('Cache-Control','private, no-store'),
  sendSuccess:(_res,data)=>{response={status:200,data};},sendError:(_res,status,code,message)=>{response={status,code,message};},
  rateLimit:async input=>{calls.push(['limit',input]);return{allowed:true,retryAfterSeconds:null};},
  signIn:async input=>{calls.push(['signIn',input]);return{account:{loginUsername:input.identifier},session:{accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:1800000000,expiresIn:3600}};},...overrides};
 return{req,res,deps,calls,headers,response:()=>response,run:()=>dispatchDemoAccountSignIn(req,res,new URL(path,origin),deps)};
}
test('catalogue contains exactly the provisioned 274 athletes, 41 club owners and three role accounts',()=>{
 assert.equal(podiumDemoAccounts.length,318);assert.equal(new Set(podiumDemoAccounts.map(a=>a.username)).size,318);
 for(const [role,count] of [['athlete',274],['club',41]]){
  const accounts=podiumDemoAccounts.filter(a=>a.role===role);assert.equal(accounts.length,count);
  accounts.forEach((a,i)=>assert.equal(a.username,`demo.${role}${i+1}`));
 }
 for(const invalid of ['demo.athlete0','demo.athlete275','demo.athlete01','demo.club0','demo.club42','demo.club','podium.sponsor','real.user','DEMO.athlete1',null])assert.equal(podiumDemoAccount(invalid),null);
});
test('switcher activation requires the exact hosted copy and Monad testnet',()=>{
 const target={mode:'testnet',chainId:10143,supabaseUrl:'https://niklhlmljiikwbkrmapw.supabase.co'};
 assert.equal(podiumDemoAccountSwitchEnabled(target,true),true);
 for(const value of [null,{...target,mode:'local'},{...target,chainId:1},{...target,supabaseUrl:'https://icdtinbmtvzhswrrzjxq.supabase.co'}])assert.equal(podiumDemoAccountSwitchEnabled(value,true),false);
 assert.equal(podiumDemoAccountSwitchEnabled(target,false),false);
});
test('the complete cohort authenticates individually and receives standard secure session cookies',async()=>{
 for(const account of podiumDemoAccounts){
  const x=fixture({readJsonBody:async()=>({identifier:account.username,password:'fictional-test-only'})});await x.run();
  assert.equal(x.response().status,200);assert.equal(x.response().data.account.loginUsername,account.username);
  const attempts=x.calls.filter(c=>c[0]==='limit');assert.equal(attempts[0][1].limit,400);assert.equal(attempts[1][1].limit,10);
  assert.equal(attempts[1][1].action,'password-sign-in');assert.equal(attempts[1][1].email,account.username);
  assert.equal(x.calls.filter(c=>c[0]==='signIn').length,1);
  assert.match(x.headers.get('Cache-Control'),/no-store/);
  for(const cookie of x.headers.get('Set-Cookie'))assert.match(cookie,/HttpOnly; SameSite=Lax; Secure/);
 }
});
test('untrusted origins, other chains/projects and disabled configuration cannot authenticate',async()=>{
 for(const mutate of [x=>x.deps.enabled=false,x=>x.deps.config=null,x=>x.deps.config.chainId=31337,
  x=>x.deps.env.supabaseUrl='https://icdtinbmtvzhswrrzjxq.supabase.co',x=>delete x.req.headers.origin,
  x=>x.req.headers.origin='https://raceson.com',x=>x.req.headers['sec-fetch-site']='cross-site']){
  const x=fixture();mutate(x);await x.run();assert.equal(x.response().status,403);assert.equal(x.calls.length,0);assert.equal(x.headers.has('Set-Cookie'),false);
 }
});
test('non-demo identifiers, extra authority input and invalid passwords are rejected before Auth',async()=>{
 for(const body of [{identifier:'demo.athlete275',password:'x'},{identifier:'demo.club42',password:'x'},{identifier:'demo.club',password:'x'},
  {identifier:'real.user',password:'x'},{identifier:'demo.master',password:''},{identifier:'demo.master',password:'x'.repeat(1001)},
  {identifier:'demo.master',password:'x',role:'super_admin'},null,[]]){
  const x=fixture({readJsonBody:async()=>body});await x.run();assert.equal(x.response().status,400);assert.equal(x.calls.some(c=>c[0]==='signIn'),false);
 }
});
test('both rate limits stop authentication and expose retry timing',async()=>{
 for(const at of [1,2]){
  let calls=0;const x=fixture({rateLimit:async()=>({allowed:++calls!==at,retryAfterSeconds:120})});await x.run();
  assert.equal(x.response().status,429);assert.equal(x.headers.get('Retry-After'),'120');assert.equal(x.calls.length,0);assert.equal(x.headers.has('Set-Cookie'),false);
 }
});
test('wrong passwords, provider throttling and a mismatched returned account never set browser cookies',async()=>{
 for(const status of [401,429,503]){
  const x=fixture({signIn:async()=>{throw Object.assign(new Error('private-provider-detail'),{status});}});await x.run();
  assert.equal(x.response().status,status);assert.equal(x.response().message.includes('private-provider-detail'),false);assert.equal(x.headers.has('Set-Cookie'),false);
 }
 const x=fixture({signIn:async()=>({account:{loginUsername:'demo.master'},session:{}})});await x.run();assert.equal(x.response().status,503);assert.equal(x.headers.has('Set-Cookie'),false);
});
test('only the explicit hosted sponsor demo gate admits POST without query parameters',()=>{
 assert.equal(hostedCopyRequestAllowed('POST',new URL(path,origin),'sponsor-drafts-v1'),true);
 for(const method of ['GET','PATCH','DELETE'])assert.equal(hostedCopyRequestAllowed(method,new URL(path,origin),'sponsor-drafts-v1'),false);
 assert.equal(hostedCopyRequestAllowed('POST',new URL(path+'?role=admin',origin),'sponsor-drafts-v1'),false);
 assert.equal(hostedCopyRequestAllowed('POST',new URL(path,origin),'preview-v1'),false);
});
