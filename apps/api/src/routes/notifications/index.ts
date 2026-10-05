import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RequestSession } from '@raceson/domain/auth';
import { getNotificationInbox, markNotificationsRead, updateNotification, type ServerEnv } from '@raceson/db';
import { z } from 'zod';
type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
type Dependencies = {
  env: ServerEnv;
  requireSession: (request: IncomingMessage) => Promise<RequestSession>;
  readJsonBody: (request: IncomingMessage) => Promise<JsonValue>;
  sendSuccess: (response: ServerResponse<IncomingMessage>, payload: JsonValue, statusCode?: number) => void;
  applyPrivateSessionHeaders: (response: ServerResponse<IncomingMessage>) => void;
};
const timestamp = z.string().datetime({ offset: true });
export const notificationQuerySchema = z.object({
  filter: z.enum(['all','unread','archived']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  beforeAt: timestamp.optional(), beforeId: z.string().uuid().optional(),
}).strict().refine(value => Boolean(value.beforeAt) === Boolean(value.beforeId), 'Complete cursor required');
export const notificationActionSchema = z.object({ action: z.enum(['read','unread','archive','restore']) }).strict();
const markAllSchema = z.object({ through: timestamp }).strict();
export async function dispatchNotificationRoutes(req: IncomingMessage, res: ServerResponse<IncomingMessage>, url: URL, deps: Dependencies) {
  const match = url.pathname.match(/^\/api\/v1\/account\/notifications(?:\/([^/]+))?$/);
  if (!match) return false;
  deps.applyPrivateSessionHeaders(res);
  const session = await deps.requireSession(req);
  if (req.method === 'GET' && !match[1]) {
    const query = notificationQuerySchema.parse(Object.fromEntries(url.searchParams));
    deps.sendSuccess(res, await getNotificationInbox(session, {
      filter: query.filter, limit: query.limit,
      before: query.beforeAt && query.beforeId ? { at: query.beforeAt, id: query.beforeId } : undefined,
    }, deps.env));
    return true;
  }
  if (req.method === 'POST' && match[1] === 'read-all') {
    const body = markAllSchema.parse(await deps.readJsonBody(req));
    deps.sendSuccess(res, await markNotificationsRead(session, body.through, deps.env));
    return true;
  }
  if (req.method === 'POST' && match[1]) {
    const id = z.string().uuid().parse(match[1]);
    const body = notificationActionSchema.parse(await deps.readJsonBody(req));
    deps.sendSuccess(res, await updateNotification(session, id, body.action, deps.env));
    return true;
  }
  return false;
}
