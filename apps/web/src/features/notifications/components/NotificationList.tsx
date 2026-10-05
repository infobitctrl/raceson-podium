import { Bell, CalendarDays, CheckCheck, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/shared/i18n/I18nContext';
import { englishMessages, type TranslationKey } from '@/shared/i18n/messages';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNotifications } from '../data/useNotifications';
import type { InboxItem } from '../data/inbox';

export function NotificationList({ items, compact = false, onNavigate }: { items: InboxItem[]; compact?: boolean; onNavigate?: () => void }) {
  const { t, formatDate } = useI18n();
  const state = useNotifications();
  return <ul className="divide-y divide-border" aria-label={t('notifications.title')}>
    {items.map(item => {
      const historicalKey = `notifications.history.${item.kind}`;
      const candidate = item.isHistorical && historicalKey in englishMessages ? historicalKey : `notifications.${item.kind}`;
      const key: TranslationKey = candidate in englishMessages ? candidate as TranslationKey : 'notifications.fallback';
      const Icon = item.kind.includes('owner') || item.kind.includes('admin') ? ShieldCheck : item.category === 'clubs' ? Users : item.category === 'events' ? CalendarDays : Bell;
      return <li key={item.id} className={cn('relative flex gap-3 px-4 py-4 sm:px-5', !item.readAt && !item.archivedAt && 'bg-primary/[0.045]')}>
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-primary"><Icon aria-hidden className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{item.eventName || item.clubName || t('notifications.title')}</span>
            <time dateTime={item.createdAt}>{formatDate(item.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
            {item.isHistorical && <span className="rounded bg-muted px-1.5 py-0.5">{t('notifications.history')}</span>}
            {!item.readAt && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label={t('notifications.unread')} />}
          </div>
          <p className={cn('break-words text-sm leading-relaxed', !item.readAt && 'font-medium')}>{t(key, { clubName: item.clubName, eventName: item.eventName, personName: item.personName, roleName: item.roleName })}</p>
          {item.actionRequired && <span className={cn('mt-2 inline-flex items-center gap-1 text-xs font-medium', item.resolvedAt ? 'text-muted-foreground' : 'text-primary')}>
            {item.resolvedAt && <CheckCheck className="h-3 w-3" aria-hidden />}{t(item.resolvedAt ? 'notifications.resolved' : 'notifications.actionRequired')}
          </span>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link className="inline-flex min-h-9 items-center text-xs font-semibold text-primary underline-offset-4 hover:underline" to={item.targetPath} onClick={() => {
              if (!item.readAt && state) state.update.mutate({ id: item.id, action: 'read' });
              onNavigate?.();
            }}>{t(item.actionRequired && !item.resolvedAt ? 'notifications.review' : 'notifications.open')}</Link>
            {!compact && <>
              <Button size="sm" variant="ghost" className="h-9 text-xs" disabled={state?.update.isPending} onClick={() => state?.update.mutate({ id: item.id, action: item.readAt ? 'unread' : 'read' })}>{t(item.readAt ? 'notifications.markUnread' : 'notifications.markRead')}</Button>
              <Button size="sm" variant="ghost" className="h-9 text-xs text-muted-foreground" disabled={state?.update.isPending} onClick={() => state?.update.mutate({ id: item.id, action: item.archivedAt ? 'restore' : 'archive' })}>{t(item.archivedAt ? 'notifications.restore' : 'notifications.archive')}</Button>
            </>}
          </div>
        </div>
      </li>;
    })}
  </ul>;
}
