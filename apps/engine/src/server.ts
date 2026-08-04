import { WebSocketServer, type WebSocket } from "ws";
import { type Direction } from "@invest254/shared";
import { InMemoryGameRepository, PgGameRepository, type GameRepository, type Querier } from "./wallet.js";
import { GameConfigStore, StaticConfigProvider, affectsPricing, configDiff, type ConfigProvider, type ListenClient } from "./gameconfig.js";
import { InMemoryEngagementRepository, PgEngagementRepository, maskHandle, type EngagementRepository, type ActivityRow, type ChatRow } from "./engagement.js";
import { GameServer } from "./game.js";
import { SeedManager } from "./daycontext.js";
import { RecoveryService } from "./recovery.js";
import { ActivityService } from "./activityservice.js";
import { ChatService } from "./chatservice.js";
import { PgUserOverridesRepository, type UserOverridesRepository } from "./overrides.js";
import { makeVerifier } from "./auth.js";

const PORT = Number(process.env.PORT ?? 8080);
const MASTER_SEED = process.env.MASTER_SEED ?? process.env.SERVER_SEED ?? "dev-master-seed-0001";
const ONLINE_FLOOR = Number(process.env.ONLINE_FLOOR ?? 0);           // display floor for the online counter
const BIG_WIN_CENTS = Number(process.env.BIG_WIN_CENTS ?? 500_000);   // wins >= this (KES 5,000) post a real feed event
const ACTIVITY_SIM = (process.env.ACTIVITY_SIM ?? "on") !== "off";    // simulated-feed generator toggle
const ACTIVITY_CADENCE_MS = Number(process.env.ACTIVITY_CADENCE_MS ?? 4000);
const CONFIG_POLL_MS = Number(process.env.CONFIG_POLL_MS ?? 15_000);   // LISTEN fallback cadence

// Persistence: Postgres in production (atomic RPCs), in-memory for local dev.
let repo: GameRepository;
let engage: EngagementRepository;
let config: ConfigProvider;
let configStore: GameConfigStore | undefined;
let overridesRepo: UserOverridesRepository | undefined;
const usingDb = Boolean(process.env.DATABASE_URL);
if (usingDb) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  repo = new PgGameRepository(pool);
  engage = new PgEngagementRepository(pool as unknown as Querier);
  overridesRepo = new PgUserOverridesRepository(pool as unknown as Querier);
  // Live configuration: LISTEN for instant pickup, poll as the self-healing fallback.
  // Until this existed the engine ran on hardcoded defaults and every admin save was inert.
  configStore = new GameConfigStore(pool as unknown as Querier, {
    pollMs: CONFIG_POLL_MS,
    connect: async () => (await pool.connect()) as unknown as ListenClient,
    onError: (err: Error, ctx: string) => console.error(`[engine] config ${ctx}:`, err.message),
  });
  await configStore.init();
  config = configStore;
  console.log(`[engine] game_config v${configStore.active().version} loaded from database`);
} else {
  repo = new InMemoryGameRepository();
  engage = new InMemoryEngagementRepository();
  config = new StaticConfigProvider();
  console.log("[engine] no DATABASE_URL — running on DEFAULT_CONFIG (v0)");
}
const cfg = () => config.active();

const verifier = makeVerifier();
if (usingDb && !verifier) throw new Error("AUTH: a JWT verifier is required when DATABASE_URL is set (set SUPABASE_JWT_SECRET or SUPABASE_JWKS_URL)");

const seeds = new SeedManager(MASTER_SEED, config, repo);
await seeds.init();
// J8: per-user admin overrides (win rate / max multiplier / auto-sell duration / stake bounds).
const loadOverride = overridesRepo ? (uid: string) => overridesRepo!.getForUser(uid) : undefined;
const game = new GameServer(() => seeds.getActive(), repo, cfg, undefined, loadOverride);

const recovery = new RecoveryService(repo, seeds, game, undefined, loadOverride);
const recovered = await recovery.recover();
console.log(`[engine] recovery: scanned=${recovered.scanned} settled=${recovered.settled} rearmed=${recovered.rearmed} noop=${recovered.noop} failed=${recovered.failed}`);

const all = new Set<WebSocket>();
const byUser = new Map<string, Set<WebSocket>>();
const userOf = new WeakMap<WebSocket, string>();
const handleOf = new WeakMap<WebSocket, string>();   // resolved display handle per socket
const handleCache = new Map<string, string>();       // userId -> handle

