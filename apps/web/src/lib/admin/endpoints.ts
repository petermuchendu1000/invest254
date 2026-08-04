import { apiFetch } from '@/lib/api/client';
import type { Paginated } from '@/lib/api/types';
import type {
  AdjustBalanceResult,
  AdminAuditRow,
  AdminChatModRow,
  AdminNotificationRow,
  NotificationInput,
  UserOverrideRow,
  UserOverridePatch,
  AdminDepositRow,
  AdminDepositsReconcile,
  AdminOverview,
  AdminPayoutRow,
  AdminUserActivityRow,
  AdminUserDetail,
  AdminUserRow,
  AdminWithdrawalRow,
  DailyReportRow,
  GameConfigPatch,
  GameConfigRow,
  MpesaConfigPatch,
  MpesaConfigRow,
  RtpMonitor,
  AdminSeedRow,
  SeedRotateResult,
  SetUserRoleResult,
  SetUserStatusResult,
  UserReportRow,
} from '@/lib/admin/types';

interface Page {
  cursor?: string | null | undefined;
  limit?: number | undefined;
}

/** Typed admin REST client. One function per route; all admin-gated (bearer token required). */
export const adminApi = {
  overview: (t: string) => apiFetch<AdminOverview>('/admin/overview', { token: t }),
  rtp: (t: string) => apiFetch<RtpMonitor>('/admin/rtp', { token: t }),

  // Users
  users: (t: string, p: Page & { role?: string | undefined; status?: string | undefined; q?: string | undefined } = {}) =>
    apiFetch<Paginated<AdminUserRow>>('/admin/users', {
      token: t,
      query: { cursor: p.cursor ?? undefined, limit: p.limit, role: p.role, status: p.status, q: p.q },
    }),
  user: (t: string, id: string) => apiFetch<AdminUserDetail>(`/admin/users/${id}`, { token: t }),
  userActivity: (t: string, id: string, p: Page & { kind?: string | undefined } = {}) =>
    apiFetch<Paginated<AdminUserActivityRow>>(`/admin/users/${id}/activity`, {
      token: t,
      query: { cursor: p.cursor ?? undefined, limit: p.limit, kind: p.kind },
    }),
  setUserStatus: (t: string, id: string, action: 'suspend' | 'ban' | 'reactivate', reason?: string) =>
    apiFetch<SetUserStatusResult>(`/admin/users/${id}/${action}`, { method: 'POST', token: t, body: { reason } }),
  setUserRole: (t: string, id: string, role: string) =>
    apiFetch<SetUserRoleResult>(`/admin/users/${id}/role`, { method: 'POST', token: t, body: { role } }),
  adjustBalance: (t: string, id: string, amountCents: number, reason: string, kind?: 'real' | 'bonus') =>
    apiFetch<AdjustBalanceResult>(`/admin/wallets/${id}/adjust`, { method: 'POST', token: t, body: { amountCents, reason, kind } }),
  clearBalance: (t: string, id: string, kind: 'real' | 'bonus' | 'both', reason: string) =>
    apiFetch<{ userId: string; realBalanceCents: number; bonusBalanceCents: number }>(`/admin/wallets/${id}/clear`, { method: 'POST', token: t, body: { kind, reason } }),
  userOverrides: (t: string, id: string) =>
    apiFetch<UserOverrideRow>(`/admin/users/${id}/overrides`, { token: t }),
  setUserOverrides: (t: string, id: string, patch: UserOverridePatch) =>
    apiFetch<UserOverrideRow>(`/admin/users/${id}/overrides`, { method: 'POST', token: t, body: patch }),

  // Finance — withdrawals + deposits
  withdrawals: (t: string, p: Page & { status?: string | undefined } = {}) =>
    apiFetch<Paginated<AdminWithdrawalRow>>('/admin/withdrawals', {
      token: t,
      query: { cursor: p.cursor ?? undefined, limit: p.limit, status: p.status },
    }),
  approveWithdrawal: (t: string, id: string) =>
    apiFetch<unknown>(`/admin/withdrawals/${id}/approve`, { method: 'POST', token: t }),
  rejectWithdrawal: (t: string, id: string) =>
    apiFetch<unknown>(`/admin/withdrawals/${id}/reject`, { method: 'POST', token: t }),
  deposits: (t: string, p: Page & { status?: string | undefined } = {}) =>
    apiFetch<Paginated<AdminDepositRow>>('/admin/deposits', {
      token: t,
      query: { cursor: p.cursor ?? undefined, limit: p.limit, status: p.status },
    }),
  depositsReconcile: (t: string, staleMinutes = 15) =>
    apiFetch<AdminDepositsReconcile>('/admin/deposits/reconcile', { token: t, query: { staleMinutes } }),

  // Affiliates
  affiliatePayouts: (t: string, p: Page & { status?: string | undefined } = {}) =>
    apiFetch<Paginated<AdminPayoutRow>>('/admin/affiliate/payouts', {
      token: t,
      query: { cursor: p.cursor ?? undefined, limit: p.limit, status: p.status },
    }),
  approvePayout: (t: string, id: string) =>
    apiFetch<unknown>(`/admin/affiliate/payouts/${id}/approve`, { method: 'POST', token: t }),
  rejectPayout: (t: string, id: string) =>
    apiFetch<unknown>(`/admin/affiliate/payouts/${id}/reject`, { method: 'POST', token: t }),
  setCommissionRate: (t: string, id: string, rate: number) =>
    apiFetch<unknown>(`/admin/affiliates/${id}/rate`, { method: 'PATCH', token: t, body: { rate } }),

  // Game config / RTP / seeds
  gameConfig: (t: string) => apiFetch<GameConfigRow>('/admin/game-config', { token: t }),
  updateGameConfig: (t: string, patch: GameConfigPatch) =>
    apiFetch<GameConfigRow>('/admin/game-config', { method: 'PATCH', token: t, body: patch }),
  mpesaConfig: (t: string) => apiFetch<MpesaConfigRow>('/admin/mpesa-config', { token: t }),
  updateMpesaConfig: (t: string, patch: MpesaConfigPatch) =>
    apiFetch<MpesaConfigRow>('/admin/mpesa-config', { method: 'PATCH', token: t, body: patch }),
  seeds: (t: string, limit = 30) => apiFetch<{ items: AdminSeedRow[] }>('/admin/seeds', { token: t, query: { limit } }),
  rotateSeed: (t: string, tradeDate: string) =>
    apiFetch<SeedRotateResult>('/admin/seeds/rotate', { method: 'POST', token: t, body: { tradeDate } }),

  // Engagement — chat moderation
  chat: (t: string, includeHidden = false, limit = 50) =>
    apiFetch<{ items: AdminChatModRow[] }>('/admin/chat', { token: t, query: { includeHidden, limit } }),
  hideChat: (t: string, id: number) => apiFetch<unknown>(`/admin/chat/${id}/hide`, { method: 'POST', token: t }),
  unhideChat: (t: string, id: number) => apiFetch<unknown>(`/admin/chat/${id}/unhide`, { method: 'POST', token: t }),

  // Reports + audit
  reportDaily: (t: string, range: { from?: string | undefined; to?: string | undefined } = {}) =>
    apiFetch<{ items: DailyReportRow[] }>('/admin/reports/daily', { token: t, query: { from: range.from, to: range.to } }),
  reportUsers: (t: string, range: { from?: string | undefined; to?: string | undefined } = {}) =>
    apiFetch<{ items: UserReportRow[] }>('/admin/reports/users', { token: t, query: { from: range.from, to: range.to } }),
  audit: (t: string, p: Page = {}) =>
    apiFetch<Paginated<AdminAuditRow>>('/admin/audit', {
      token: t,
      query: { cursor: p.cursor ?? undefined, limit: p.limit },
    }),

  // User notifications (J7) — raise a sticky banner for a player; list + resolve.
  userNotifications: (t: string, id: string) =>
    apiFetch<{ items: AdminNotificationRow[] }>(`/admin/users/${id}/notifications`, { token: t }),
  sendNotification: (t: string, id: string, body: NotificationInput) =>
    apiFetch<AdminNotificationRow>(`/admin/users/${id}/notifications`, { method: 'POST', token: t, body }),
  resolveNotification: (t: string, id: number) =>
    apiFetch<{ resolved: boolean }>(`/admin/notifications/${id}/resolve`, { method: 'POST', token: t }),
};
