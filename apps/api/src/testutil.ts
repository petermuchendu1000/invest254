import type { AddressInfo } from "node:net";
import { DEFAULT_CONFIG, type Cents } from "@invest254/shared";
import {
  InMemoryEngagementRepository, InMemoryPaymentRepository, InMemoryGameRepository, StubDarajaClient,
  InMemoryIdentityRepository, PaymentService, ChatService, ActivityService, AuthService, AffiliateService, AdminService, InMemoryAdminRepository, maskHandle,
  NotificationService, InMemoryNotificationRepository,
  type FairnessRecord, type AuthClaims, type Verifier,
} from "@invest254/engine";
import { createApp, type ApiDeps, type WalletBalance } from "./app.js";

/**
 * In-memory test harness: builds an app from REAL engine services backed by in-memory
 * repositories, listens on an ephemeral port, and returns the base URL + a close fn + the
 * underlying fakes so tests can pre-seed and assert. No Postgres, no real network.
 *
 * The stub verifier accepts a `<userId>` or `<userId>:<role>` bearer token so player and
 * finance-admin routes can be exercised without minting JWTs. Chat rate-limiting is disabled
 * in the harness (rateLimitMs:0) — its time-based behaviour is covered by unit tests.
 */
export function stubVerifier(): Verifier {
  return async (token: string): Promise<AuthClaims> => {
    if (!token) throw new Error("TOKEN_REQUIRED");
    const [userId, role] = token.split(":");
    if (!userId) throw new Error("TOKEN_INVALID");
    return { userId, role: role || "player", raw: {} };
  };
}

export const TEST_USER = "u-test";
export const TEST_ADMIN = "u-admin";

export interface TestApi {
  baseUrl: string;
  deps: ApiDeps;
  identity: InMemoryIdentityRepository;
  engage: InMemoryEngagementRepository;
  payRepo: InMemoryPaymentRepository;
  gameRepo: InMemoryGameRepository;
  daraja: StubDarajaClient;
  fairness: Map<number, FairnessRecord>;
  bonus: Map<string, Cents>;
  withdrawalSuccesses: Array<{ userId: string; amountCents: Cents }>;
  notifications: NotificationService;
  close(): Promise<void>;
}

export interface TestApiOptions { startingBalanceCents?: Cents; depsOverrides?: Partial<ApiDeps>; }

export async function startTestApi(opts: TestApiOptions = {}): Promise<TestApi> {
  const engage = new InMemoryEngagementRepository();
  await engage.insertActivity({ kind: "signup", username: "newbie", amountCents: null, isSimulated: false, message: "@newbie just joined Invest254" });
  await engage.insertActivity({ kind: "win", username: "wanj***", amountCents: 500_000, isSimulated: false, message: "@wanj*** just won KES 5,000.00 on a ×3.50 trade" });
  engage.setUsername(TEST_USER, "tester");

  const payRepo = new InMemoryPaymentRepository();
  payRepo.seed(TEST_USER, opts.startingBalanceCents ?? 1_000_000); // KES 10,000
  const gameRepo = new InMemoryGameRepository();
  gameRepo.seed(TEST_USER, opts.startingBalanceCents ?? 1_000_000);
  const daraja = new StubDarajaClient();
  const withdrawalSuccesses: Array<{ userId: string; amountCents: Cents }> = [];
  const activity = new ActivityService(engage, () => {}, { enabled: false });

  const resolveHandle = async (userId: string): Promise<string> =>
    (await engage.getUsername(userId)) ?? `guest_${userId.slice(0, 6)}`;

  const payments = new PaymentService(payRepo, daraja, {
    events: {
      onWithdrawalSuccess: (e) => {
        withdrawalSuccesses.push(e);
        void resolveHandle(e.userId).then((h) => activity.recordWithdrawal(maskHandle(h), e.amountCents)).catch(() => {});
      },
    },
  });

  const chat = new ChatService(engage, { rateLimitMs: 0 });

  const fairness = new Map<number, FairnessRecord>([
    [1, { gameDayId: 1, tradeDate: "2026-06-17", serverSeedHash: "hash-yesterday", serverSeed: "revealed-seed-yesterday", revealedAt: "2026-06-18T00:00:00.000Z" }],
    [2, { gameDayId: 2, tradeDate: "2026-06-18", serverSeedHash: "hash-today", serverSeed: null, revealedAt: null }],
  ]);
  const bonus = new Map<string, Cents>();

  const identity = new InMemoryIdentityRepository();
  const auth = new AuthService(identity, { jwtSecret: "test-secret-which-is-long-enough-123456", jwtTtlSeconds: 3600 });
  const affiliate = new AffiliateService(identity, daraja);
  const admin = new AdminService(new InMemoryAdminRepository(identity, payRepo, engage, gameRepo));
  const notifications = new NotificationService(new InMemoryNotificationRepository());

  const deps: ApiDeps = {
    verifier: stubVerifier(),
    auth,
    affiliate,
    admin,
    notifications,
    config: () => DEFAULT_CONFIG,
    fairnessById: async (id) => fairness.get(id) ?? null,
    activity: { recent: (limit) => engage.listRecentActivity(limit) },
    payments,
    chat,
    resolveHandle,
    walletBalance: async (userId): Promise<WalletBalance> =>
      ({ real: await payRepo.getBalance(userId), bonus: bonus.get(userId) ?? 0, currency: "KES" }),
    ledger: (userId, q) => gameRepo.listLedger(userId, q),
    positions: (userId, q) => gameRepo.listPositions(userId, q),
    positionDetail: (userId, id) => gameRepo.getPositionDetail(userId, id),
    transactions: (userId, q) => payRepo.listTransactions(userId, q),
    ...opts.depsOverrides,
  };

  const server = createApp(deps);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    deps, identity, engage, payRepo, gameRepo, daraja, fairness, bonus, withdrawalSuccesses,
    notifications,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