const send = (ws: WebSocket, type: string, data: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type, data, ts: Date.now() }));
const toUser = (userId: string, type: string, data: unknown) => byUser.get(userId)?.forEach((ws) => send(ws, type, data));
const broadcast = (type: string, data: unknown) => all.forEach((ws) => send(ws, type, data));
const onlineCount = () => Math.max(all.size, ONLINE_FLOOR);
const activityDto = (r: ActivityRow) => ({ kind: r.kind, username: r.username, amountCents: r.amountCents, message: r.message, ts: r.createdAtMs });
const chatDto = (r: ChatRow) => ({ id: r.id, username: r.username, message: r.message, ts: r.createdAtMs });

async function resolveHandle(userId: string): Promise<string> {
  let h = handleCache.get(userId);
  if (h) return h;
  h = (await engage.getUsername(userId)) ?? `guest_${userId.slice(0, 6)}`;
  handleCache.set(userId, h);
  return h;
}

// Activity feed: simulated generator (flagged) + real-event recorder; both broadcast `activity`.
const activity = new ActivityService(engage, (row) => broadcast("activity", activityDto(row)), { enabled: ACTIVITY_SIM, cadenceMs: ACTIVITY_CADENCE_MS, simSeed: `${MASTER_SEED}:activity` });
const chat = new ChatService(engage);

game.subscribe({
  onTick: (t) => broadcast("tick", t),
  onUpdate: (u) => { const p = game.getPosition(u.positionId); if (p) toUser(p.userId, "position_update", u); },
  onSettled: (e) => {
    toUser(e.position.userId, "position_settled", {
      positionId: e.position.id, result: e.position.outcome.result, lockedMultiplier: e.lockedMultiplier,
      payoutCents: e.payoutCents, pnlCents: e.pnlCents, balance: e.balance, mode: e.mode,
    });
    // Real social-proof: big wins post a (privacy-masked) feed event.
    if (e.position.outcome.result === "win" && e.payoutCents >= BIG_WIN_CENTS) {
      void resolveHandle(e.position.userId)
        .then((h) => activity.recordWin(maskHandle(h), e.payoutCents, e.lockedMultiplier))
        .catch((err) => console.error("[engine] activity.recordWin:", (err as Error).message));
    }
  },
  onError: (err, ctx) => console.error(`[engine] ${ctx}:`, err.message),
});
game.start();
activity.start();

/**
 * Apply an admin configuration change without disturbing money already at risk.
 *
 *  - Pricing knobs (RTP, win rate, multiplier cap, volatility, drift, duration) require a
 *    fresh curve + settlement calibration. `seeds.init()` re-points the ACTIVE context at
 *    the new version; positions already open keep the context they committed to, so the
 *    admin panel's "takes effect on the next round" promise is now literally true.
 *  - Tick rate is a timer period, so the interval is rescheduled in place.
 *  - Stake bounds need no action: they are read per request from the live config.
 */
configStore?.subscribe((next, prev) => {
  const changes = configDiff(prev, next);
  console.log(`[engine] game_config v${prev.version} -> v${next.version}: ${changes.join("; ") || "no field change"}`);
  if (game.applyTickRate()) console.log(`[engine] tick loop rescheduled to ${next.tickRateMs}ms`);
  // Push the new limits to every open socket so stake bounds and duration update without a
  // reload; clients that predate this message simply ignore it.
  broadcast("game_config", game.onlineConfigSnapshot());
  if (!affectsPricing(prev, next)) return;
  void seeds.init()
    .then((ctx) => console.log(`[engine] pricing context rebuilt for ${ctx.dateKey} @ config v${ctx.configVersion}`))
    .catch((err) => console.error("[engine] config context rebuild failed:", (err as Error).message));
});

// Rotate at the UTC day boundary: derive new day, commit its hash, reveal yesterday's seed.
setInterval(() => {
  void (async () => {
    try {
      const before = seeds.getActive().dateKey;
      const { active, revealed } = await seeds.rotate();
      if (active.dateKey !== before) {
        broadcast("fairness", { serverSeedHash: active.seedHash, tradeDate: active.dateKey });
        console.log(`[engine] rotated to ${active.dateKey}${revealed ? ` (revealed ${revealed})` : ""}`);
      }
    } catch (err) { console.error("[engine] rotation:", (err as Error).message); }
  })();
}, 60_000).unref();

