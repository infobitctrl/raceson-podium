import { createContext, useContext } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changeNotification, loadInbox, readAllNotifications, type NotificationAction } from './inbox';

export function useNotificationState(userId: string, accessToken: string) {
  const client = useQueryClient();
  const key = ['notifications', userId];
  const recent = useQuery({ queryKey: [...key, 'recent'], queryFn: () => loadInbox(accessToken, 'all', null, 6),
    enabled: Boolean(userId && accessToken), staleTime: 5_000, refetchInterval: 20_000,
    refetchIntervalInBackground: false, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always', retry: 1 });
  const update = useMutation({
    mutationFn: (input: { id: string; action: NotificationAction } | { through: string }) =>
      'through' in input ? readAllNotifications(accessToken, input.through) : changeNotification(accessToken, input.id, input.action),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  return { userId, accessToken, recent, update };
}
type NotificationState = ReturnType<typeof useNotificationState>;
export const NotificationContext = createContext<NotificationState | null>(null);
export const useNotifications = () => useContext(NotificationContext);
