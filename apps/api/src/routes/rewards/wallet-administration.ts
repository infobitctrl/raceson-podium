import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import type {OrganizerRewardRouteDependencies} from './organizer.js';
import {readWalletAdministration,changeWalletAdministration,privyWalletVerifier,prepareWalletCreation,privyCreationOwner,type WalletCandidateVerifier,type WalletSettings} from '../../features/rewards/wallet-administration.js';
type Deps=OrganizerRewardRouteDependencies&{walletEnvironment?:Record<string,string|undefined>;verifyWallet?:WalletCandidateVerifier;creationOwner?:(settings:WalletSettings,role:'deployment'|'controller')=>Promise<string>};
export async function dispatchWalletAdministration(req:IncomingMessage,res:ServerResponse,url:URL,deps:Deps){
 const creation=url.pathname==='/api/v1/rewards/admin/wallets/creation';
 if(url.pathname!=='/api/v1/rewards/admin/wallets'&&!creation)return false;
 deps.applyPrivateSessionHeaders(res);
 try{
  if(!deps.config()||deps.config()!.chainId!==10143)throw Error('reward_wallet_provider_unavailable');
  if(!(creation?['POST']:['GET','POST']).includes(req.method??'')){res.setHeader('Allow',creation?'POST':'GET, POST');deps.sendError(res,405,'method_not_allowed','Unsupported method.');return true;}
  if([...url.searchParams].length)throw Error('invalid_reward_wallet_settings');
  if(req.headers.origin&&req.headers.origin!==deps.config()!.origin)throw Error('Untrusted browser origin');
  const identity=await deps.requireIdentity(req),env=deps.walletEnvironment??process.env;
  const result=creation?await prepareWalletCreation(identity,await deps.readJsonBody(req),env,deps.creationOwner??privyCreationOwner(env),deps.rpc):req.method==='GET'?await readWalletAdministration(identity,env,deps.rpc):await changeWalletAdministration(identity,await deps.readJsonBody(req),env,deps.verifyWallet??privyWalletVerifier(env),deps.rpc);
  deps.sendSuccess(res,result);
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(['reward_account_session_required','Unauthorized','Missing bearer token'].includes(code))deps.sendError(res,401,'reward_auth_required','Sign in to your master-admin account.');
  else if(['reward_master_admin_required','Untrusted browser origin'].includes(code))deps.sendError(res,403,'reward_master_admin_required','Only an active master administrator can manage wallets.');
  else if(code==='reward_wallet_settings_conflict')deps.sendError(res,409,code,'Wallet settings changed. Reload and review the current selection.');
  else if(error instanceof z.ZodError||['invalid_reward_wallet_settings','reward_wallet_roles_must_differ','reward_wallet_previous_role_conflict','reward_wallet_review_required'].includes(code))deps.sendError(res,400,error instanceof z.ZodError?'invalid_reward_wallet_settings':code,'Review two distinct, verified wallet roles before activation.');
  else deps.sendError(res,503,'reward_wallet_unverified','The wallet change could not be confirmed. Reload settings before retrying, then check ownership and restricted provider access.');
 }
 return true;
}
