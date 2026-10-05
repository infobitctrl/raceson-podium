import { hostedCopyReviewNote } from "../../features/rewards/hosted-copy-review.js";
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { createAdminSupabaseClient, loadServerEnv } from '@raceson/db';
import { hostedCopySponsor } from '@raceson/db/rewards';
import { previewRewardSetup, type RewardDistributionSetup, type SavedRewardSetup } from '@raceson/domain/rewards/distribution-setup';
import type { OrganizerRewardRouteDependencies } from './organizer.js';
import { hostedCopyPin, hostedCopyPreviewEnabled } from '../../features/rewards/hosted-copy-preview.js';
const uuid = z.string().uuid().refine(v => v === v.toLowerCase() && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v));
const write = z.object({ requestId: uuid, expectedRevision: z.number().int().min(0).max(2147483644), configuration: z.unknown() }).strict();
const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v));
export async function dispatchHostedCopySponsor(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies,
 read = hostedCopySponsor) {
 const path = /^\/api\/v1\/rewards\/demo-copy\/(sponsor-source|sponsor-setups)(?:\/([^/]+))?$/.exec(url.pathname);
 if (!path) return false;
 deps.applyPrivateSessionHeaders(res);
 try {
  const env = loadServerEnv();
  if (!hostedCopyPreviewEnabled(process.env, env) || process.env.RACESON_REWARD_HOSTED_COPY_MODE !== 'sponsor-drafts-v1' || deps.config()?.chainId !== 10143) throw Error('hosted_copy_unavailable');
  const identity = await deps.requireIdentity(req);
  if ([...url.searchParams].length || path[1] === 'sponsor-source' && path[2] || !['GET','PATCH'].includes(req.method ?? '') || req.method === 'PATCH' && (!path[2] || path[1] !== 'sponsor-setups')) throw Error('invalid_reward_setup');
  const action = path[1] === 'sponsor-source' ? 'template' : req.method === 'PATCH' ? 'save' : path[2] ? 'read' : 'list';
  const id = action === 'template' ? randomUUID() : path[2] ? uuid.parse(path[2]) : null;
  const change = action === 'save' ? write.parse(await deps.readJsonBody(req)) : undefined;
  const { result, source } = await read(identity, action, id, change ? { ...change, configuration: change.configuration } : undefined, hostedCopyPin,
   deps.rpc ?? ((name, args) => createAdminSupabaseClient(env).rpc(name, args)));
  if (action === 'list') deps.sendSuccess(res, { items: result });
  else {
   const configuration = action === 'template' ? result as RewardDistributionSetup : (result as SavedRewardSetup).configuration;
   deps.sendSuccess(res, json({ ...(action === 'template' ? { id, configuration } : { record: result }),
    source: { name: 'Šibenik Trail League · five-round demo', rounds: 5, races: source.races.length, classifications: source.classifications.length },
    combinedReview: {note: hostedCopyReviewNote(hostedCopyPin)}, preview: previewRewardSetup(configuration), approvedWei: '0', fundedWei: '0', payableWei: '0' }));
  }
 } catch (error) {
  const code = error instanceof Error ? error.message : '';
  if (['Unauthorized','Missing bearer token','reward_account_session_required'].includes(code)) deps.sendError(res,401,'reward_auth_required','Sign in to the demo.');
  else if (['Untrusted browser origin','reward_demo_account_required','reward_demo_sponsor_required'].includes(code)) deps.sendError(res,403,'reward_demo_sponsor_required','Use the provisioned sponsor account.');
  else if (code === 'reward_setup_not_found') deps.sendError(res,404,code,'Campaign not found.');
  else if (code === 'reward_setup_conflict') deps.sendError(res,409,code,'This campaign changed. Reopen it before editing.');
  else if (code === 'reward_setup_limit') deps.sendError(res,409,code,'The saved campaign limit has been reached.');
  else if (code === 'invalid_reward_setup' || error instanceof z.ZodError) deps.sendError(res,400,'invalid_reward_setup','Check the campaign settings.');
  else deps.sendError(res,503,'hosted_copy_unavailable','The verified campaign could not be loaded or saved. Retry the same save before editing.');
 }
 return true;
}
