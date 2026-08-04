'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/endpoints';
import { useSession } from '@/lib/auth/session';

/** The player's active sticky notifications. Polls so admin-raised notices appear without a reload. */
export function useMyNotifications() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: ['notifications'],
    enabled: !!token,
    queryFn: () => api.notifications(token as string),
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
    staleTime: 20_000,
  });
}

/** Dismiss a dismissible notification (blocking ones 409 and stay put). */
export function useDismissNotification() {
  const token = useSession((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.dismissNotification(token as string, id),
    // Optimistically drop it so the X feels instant; refetch reconciles.
    onMutate: async (id: number) => {
      await qc.cancelQueries({ queryKey: ['notifications'] });
      const prev = qc.getQueryData<{ items: { id: number }[] }>(['notifications']);
      if (prev) qc.setQueryData(['notifications'], { items: prev.items.filter((n) => n.id !== id) });
      return { prev };
    },
    onError: (_e, _id, ctx) => { if (ctx?.prev) qc.setQueryData(['notifications'], ctx.prev); },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
