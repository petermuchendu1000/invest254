import type { Cents } from '@invest254/shared';

// ── Admin DTOs — mirror apps/engine/src/admin.ts wire shapes ──

export interface AdminOverview {
  users: {
    total: number;
    active: number;
    suspended: number;
    banned: number;
    players: number;
    marketers: number;
    admins: number;
  };
  finance: {
    depositsCents: Cents;
    withdrawalsCents: Cents;
    pendingWithdrawals: number;
    walletLiabilityCents: Cents;
  };
  affiliate: {
    marketers: number;
    commissionAccruedCents: Cents;
    commissionPaidCents: Cents;
    pendingPayouts: number;
  };
  game: { settledPositions: number; turnoverCents: Cents; ggrCents: Cents };
}

export interface RtpWindowRow {
  window: string;
  settledPositions: number;
  turnoverCents: Cents;
  payoutCents: Cents;
  realisedRtp: number | null;
}
export interface RtpMonitor {
  targetRtp: number;
  toleranceAbs: number;
  minSamples: number;
  windows: RtpWindowRow[];
  alert: boolean;
}

export interface AdminUserRow {
  userId: string;
  username: string;
  role: string;
  status: string;
  createdAtMs: number;
}
export interface AdminUserDetail extends AdminUserRow {
  phone: string;
  referredBy: string | null;
  realBalanceCents: Cents;
  bonusBalanceCents: Cents;
  turnoverCents: Cents;
  ggrCents: Cents;
}
export interface SetUserStatusResult {
  userId: string;
  status: string;
}
export interface SetUserRoleResult {
  userId: string;
  role: string;
}
export interface AdjustBalanceResult {
  userId: string;
  realBalanceCents: Cents;
  bonusBalanceCents: Cents;
}

export interface AdminUserActivityRow {
  kind: string;
  id: string;
  amountCents: Cents | null;
  status: string | null;
  createdAtMs: number;
  summary: string;
}

export interface AdminWithdrawalRow {
  txId: string;
  userId: string;
  amountCents: Cents;
  phone: string;
  status: string;
  createdAtMs: number;
}
export interface AdminDepositRow {
  txId: string;
  userId: string;
  amountCents: Cents;
  phone: string;
  status: string;
  mpesaReceipt: string | null;
  createdAtMs: number;
}
export interface AdminDepositsReconcile {
  stalePending: AdminDepositRow[];
  count: number;
}

export interface AdminPayoutRow {
  payoutId: string;
  marketerId: string;
  marketerName: string;
  amountCents: Cents;
  status: string;
  createdAtMs: number;
}

export interface GameConfigRow {
  version: number;
  minStakeCents: Cents;
  maxStakeCents: Cents;
  minDepositCents: Cents;
  maxDepositCents: Cents;
  minWithdrawalCents: Cents;
  maxWithdrawalCents: Cents;
  dailyWithdrawalCapCents: Cents;
  tradeDurationS: number;
  winRate: number;
  maxWinMultiplier: number;
  targetRtp: number;
  updatedAtMs: number;
}
export type GameConfigPatch = Partial<Omit<GameConfigRow, 'version' | 'updatedAtMs'>>;

export interface MpesaConfigRow {
  env: string;
  shortcode: string;
  callbackUrl: string;
  b2cEnabled: boolean;
  updatedAtMs: number;
}
export type MpesaConfigPatch = Partial<Omit<MpesaConfigRow, 'updatedAtMs'>>;

export interface AdminSeedRow {
  tradeDate: string;
  serverSeedHash: string;
  revealed: boolean;
  rotatedAtMs: number | null;
}
export interface SeedRotateResult {
  tradeDate: string;
  serverSeed: string;
}

export interface AdminChatModRow {
  id: number;
  userId: string;
  username: string;
  body: string;
  hidden: boolean;
  createdAtMs: number;
}

export interface DailyReportRow {
  day: string;
  signups: number;
  depositsCents: Cents;
  withdrawalsCents: Cents;
  turnoverCents: Cents;
  ggrCents: Cents;
}
export interface UserReportRow {
  userId: string;
  username: string;
  depositsCents: Cents;
  withdrawalsCents: Cents;
  turnoverCents: Cents;
  ggrCents: Cents;
}

export interface AdminAuditRow {
  id: number;
  actorId: string;
  action: string;
  target: string | null;
  meta: unknown;
  createdAtMs: number;
}

// ── User notifications (J7) ──
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';
export interface AdminNotificationRow {
  id: number;
  level: NotificationLevel;
  title: string;
  body: string;
  dismissible: boolean;
  category: string | null;
  createdAtMs: number;
  dismissedAtMs: number | null;
  resolvedAtMs: number | null;
}
export interface NotificationInput {
  title: string;
  body?: string;
  level?: NotificationLevel;
  dismissible?: boolean;
  category?: string | null;
}

// ── Per-user engine overrides (J8) ──
export interface UserOverrideRow {
  userId: string;
  winRate: number | null;
  tradeDurationS: number | null;
  maxWinMultiplier: number | null;
  minStakeCents: Cents | null;
  maxStakeCents: Cents | null;
  notes: string | null;
  updatedBy: string | null;
  updatedAtMs: number | null;
}
export interface UserOverridePatch {
  winRate?: number | null;
  tradeDurationS?: number | null;
  maxWinMultiplier?: number | null;
  minStakeCents?: Cents | null;
  maxStakeCents?: Cents | null;
  notes?: string | null;
}

// ── Marketers (special players who RECEIVE payments) ──
// Wire shapes mirror apps/api/src/app.marketers.ts (snake_case, as returned by the API).
export interface AdminMarketerRow {
  id: string;
  name: string;
  first_name: string;
  initials: string;
  phone: string;
  status: string;
  balance_cents: Cents;
  available_fuliza_cents: Cents;
  airtime_balance_cents: Cents;
  currency: string;
}
export interface AdminMarketerLedgerRow {
  id: number;
  entry_type: string;
  amount_cents: Cents;
  balance_after_cents: Cents;
  ref: string | null;
  meta: unknown;
  created_at: string;
}
export interface MarketerWithdrawResult {
  idempotent: boolean;
  balance_cents: Cents;
  withdrawal_id?: string;
  ledger_id: number;
}
