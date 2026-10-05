import type { RequestSession } from '@raceson/domain/auth';
import { createAdminSupabaseClient } from '../supabase.js';
import { loadServerEnv, type ServerEnv } from '../env.js';
import { notFound } from '../errors.js';

export type NotificationFilter = 'all' | 'unread' | 'archived';
export type InboxNotification = {
  id: string; kind: string; category: string; clubName: string; personName: string;
  eventName: string; isHistorical: boolean;
  roleName: string; targetPath: string; actionRequired: boolean; resolvedAt: string | null;
  readAt: string | null; archivedAt: string | null; createdAt: string;
};
export type NotificationCursor = { at: string; id: string };
export async function getNotificationInbox(session: RequestSession, input: {
  filter: NotificationFilter; limit: number; before?: NotificationCursor;
}, env: ServerEnv = loadServerEnv()) {
  const client = createAdminSupabaseClient(env);
  const { data, error } = await client.rpc('service_notification_inbox', {
    p_user_id: session.account.userId, p_filter: input.filter, p_limit: input.limit,
    p_before_at: input.before?.at ?? null, p_before_id: input.before?.id ?? null,
  });
  if (error) throw error;
  const result = data as { items: InboxNotification[]; unreadCount: number; snapshotAt: string };
  const hasMore = result.items.length > input.limit;
  const items = result.items.slice(0, input.limit);
  const last = items.at(-1);
  return { ...result, items, nextCursor: hasMore && last ? { at: last.createdAt, id: last.id } : null };
}
export async function updateNotification(session: RequestSession, id: string,
  action: 'read' | 'unread' | 'archive' | 'restore', env: ServerEnv = loadServerEnv()) {
  const now = new Date().toISOString();
  const patch = action === 'read' ? { read_at: now } : action === 'unread' ? { read_at: null }
    : action === 'archive' ? { archived_at: now } : { archived_at: null };
  const { data, error } = await createAdminSupabaseClient(env).from('user_notifications')
    .update(patch).eq('user_id', session.account.userId).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Notification not found');
  return { updated: true };
}
export async function markNotificationsRead(session: RequestSession, through: string,
  env: ServerEnv = loadServerEnv()) {
  const now = new Date().toISOString();
  const cutoff = Date.parse(through) <= Date.parse(now) ? through : now;
  const { error } = await createAdminSupabaseClient(env).from('user_notifications')
    .update({ read_at: now }).eq('user_id', session.account.userId)
    .is('read_at', null).is('archived_at', null).lte('created_at', cutoff);
  if (error) throw error;
  return { updated: true };
}
