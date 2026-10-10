'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/endpoints';
import type { CommissionRecord, Paginated, ReferralRecord } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';

/** Marketer dashboard summary. Enabled only when the caller is an enrolled marketer. */
export function useAffiliateSummary(enabled: boolean) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: ['affiliate', 'summary'],
    queryFn: () => api.affiliateSummary(token as string),
    enabled: !!token && enabled,
    retry: false,
  });
}

/** Realtime marketer performance — same summary, but polled every 5s while the live HUD is open. */
export function useMarketerLiveSummary(enabled: boolean) {  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: ['affiliate', 'summary', 'live'],
    queryFn: () => api.affiliateSummary(token as string),
    enabled: !!token && enabled,
    retry: false,
    refetchInterval: enabled ? 5000 : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

/** The marketer's own profile incl. the simulated (funny-money) wallet balance. */
export function useMarketerProfile(enabled: boolean) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: ['marketer', 'me'],
    queryFn: () => api.marketerMe(token as string),
    enabled: !!token && enabled,
    retry: false,
    staleTime: 0,
  });
}

/** Self-service: top the marketer's own demo wallet up to the policy cap (no real cash). */
export function useMarketerDemoTopup() {
  const token = useSession((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.marketerDemoTopup(token as string),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['marketer', 'me'] }); },
  });
}

export function useAffiliateReferrals(enabled: boolean) {
  const token = useSession((s) => s.token);
  return useInfiniteQuery({
    queryKey: ['affiliate', 'referrals'],
    enabled: !!token && enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.affiliateReferrals(token as string, { cursor: pageParam }),
    getNextPageParam: (last: Paginated<ReferralRecord>) => last.nextCursor ?? undefined,
  });
}

export function useAffiliateCommissions(enabled: boolean) {
  const token = useSession((s) => s.token);
  return useInfiniteQuery({
    queryKey: ['affiliate', 'commissions'],
    enabled: !!token && enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.affiliateCommissions(token as string, { cursor: pageParam }),
    getNextPageParam: (last: Paginated<CommissionRecord>) => last.nextCursor ?? undefined,
  });
}

/** Enroll the current user as a marketer (idempotent server-side). */
export function useAffiliateEnroll() {
  const token = useSession((s) => s.token);
  const setToken = useSession((s) => s.setToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.affiliateEnroll(token as string),
    onSuccess: (data) => {
      // Adopt the reissued marketer token so the marketer-gated dashboard routes succeed.
      if (data.token) setToken(data.token);
      void qc.invalidateQueries({ queryKey: ['affiliate'] });
    },
  });
}

/** Request a payout of all available commission. */
export function useAffiliatePayout() {
  const token = useSession((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.affiliateRequestPayout(token as string),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['affiliate', 'summary'] });
      void qc.invalidateQueries({ queryKey: ['affiliate', 'commissions'] });
    },
  });
}

/** Admin-logged expenses attributed to the marketer (transparency). Polled with the live HUD. */
export function useAffiliateExpenses(enabled: boolean) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: ['affiliate', 'expenses'],
    queryFn: () => api.affiliateExpenses(token as string),
    enabled: !!token && enabled,
    retry: false,
    refetchInterval: enabled ? 15000 : false,
  });
}

/** The marketer's own advance requests (newest first) — polled so admin decisions surface live. */
export function useMyAdvances(enabled: boolean) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: ['affiliate', 'advances'],
    queryFn: () => api.affiliateAdvances(token as string),
    enabled: !!token && enabled,
    retry: false,
    refetchInterval: enabled ? 15000 : false,
  });
}

/** Request a cash advance against future commission (one open request at a time). */
export function useRequestAdvance() {
  const token = useSession((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { amountCents: number; reason?: string }) => api.requestAdvance(token as string, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['affiliate', 'advances'] }); },
  });
}

/** Cancel the marketer's own still-pending advance request. */
export function useCancelAdvance() {
  const token = useSession((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelAdvance(token as string, id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['affiliate', 'advances'] }); },
  });
}

// ── Deposit-based referral commissions (0078/0079) — available to every authed user ─────────────
/** The caller's referral code, link and commission balance (players + marketers). */
export function useReferral(enabled = true) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: ['referral', 'me'],
    queryFn: () => api.myReferral(token as string),
    enabled: !!token && enabled,
    retry: false,
  });
}

/** The caller's commission line-items (newest first). */
export function useMyCommissions(enabled = true) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: ['referral', 'commissions'],
    queryFn: () => api.myReferralCommissions(token as string),
    enabled: !!token && enabled,
    retry: false,
  });
}

/** Request a commission payout (marketer balance must be >= KES 500). Refreshes the summary. */
export function useRequestCommissionPayout() {
  const token = useSession((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.requestCommissionPayout(token as string),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['referral', 'me'] });
      qc.invalidateQueries({ queryKey: ['referral', 'commissions'] });
    },
  });
}

// ── Live sessions (docs/55) ─────────────────────────────────────────────────────────────────────
// A marketer marks when they go live; the earnings shown are a REPORT over commissions already
// attributed to them, so nothing here moves money.

/**
 * The brand's live rules, the running session, and recent history.
 *
 * Polled while a session is RUNNING, because the figure it shows is what the session has earned so
 * far and a marketer watching their own stream is watching this number. Idle otherwise — a marketer
 * who is not live has nothing changing.
 */
export function useMarketerLive(enabled: boolean) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: ['marketer', 'live'],
    queryFn: () => api.marketerLive(token as string),
    enabled: !!token && enabled,
    retry: false,
    refetchInterval: (q) => (q.state.data?.current?.live ? 15_000 : false),
    refetchIntervalInBackground: false,
  });
}

/** Start / end / extend. Each settles by refetching the one query above, so the UI has one truth. */
export function useLiveSessionActions() {
  const token = useSession((s) => s.token);
  const qc = useQueryClient();
  const settle = { onSettled: () => void qc.invalidateQueries({ queryKey: ['marketer', 'live'] }) };
  return {
    start: useMutation({ mutationFn: (streamUrl?: string) => api.marketerLiveStart(token as string, streamUrl), ...settle }),
    end: useMutation({ mutationFn: () => api.marketerLiveEnd(token as string), ...settle }),
    extend: useMutation({ mutationFn: () => api.marketerLiveExtend(token as string), ...settle }),
  };
}
