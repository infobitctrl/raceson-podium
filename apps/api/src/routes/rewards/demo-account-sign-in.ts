import type {IncomingMessage, ServerResponse} from 'node:http';
import {consumePublicAuthRateLimit, signInBrowserSession, type ServerEnv} from '@raceson/db';
import {podiumDemoAccount} from '@raceson/domain/rewards/demo-accounts';
import {requestUsesSecureCookies, writeBrowserSessionCookies} from '../../browser-session.js';
import type {RewardPortalConfig} from '../../features/rewards/request-identity.js';
import type {OrganizerRewardRouteDependencies} from './organizer.js';

type Dependencies = {
 env: ServerEnv; enabled: boolean; config: RewardPortalConfig | null;
 readJsonBody: (req: IncomingMessage) => Promise<unknown>;
 applyPrivateSessionHeaders: (res: ServerResponse) => void;
 sendSuccess: OrganizerRewardRouteDependencies['sendSuccess'];
 sendError: (res: ServerResponse, status: number, code: string, message: string) => void;
 signIn?: typeof signInBrowserSession; rateLimit?: typeof consumePublicAuthRateLimit;
};
/** Only registered by the isolated rewards application. Every switch still
 * uses password Auth and current database account facts, never impersonation. */
export async function dispatchDemoAccountSignIn(req: IncomingMessage, res: ServerResponse, url: URL, deps: Dependencies) {
 if (url.pathname !== '/api/v1/public/auth/demo-account-sign-in') return false;
 deps.applyPrivateSessionHeaders(res);
 if (!deps.enabled || deps.config?.chainId !== 10143 || deps.env.supabaseUrl !== 'https://niklhlmljiikwbkrmapw.supabase.co') {
  deps.sendError(res, 403, 'demo_account_switch_unavailable', 'Demo account switching is unavailable.'); return true;
 }
 if (req.method !== 'POST' || [...url.searchParams].length) {
  deps.sendError(res, 400, 'invalid_demo_account_request', 'Choose a demo account.'); return true;
 }
 if (req.headers.origin !== deps.config.origin || req.headers['sec-fetch-site'] === 'cross-site') {
  deps.sendError(res, 403, 'untrusted_demo_origin', 'Use the configured Podium demo.'); return true;
 }
 try {
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim();
  const limit = deps.rateLimit ?? consumePublicAuthRateLimit;
  // Permit a complete 318-account rehearsal while keeping the original ten
  // attempts per account. These limits remain durable across serverless workers.
  const global = await limit({action: 'podium-demo-account-switch', email: 'all-demo-accounts', ipAddress: ip, limit: 400, windowMs: 15 * 60_000}, deps.env);
  if (!global.allowed) {
   if (global.retryAfterSeconds) res.setHeader('Retry-After', String(global.retryAfterSeconds));
   deps.sendError(res, 429, 'rate_limited', 'Too many switches. Please try again later.'); return true;
  }
  const body = await deps.readJsonBody(req);
  const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const account = podiumDemoAccount(value?.identifier);
  if (!account || typeof value?.password !== 'string' || !value.password.length || value.password.length > 1000
   || Object.keys(value).some(key => !['identifier', 'password'].includes(key))) {
   deps.sendError(res, 400, 'invalid_demo_account_request', 'Choose a demo account and enter its password.'); return true;
  }
  const perAccount = await limit({action: 'password-sign-in', email: account.username, ipAddress: ip, limit: 10, windowMs: 15 * 60_000}, deps.env);
  if (!perAccount.allowed) {
   if (perAccount.retryAfterSeconds) res.setHeader('Retry-After', String(perAccount.retryAfterSeconds));
   deps.sendError(res, 429, 'rate_limited', 'Too many attempts for this account. Please try again later.'); return true;
  }
  const result = await (deps.signIn ?? signInBrowserSession)({identifier: account.username, password: value.password, ipAddress: ip,
   userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null}, deps.env);
  if (result.account.loginUsername !== account.username) throw Error('demo_account_identity_mismatch');
  writeBrowserSessionCookies(res, result.session, requestUsesSecureCookies(req, deps.env.appBaseUrl));
  deps.sendSuccess(res, {account: result.account, session: {accessToken: result.session.accessToken,
   refreshToken: result.session.refreshToken, expiresAt: result.session.expiresAt}, expiresAt: result.session.expiresAt});
 } catch (error) {
  const status = error && typeof error === 'object' && 'status' in error ? (error as {status: unknown}).status : null;
  deps.sendError(res, status === 400 || status === 401 ? 401 : status === 429 ? 429 : 503,
   status === 400 || status === 401 ? 'invalid_demo_credentials' : status === 429 ? 'rate_limited' : 'demo_account_sign_in_unavailable',
   'Could not switch accounts. Check the demo password or try again later.');
 }
 return true;
}