const wss = new WebSocketServer({ host: "0.0.0.0", port: PORT });
wss.on("connection", (ws) => {
  all.add(ws);
  send(ws, "hello", { serverTime: Date.now(), serverSeedHash: seeds.getActive().seedHash, tradeDate: seeds.getActive().dateKey, gameConfig: game.onlineConfigSnapshot() });
  broadcast("online", { count: onlineCount() });
  // Backfill the feed + chat so the UI is populated immediately (oldest-first for append).
  void (async () => {
    try {
      const [recentActivity, recentChat] = await Promise.all([activity.recent(30), chat.recent()]);
      send(ws, "activity_batch", { items: recentActivity.map(activityDto).reverse() });
      send(ws, "chat_batch", { items: recentChat.map(chatDto).reverse() });
    } catch (err) { console.error("[engine] backfill:", (err as Error).message); }
  })();

  ws.on("message", async (raw) => {
    let msg: any; try { msg = JSON.parse(String(raw)); } catch { return send(ws, "error", { code: "BAD_JSON" }); }
    try {
      switch (msg.type) {
        case "auth": {
          let userId: string;
          if (verifier) {
            try { userId = (await verifier(String(msg.data?.token ?? ""))).userId; }
            catch { return send(ws, "error", { code: "AUTH_INVALID" }); }
          } else {
            userId = String(msg.data?.userId ?? "");
            if (!userId) return send(ws, "error", { code: "AUTH_REQUIRED" });
          }
          userOf.set(ws, userId);
          handleOf.set(ws, await resolveHandle(userId));
          (byUser.get(userId) ?? byUser.set(userId, new Set()).get(userId)!).add(ws);
          if (!usingDb && repo instanceof InMemoryGameRepository && (await repo.getBalance(userId)) === 0) repo.seed(userId, 100000);
          return send(ws, "balance", { real: await repo.getBalance(userId), currency: "KES" });
        }
        case "open_position": {
          const userId = userOf.get(ws); if (!userId) return send(ws, "error", { code: "AUTH_REQUIRED" });
          const { position: p, balance } = await game.openPosition({ userId, stakeCents: Number(msg.data.stakeCents), direction: msg.data.direction as Direction, durationS: msg.data.durationS });
          send(ws, "position_opened", { positionId: p.id, entryRate: p.outcome.entryRate, direction: p.direction, stakeCents: p.stakeCents, durationS: p.durationS, expiresAtMs: p.expiresAtMs });
          return send(ws, "balance", { real: balance, currency: "KES" });
        }
        case "sell": {
          const userId = userOf.get(ws); if (!userId) return send(ws, "error", { code: "AUTH_REQUIRED" });
          await game.sell(String(msg.data.positionId), userId); return;
        }
        case "subscribe_chat": {
          const recent = await chat.recent();
          return send(ws, "chat_batch", { items: recent.map(chatDto).reverse() });
        }
        case "send_chat": {
          const userId = userOf.get(ws); if (!userId) return send(ws, "error", { code: "AUTH_REQUIRED" });
          const handle = handleOf.get(ws) ?? (await resolveHandle(userId));
          const res = await chat.post(userId, handle, String(msg.data?.message ?? ""));
          if (!res.ok) return send(ws, "error", { code: res.code, reasons: res.reasons });
          return broadcast("chat", chatDto(res.row));
        }
        case "ping": return send(ws, "pong", {});
        default: return send(ws, "error", { code: "UNKNOWN_TYPE", message: msg.type });
      }
    } catch (err: any) { send(ws, "error", { code: "ENGINE_ERROR", message: String(err?.message ?? err) }); }
  });

  ws.on("close", () => { all.delete(ws); const u = userOf.get(ws); if (u) byUser.get(u)?.delete(ws); broadcast("online", { count: onlineCount() }); });
});

if (!verifier) console.warn("[engine] WARNING: no JWT verifier configured — DEV auth (trusts client userId). Do NOT use in production.");
console.log(`[engine] listening on ws://localhost:${PORT}  store=${usingDb ? "postgres" : "in-memory"}  auth=${verifier ? "jwt" : "dev"}  day=${seeds.getActive().dateKey}  sim=${ACTIVITY_SIM ? "on" : "off"}  onlineFloor=${ONLINE_FLOOR}  edge=${(cfg().houseEdge * 100).toFixed(0)}%  cfgV=${cfg().version ?? 0}  tick=${game.currentTickRateMs()}ms`);
