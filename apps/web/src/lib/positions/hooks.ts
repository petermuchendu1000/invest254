'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/endpoints';
import type { Paginated, PositionDto } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import type { PositionStatus } from '@invest254/shared';

export type PositionStatusFilter = PositionStatus | 'all';

/** Cursor-paginated bet history (GET /positions), newest-first. */
export function usePositions(status: PositionStatusFilter = 'all') {
  const token = useSession((s) => s.token);
  return useInfiniteQuery({
    queryKey: ['positions', status],
    enabled: !!token,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.positions(token as string, {
        cursor: pageParam,
        ...(status !== 'all' ? { status } : {}),
      }),
    getNextPageParam: (last: Paginated<PositionDto>) => last.nextCursor ?? undefined,
  });
}

/** Single owned position with provable-fairness detail (GET /positions/:id). */
export function usePositionDetail(id: string | null) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: ['position', id],
    enabled: !!token && !!id,
    queryFn: () => api.position(token as string, id as string),
  });
}
