import { Bell, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/shared/i18n/I18nContext';
import { useNotifications } from '../data/useNotifications';
import { NotificationList } from './NotificationList';
export default function NotificationPanel({ onClose }: { onClose: () => void }) {
  const state = useNotifications();
  const { t } = useI18n();
  if (!state) return null;
  const { recent, update } = state;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent position="top" className="max-w-[min(30rem,calc(100vw-1rem))] gap-0 overflow-hidden bg-background p-0">
    <div className="border-b border-border px-5 pb-4 pt-6 pr-14"><DialogTitle>{t('notifications.title')}</DialogTitle><DialogDescription className="mt-2 text-xs">{t('notifications.intro')}</DialogDescription></div>
    <div className="max-h-[60dvh] overflow-y-auto">
      {recent.isPending ? <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('notifications.loading')}</p>
        : recent.isError ? <div role="alert" className="p-5 text-sm"><p>{t('notifications.error')}</p><Button variant="outline" className="mt-3" onClick={() => void recent.refetch()}>{t('notifications.retry')}</Button></div>
        : recent.data.items.length ? <NotificationList items={recent.data.items} compact onNavigate={onClose} />
        : <div className="p-8 text-center"><Bell className="mx-auto mb-3 h-6 w-6 text-muted-foreground" /><p className="text-sm font-medium">{t('notifications.empty')}</p><p className="mt-2 text-xs text-muted-foreground">{t('notifications.emptyBody')}</p></div>}
    </div>
    {update.isError && <p role="alert" className="px-5 py-3 text-sm text-destructive">{t('notifications.saveError')}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4">
      <Button variant="ghost" size="sm" disabled={update.isPending || recent.isError || !recent.data?.unreadCount} onClick={() => { if (recent.data) update.mutate({ through: recent.data.snapshotAt }); }}>{t('notifications.markAllRead')}</Button>
      <Link to="/notifications" onClick={onClose} className="inline-flex min-h-10 items-center text-sm font-semibold text-primary">{t('notifications.viewAll')}</Link>
    </div>
  </DialogContent></Dialog>;
}
