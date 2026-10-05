import { apiRequest } from '@/lib/api';
export type InboxFilter = 'all' | 'unread' | 'archived';
export type NotificationAction = 'read' | 'unread' | 'archive' | 'restore';
export type InboxCursor = { at: string; id: string };
export type InboxItem = {
  id: string; kind: string; category: string; clubName: string; personName: string;
  eventName: string; isHistorical: boolean;
  roleName: string; targetPath: string; actionRequired: boolean;
  resolvedAt: string | null; readAt: string | null; archivedAt: string | null; createdAt: string;
};
export type InboxPage = { items: InboxItem[]; unreadCount: number; snapshotAt: string; nextCursor: InboxCursor | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const optionalDate = (value: unknown) => value === null || isDate(value);
function isNotificationTarget(path: string) {
  if (/^\/organizer\/registrations(?:\/finance)?\?edition=/.test(path)) {
    if (path.split('?').length !== 2) return false;
    const [route, query] = path.split('?');
    const params = new URLSearchParams(query);
    return ['/organizer/registrations', '/organizer/registrations/finance'].includes(route)
      && [...params].length === 1 && uuid.test(params.get('edition') ?? '') && !path.includes('#');
  }
  return /^\/(?:athlete\/clubs(?:\/[^/?#]+\/club)?|clubs\/[^/?#]+|organizer\/requests)(?:\?[^#]*)?$/.test(path);
}
export function decodeInbox(value: unknown): InboxPage {
  if (!value || typeof value !== 'object') throw new Error('Invalid inbox');
  const page = value as InboxPage;
  if (!Array.isArray(page.items) || page.items.length > 50 || !Number.isSafeInteger(page.unreadCount)
    || page.unreadCount < 0 || !isDate(page.snapshotAt)) throw new Error('Invalid inbox');
  const items = page.items.map((item) => {
    if (!item || typeof item !== 'object' || !uuid.test(item.id)
      || !['kind','category','clubName','personName','roleName','targetPath'].every(key => typeof item[key as keyof InboxItem] === 'string')
      || !isNotificationTarget(item.targetPath)
      || (item.eventName !== undefined && typeof item.eventName !== 'string')
      || (item.isHistorical !== undefined && typeof item.isHistorical !== 'boolean')
      || (item.category === 'events' && (typeof item.eventName !== 'string' || !item.eventName))
      || /[\\\s]/.test(item.targetPath) || [...item.targetPath].some(character => character.charCodeAt(0) < 32)
      || typeof item.actionRequired !== 'boolean' || !isDate(item.createdAt)
      || !optionalDate(item.readAt) || !optionalDate(item.archivedAt) || !optionalDate(item.resolvedAt)) throw new Error('Invalid notification');
    // Whitelist the browser projection: never forward unexpected server fields.
    return { id: item.id, kind: item.kind, category: item.category, clubName: item.clubName,
      eventName: item.eventName ?? '', isHistorical: item.isHistorical ?? false,
      personName: item.personName, roleName: item.roleName, targetPath: item.targetPath,
      actionRequired: item.actionRequired, resolvedAt: item.resolvedAt, readAt: item.readAt,
      archivedAt: item.archivedAt, createdAt: item.createdAt };
  });
  const cursor = page.nextCursor;
  if (cursor !== null && (!cursor || !isDate(cursor.at) || !uuid.test(cursor.id))) throw new Error('Invalid cursor');
  return { items, unreadCount: page.unreadCount, snapshotAt: page.snapshotAt,
    nextCursor: cursor ? { at: cursor.at, id: cursor.id } : null };
}
export async function loadInbox(accessToken: string, filter: InboxFilter = 'all', before: InboxCursor | null = null, limit = 25) {
  const params = new URLSearchParams({ filter, limit: String(limit) });
  if (before) { params.set('beforeAt', before.at); params.set('beforeId', before.id); }
  return decodeInbox(await apiRequest<unknown>({ path: `/v1/account/notifications?${params}`, accessToken, cache: 'no-store' }));
}
export function changeNotification(accessToken: string, id: string, action: NotificationAction) {
  return apiRequest({ path: `/v1/account/notifications/${id}`, method: 'POST', accessToken, cache: 'no-store', body: { action } });
}
export function readAllNotifications(accessToken: string, through: string) {
  return apiRequest({ path: '/v1/account/notifications/read-all', method: 'POST', accessToken, cache: 'no-store', body: { through } });
}
