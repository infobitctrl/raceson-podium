import { lazy, Suspense, useState } from 'react';
import { Bell } from 'lucide-react';
import { useI18n } from '@/shared/i18n/I18nContext';
import { cn } from '@/lib/utils';
import { useNotifications } from '../data/useNotifications';
const NotificationPanel = lazy(() => import('./NotificationPanel'));
export function NotificationBell({ inverted = false }: { inverted?: boolean }) {
  const state = useNotifications();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!state) return null;
  const count = state.recent.data?.unreadCount;
  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={open}
      aria-label={state.recent.isError ? t('notifications.error') : count ? t('notifications.unreadCount', { count }) : t('notifications.title')}
      className={cn('relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', inverted && 'text-white/85 hover:bg-white/10')}
      onClick={() => { setOpen(true); void state.recent.refetch(); }}>
      <Bell className="h-[18px] w-[18px]" aria-hidden />
      {(state.recent.isError || Boolean(count)) && <span aria-hidden className="absolute right-0 top-0 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{state.recent.isError ? '!' : count! > 99 ? '99+' : count}</span>}
    </button>
    {open && <Suspense fallback={null}><NotificationPanel onClose={() => setOpen(false)} /></Suspense>}
  </>;
}
