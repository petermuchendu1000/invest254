import {
  PgGameRepository, PgEngagementRepository, PgPaymentRepository, PgIdentityRepository,
  PaymentService, ChatService, ActivityService, AuthService, AffiliateService, AdminService, PgAdminRepository, makeDarajaClientFromConfig, loadDarajaConfigFromDb, makeVerifier, maskHandle,
  NotificationService, PgNotificationRepository,
  GameConfigStore,
  type GameRepository, type EngagementRepository, type PaymentRepository,
  type Querier, type FairnessRecord, type ListenClient,
} from "@invest254/engine";
import { createApp, type ApiDeps, type WalletBalance } from "./app.js";

/**
 * Production bootstrap for the HTTP API. Wires the Postgres-backed repositories, the
 * PaymentService (atomic 0014 RPCs + Daraja provider), ChatService, and the Supabase JWT
 * verifier from the environment, then listens. Withdrawal-success events are mirrored to
 * the activity feed (privacy-masked), demonstrating the end-to-end integration.
 *
 * `fairnessById`/`walletBalance` read leak-safe views/columns directly (single indexed
 * lookups) rather than widening the engine repository contract for two read paths.
 */
const PORT = Number(process.env.PORT ?? 8081);

async function buildDeps(): Promise<ApiDeps> {
  const verifier = makeVerifier();
  const usingDb = Boolean(process.env.DATABASE_URL);
  if (usingDb && !verifier) {
    throw new Error("AUTH: a JWT verifier is required when DATABASE_URL is set (set SUPABASE_JWT_SECRET or SUPABASE_JWKS_URL)");
  }
  if (!usingDb) throw new Error("DATABASE_URL is required to run the API server");

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = pool as unknown as Querier;

  // Live game configuration for the public GET /game/config. Same store the WS engine uses,
  // so the limits the browser validates against are the limits the engine enforces.
  const gameConfig = new GameConfigStore(q, {
    pollMs: Number(process.env.CONFIG_POLL_MS ?? 15_000),
    connect: async () => (await pool.connect()) as unknown as ListenClient,
    onError: (err: Error, ctx: string) => console.error(`[api] config ${ctx}:`, err.message),
  });
  await gameConfig.init();
  console.log(`[api] game_config v${gameConfig.active().version} loaded from database`);

  const repo: GameRepository = new PgGameRepository(q);
  const engage: EngagementRepository = new PgEngagementRepository(q);
  const payRepo: PaymentRepository = new PgPaymentRepository(q);

  // Real activity feed: record genuine withdrawals (masked). No simulator in the API process
  // (the WS engine owns the simulated feed); emit is a no-op since the API doesn't broadcast.
  const activity = new ActivityService(engage, () => {}, { enabled: false });

  const resolveHandle = async (userId: string): Promise<string> =>
    (await engage.getUsername(userId)) ?? `guest_${userId.slice(0, 6)}`;

  // M-Pesa config is admin-managed in the DB (table 0024); fall back to env per field.
  const daraja = makeDarajaClientFromConfig(await loadDarajaConfigFromDb(q));
  const payments = new PaymentService(payRepo, daraja, {
    // Verify STK callbacks against Safaricom (STKPushQuery) before crediting — defeats forged
    // callbacks. Set MPESA_VERIFY_CALLBACKS=false only if the callback source is otherwise trusted.
    verifyStkCallbacks: process.env.MPESA_VERIFY_CALLBACKS !== "false",
    events: {
      onWithdrawalSuccess: ({ userId, amountCents }) => {
        void resolveHandle(userId)
          .then((h) => activity.recordWithdrawal(maskHandle(h), amountCents))
          .catch((err) => console.error("[api] activity.recordWithdrawal:", (err as Error).message));
      },
    },
  });

  const chat = new ChatService(engage);

  // Self-managed auth issues HS256 tokens signed with SUPABASE_JWT_SECRET — the same secret
  // makeVerifier checks. Asymmetric (JWKS) verification can't verify our self-issued tokens.
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("AUTH: SUPABASE_JWT_SECRET is required for self-managed register/login (HS256 issuance)");
  }
  const identity = new PgIdentityRepository(q);
  const auth = new AuthService(identity, {
    jwtSecret,
    // No-OTP password reset is account takeover unless verified — opt in deliberately.
    allowUnverifiedPasswordReset: process.env.ALLOW_UNVERIFIED_PASSWORD_RESET === "true",
    ...(process.env.SUPABASE_JWT_ISSUER ? { issuer: process.env.SUPABASE_JWT_ISSUER } : {}),
    ...(process.env.SUPABASE_JWT_AUD ? { audience: process.env.SUPABASE_JWT_AUD } : {}),
  });
  const affiliate = new AffiliateService(identity, daraja);
  const admin = new AdminService(new PgAdminRepository(q));
  const notifications = new NotificationService(new PgNotificationRepository(q));

  return {
    verifier,
    auth,
    affiliate,
    admin,
    notifications,
    config: () => gameConfig.active(),
    fairnessById: async (gameDayId: number): Promise<FairnessRecord | null> => {
      const r = await q.query(
        "select id, trade_date, server_seed_hash, server_seed, revealed_at from v_fairness where id = $1",
        [gameDayId],
      );
      if (!r.rows.length) return null;
      const x = r.rows[0];
      return {
        gameDayId: x.id === null || x.id === undefined ? null : Number(x.id),
        tradeDate: x.trade_date instanceof Date ? x.trade_date.toISOString().slice(0, 10) : String(x.trade_date),
        serverSeedHash: String(x.server_seed_hash),
        serverSeed: x.server_seed ?? null,
        revealedAt: x.revealed_at ? (x.revealed_at instanceof Date ? x.revealed_at.toISOString() : String(x.revealed_at)) : null,
      };
    },
    activity: { recent: (limit: number) => engage.listRecentActivity(limit) },
    payments,
    chat,
    resolveHandle,
    walletBalance: async (userId: string): Promise<WalletBalance> => {
      const r = await q.query("select real_balance, bonus_balance, currency from wallets where user_id = $1", [userId]);
      if (!r.rows.length) return { real: 0, bonus: 0, currency: "KES" };
      const x = r.rows[0];
      const toCents = (v: unknown): number => (typeof v === "string" ? Number(v) : (v as number)) || 0;
      return { real: toCents(x.real_balance), bonus: toCents(x.bonus_balance), currency: String(x.currency ?? "KES") };
    },
    ledger: (userId, qy) => repo.listLedger(userId, qy),
    positions: (userId, qy) => repo.listPositions(userId, qy),
    positionDetail: (userId, id) => repo.getPositionDetail(userId, id),
    transactions: (userId, qy) => payRepo.listTransactions(userId, qy),
  };
}

const deps = await buildDeps();
const server = createApp(deps);
server.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}  auth=${deps.verifier ? "jwt" : "dev"}`);
});

// Deposit reconciliation sweep: settles deposits whose STK callback never arrived (or whose
// verification was inconclusive) using Safaricom's authoritative STKPushQuery status, so no paid
// deposit is left stranded and no unpaid one is credited. Set to 0 to disable.
const RECONCILE_MS = Number(process.env.DEPOSIT_RECONCILE_INTERVAL_MS ?? 300_000);
if (Number.isFinite(RECONCILE_MS) && RECONCILE_MS > 0) {
  const timer = setInterval(() => {
    void deps.payments
      .reconcileDeposits()
      .then((r) => { if (r.settled || r.errors) console.log("[payments] reconcile", r); })
      .catch((err: unknown) => console.error("[payments] reconcile sweep failed:", (err as Error).message));
  }, RECONCILE_MS);
  timer.unref();
  console.log(`[api] deposit reconciliation every ${Math.round(RECONCILE_MS / 1000)}s`);
}
