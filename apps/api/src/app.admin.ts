import { Router, ApiError, requireAuth, requireRole, type Ctx } from "./http.js";
import type { PageQuery, AdminUserListQuery, AdminWithdrawalListQuery, AdminDepositListQuery, ReportRange, GameConfigPatch, MpesaConfigPatch, AdminPayoutListQuery, AdminUserActivityQuery } from "@invest254/engine";
import type { ApiDeps } from "./app.js";

/**
 * Admin back office routes (J2) — all admin-gated (the hierarchy admits superadmin too):
 *  - GET    /admin/overview                       dashboard KPIs
 *  - GET    /admin/users?role&status&q&cursor      user list (keyset)
 *  - GET    /admin/users/:id                        user detail
 *  - POST   /admin/users/:id/{suspend|ban|reactivate}   set status (audited; 0021 RPC)
 *  - PATCH  /admin/affiliates/:id/rate              set commission rate (audited; 0021 RPC)
 *  - POST   /admin/wallets/:id/adjust               manual credit/debit (J3; audited; 0022 RPC)
 *  - GET    /admin/withdrawals?status&cursor        withdrawal queue (read)
 *  - GET    /admin/deposits?status&cursor           deposits monitor (J3; STK statuses)
 *  - GET    /admin/deposits/reconcile?staleMinutes  deposits reconcile read (J3)
 *  - GET    /admin/reports/daily?from&to&format     per-day finance report; JSON or CSV (J4)
 *  - GET    /admin/reports/users?from&to&format     per-user finance report; JSON or CSV (J4)
 *  - GET    /admin/audit?cursor                     audit trail (read)
 * Thin transport over the engine AdminService — guards/audit live in the RPCs / in-memory mirror.
 */

const BASE = "/api/v1";

/** Admin domain-error code -> HTTP status. */
const ADMIN_STATUS: Readonly<Record<string, number>> = {
  NOT_AUTHORIZED: 403,
  INSUFFICIENT_PRIVILEGE: 403,
  SUPERADMIN_PROTECTED: 403,
  NO_SELF_ACTION: 409,
  INVALID_STATUS: 400,
  INVALID_RATE: 400,
  INVALID_ROLE: 400,
  INVALID_AMOUNT: 400,
  REASON_REQUIRED: 400,
  INSUFFICIENT_FUNDS: 409,
  USER_NOT_FOUND: 404,
  WALLET_NOT_FOUND: 404,
  NOT_AFFILIATE: 404,
  NOT_FOUND: 404,
  // J5 — game config + seed rotation
  INVALID_CONFIG: 400,
  INVALID_DATE: 400,
  PAST_DATE: 409,
  SEED_REVEALED: 409,
  // J6 — affiliate payout decisions
  PAYOUT_NOT_FOUND: 404,
  B2C_UNAVAILABLE: 503,
};

/** Integer game_config fields (cents/durations) — must be whole numbers; the rest may be fractional. */
const CONFIG_INT_FIELDS = new Set(["minStakeCents", "maxStakeCents", "defaultDurationS", "tickRateMs"]);
const CONFIG_FIELDS = ["houseEdge", "maxMultiplier", "minStakeCents", "maxStakeCents", "defaultDurationS", "tickRateMs", "driftBias", "volatility", "targetWinRate"] as const;

/** suspend/ban/reactivate -> the account status the RPC applies. */
const STATUS_ACTION: Readonly<Record<string, string>> = { suspend: "suspended", ban: "banned", reactivate: "active" };

/** Run an AdminService call, translating thrown domain error codes into controlled ApiErrors. */
async function domain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const code = message.split(":")[0]!.trim();
    const status = ADMIN_STATUS[code];
    if (status) throw new ApiError(code, message, status);
    throw err;
  }
}

/** Parse cursor pagination params (limit clamped by the repository). */
function pageQuery(ctx: Ctx): PageQuery {
  const limitRaw = ctx.query.get("limit");
  return { limit: limitRaw === null ? undefined : Number(limitRaw), cursor: ctx.query.get("cursor") };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse optional inclusive `from`/`to` (YYYY-MM-DD) report bounds (J4). */
function reportRange(ctx: Ctx): ReportRange {
  const parse = (name: string): string | undefined => {
    const v = ctx.query.get(name);
    if (v === null) return undefined;
    if (!DATE_RE.test(v)) throw new ApiError("INVALID_DATE", `${name} must be YYYY-MM-DD`, 400);
    return v;
  };
  const from = parse("from");
  const to = parse("to");
  if (from !== undefined && to !== undefined && from > to) throw new ApiError("INVALID_RANGE", "from must be <= to", 400);
  return { from, to };
}

/** Escape one CSV cell per RFC 4180 (quote when it holds a comma, quote, CR or LF). */
function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Stream a CSV file response directly (the JSON layer no-ops once headers are sent). */
function sendCsv(ctx: Ctx, filename: string, header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): void {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  ctx.res.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
  });
  ctx.res.end(lines.join("\r\n") + "\r\n");
}

/** True when `?format=csv` is requested. */
const wantsCsv = (ctx: Ctx): boolean => (ctx.query.get("format") ?? "").toLowerCase() === "csv";

/** Parse a `?limit=` query param for plain (non-cursor) lists, clamped to [1, max]. */
function listLimit(ctx: Ctx, def: number, max = 100): number {
  const raw = ctx.query.get("limit");
  if (raw === null) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new ApiError("INVALID_LIMIT", "limit must be a positive integer", 400);
  return Math.min(Math.floor(n), max);
}

/** Parse a partial game_config patch (J5): numeric fields only, at least one, integers where required. */
function parseGameConfigPatch(ctx: Ctx): GameConfigPatch {
  const body = ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
  const patch: Record<string, number> = {};
  for (const key of CONFIG_FIELDS) {
    const raw = body[key];
    if (raw === undefined || raw === null) continue;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) throw new ApiError("VALIDATION", `${key} must be a finite number`, 400);
    if (CONFIG_INT_FIELDS.has(key) && !Number.isInteger(n)) throw new ApiError("VALIDATION", `${key} must be an integer (cents/seconds/ms)`, 400);
    patch[key] = n;
  }
  if (Object.keys(patch).length === 0) throw new ApiError("VALIDATION", "provide at least one config field to update", 400);
  return patch as GameConfigPatch;
}

/** Plain (non-secret) and secret M-Pesa config fields the PATCH accepts. */
const MPESA_PLAIN_FIELDS = ["shortcode", "stkCallbackUrl", "b2cInitiator", "b2cResultUrl", "b2cTimeoutUrl"] as const;
const MPESA_SECRET_FIELDS = ["consumerKey", "consumerSecret", "passkey", "securityCredential"] as const;

/** Validate + assemble an M-Pesa config patch. Strings are trimmed; empty secret strings are
 *  dropped (write-only semantics: only a non-empty value rotates a secret). */
function parseMpesaConfigPatch(ctx: Ctx): MpesaConfigPatch {
  const body = ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
  const patch: Record<string, string> = {};
  if (body.environment !== undefined && body.environment !== null) {
    const env = String(body.environment);
    if (env !== "sandbox" && env !== "production") throw new ApiError("VALIDATION", "environment must be 'sandbox' or 'production'", 400);
    patch.environment = env;
  }
  for (const key of MPESA_PLAIN_FIELDS) {
    const raw = body[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") throw new ApiError("VALIDATION", `${key} must be a string`, 400);
    patch[key] = raw.trim();
  }
  for (const key of MPESA_SECRET_FIELDS) {
    const raw = body[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") throw new ApiError("VALIDATION", `${key} must be a string`, 400);
    const v = raw.trim();
    if (v !== "") patch[key] = v; // empty → keep existing secret
  }
  if (Object.keys(patch).length === 0) throw new ApiError("VALIDATION", "provide at least one M-Pesa field to update", 400);
  return patch as MpesaConfigPatch;
}

/** Require a non-empty `id`/`tradeDate` `YYYY-MM-DD` body field (J5 seed rotation). */
function bodyTradeDate(ctx: Ctx): string {
  const body = ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
  const v = body.tradeDate ?? body.date;
  if (typeof v !== "string" || !DATE_RE.test(v)) throw new ApiError("INVALID_DATE", "tradeDate must be YYYY-MM-DD", 400);
  return v;
}

/** Parse a positive-integer path param (chat message id). */
function intParam(ctx: Ctx, name: string): number {
  const n = Number(ctx.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError("INVALID_ID", `${name} must be a positive integer`, 400);
  return n;
}

export function registerAdminRoutes(router: Router, deps: ApiDeps): void {
  const auth = requireAuth(deps.verifier);
  const admin = requireRole("admin");
  const superadmin = requireRole("superadmin");

  router.get(`${BASE}/admin/overview`, auth, admin, async () => deps.admin.overview());

  router.get(`${BASE}/admin/users`, auth, admin, async (ctx: Ctx) => {
    const q: AdminUserListQuery = {
      ...pageQuery(ctx),
      role: ctx.query.get("role") ?? undefined,
      status: ctx.query.get("status") ?? undefined,
      q: ctx.query.get("q") ?? undefined,
    };
    return deps.admin.listUsers(q);
  });

  router.get(`${BASE}/admin/users/:id`, auth, admin, async (ctx: Ctx) =>
    domain(() => deps.admin.getUserDetail(ctx.params.id!)));

  // Per-user activity timeline (J7) — deposits + withdrawals + bets, newest-first, keyset-paginated.
  router.get(`${BASE}/admin/users/:id/activity`, auth, admin, async (ctx: Ctx) => {
    const kindRaw = ctx.query.get("kind");
    if (kindRaw !== null && kindRaw !== "deposit" && kindRaw !== "withdrawal" && kindRaw !== "bet") {
      throw new ApiError("INVALID_KIND", "kind must be 'deposit', 'withdrawal', or 'bet'", 400);
    }
    const q: AdminUserActivityQuery = { ...pageQuery(ctx), kind: kindRaw ?? undefined };
    const page = await deps.admin.listUserActivity(ctx.params.id!, q);
    return { items: page.items, nextCursor: page.nextCursor };
  });

  for (const action of Object.keys(STATUS_ACTION)) {
    router.post(`${BASE}/admin/users/:id/${action}`, auth, admin, async (ctx: Ctx) => {
      const body = ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
      const reason = typeof body.reason === "string" ? body.reason : null;
      const targetId = ctx.params.id!;
      const result = await domain(() => deps.admin.setUserStatus(ctx.claims!.userId, ctx.claims!.role ?? "player", targetId, STATUS_ACTION[action]!, reason));
      // Blocking, non-dismissible banner while the account is limited; auto-resolve on reactivate.
      // Best-effort so a notification hiccup never fails the status change (the money-safe op).
      try {
        if (action === "suspend" || action === "ban") {
          await deps.notifications.resolveByCategory(targetId, "account_limited");
          await deps.notifications.create({
            userId: targetId, level: "error", dismissible: false, category: "account_limited",
            title: action === "ban" ? "Your account has been banned" : "Your account is suspended",
            body: reason && reason.trim() !== ""
              ? `Reason: ${reason.trim()}. Contact support if you believe this is a mistake.`
              : "Some actions are unavailable. Contact support if you believe this is a mistake.",
            createdBy: ctx.claims!.userId,
          });
        } else if (action === "reactivate") {
          await deps.notifications.resolveByCategory(targetId, "account_limited");
          await deps.notifications.create({
            userId: targetId, level: "success", dismissible: true, category: "account_reactivated",
            title: "Your account has been reactivated", body: "Welcome back — full access is restored.",
            createdBy: ctx.claims!.userId,
          });
        }
      } catch { /* non-fatal: status change already succeeded */ }
      return result;
    });
  }

  // Role management — superadmin only (promote/demote). Effective on the target's next login.
  router.post(`${BASE}/admin/users/:id/role`, auth, superadmin, async (ctx: Ctx) => {
    const body = ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
    const role = typeof body.role === "string" ? body.role : "";
    if (!["player", "marketer", "admin", "superadmin"].includes(role)) {
      throw new ApiError("VALIDATION", "role must be player|marketer|admin|superadmin", 400);
    }
    return domain(() => deps.admin.setUserRole(ctx.claims!.userId, ctx.claims!.role ?? "player", ctx.params.id!, role));
  });

  router.patch(`${BASE}/admin/affiliates/:id/rate`, auth, admin, async (ctx: Ctx) => {
    const body = ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
    const rate = typeof body.rate === "number" ? body.rate : Number(body.rate);
    if (!Number.isFinite(rate)) throw new ApiError("VALIDATION", "rate (0..1) is required", 400);
    return domain(() => deps.admin.setCommissionRate(ctx.claims!.userId, ctx.claims!.role ?? "player", ctx.params.id!, rate));
  });

  router.post(`${BASE}/admin/wallets/:id/adjust`, auth, admin, async (ctx: Ctx) => {
    const body = ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (reason.trim() === "") throw new ApiError("REASON_REQUIRED", "reason is required", 400);
    const raw = body.amountCents ?? body.amount;
    const magnitude = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(magnitude) || magnitude === 0) throw new ApiError("INVALID_AMOUNT", "amountCents must be a non-zero integer (cents)", 400);
    // Optional explicit direction makes the sign unambiguous; otherwise a signed amount is taken as-is.
    const dir = body.direction;
    const signed = dir === "credit" || dir === "debit" ? Math.abs(magnitude) * (dir === "debit" ? -1 : 1) : magnitude;
    return domain(() => deps.admin.adjustBalance(ctx.claims!.userId, ctx.claims!.role ?? "player", ctx.params.id!, signed, reason));
  });

  router.get(`${BASE}/admin/withdrawals`, auth, admin, async (ctx: Ctx) => {
    const q: AdminWithdrawalListQuery = { ...pageQuery(ctx), status: ctx.query.get("status") ?? undefined };
    return deps.admin.listWithdrawals(q);
  });

  router.get(`${BASE}/admin/deposits/reconcile`, auth, admin, async (ctx: Ctx) => {
    const raw = ctx.query.get("staleMinutes");
    const n = raw === null ? 15 : Number(raw);
    return deps.admin.depositsReconcile(Number.isFinite(n) && n >= 0 ? n : 15);
  });

  router.get(`${BASE}/admin/deposits`, auth, admin, async (ctx: Ctx) => {
    const q: AdminDepositListQuery = { ...pageQuery(ctx), status: ctx.query.get("status") ?? undefined };
    return deps.admin.listDeposits(q);
  });

  router.get(`${BASE}/admin/reports/daily`, auth, admin, async (ctx: Ctx) => {
    const rows = await deps.admin.reportDaily(reportRange(ctx));
    if (wantsCsv(ctx)) {
      return sendCsv(ctx, "report-daily.csv",
        ["date", "deposits_cents", "withdrawals_cents", "turnover_cents", "ggr_cents"],
        rows.map((r) => [r.date, r.depositsCents, r.withdrawalsCents, r.turnoverCents, r.ggrCents]));
    }
    return { items: rows };
  });

  router.get(`${BASE}/admin/reports/users`, auth, admin, async (ctx: Ctx) => {
    const rows = await deps.admin.reportByUser(reportRange(ctx));
    if (wantsCsv(ctx)) {
      return sendCsv(ctx, "report-users.csv",
        ["user_id", "username", "deposits_cents", "withdrawals_cents", "turnover_cents", "ggr_cents"],
        rows.map((r) => [r.userId, r.username, r.depositsCents, r.withdrawalsCents, r.turnoverCents, r.ggrCents]));
    }
    return { items: rows };
  });

  router.get(`${BASE}/admin/audit`, auth, admin, async (ctx: Ctx) => deps.admin.listAudit(pageQuery(ctx)));

  // ── J5: game configuration + RTP monitor + seed rotation (superadmin mutations) ───────────────

  router.get(`${BASE}/admin/game-config`, auth, admin, async () => deps.admin.getGameConfig());

  router.patch(`${BASE}/admin/game-config`, auth, superadmin, async (ctx: Ctx) => {
    const patch = parseGameConfigPatch(ctx);
    return domain(() => deps.admin.updateGameConfig(ctx.claims!.userId, ctx.claims!.role ?? "player", patch));
  });

  router.get(`${BASE}/admin/rtp`, auth, admin, async () => deps.admin.rtpMonitor());

  // ── M-Pesa configuration (admin reads masked; superadmin edits; secrets write-only) ──────────
  router.get(`${BASE}/admin/mpesa-config`, auth, admin, async () => domain(() => deps.admin.getMpesaConfig()));

  router.patch(`${BASE}/admin/mpesa-config`, auth, superadmin, async (ctx: Ctx) => {
    const patch = parseMpesaConfigPatch(ctx);
    return domain(() => deps.admin.updateMpesaConfig(ctx.claims!.userId, ctx.claims!.role ?? "player", patch));
  });

  router.get(`${BASE}/admin/seeds`, auth, admin, async (ctx: Ctx) => ({ items: await deps.admin.listSeeds(listLimit(ctx, 30)) }));

  router.post(`${BASE}/admin/seeds/rotate`, auth, superadmin, async (ctx: Ctx) =>
    domain(() => deps.admin.rotateSeed(ctx.claims!.userId, ctx.claims!.role ?? "player", bodyTradeDate(ctx))));

  // ── J6: affiliate payout approve/reject QUEUE ────────────────────────────────────────────────
  // The approve/reject *actions* already ship in app.affiliate.ts (I4) at
  // /admin/affiliate/payouts/:id/{approve,reject} (now audited). J6 adds the queue the UI lists from.
  router.get(`${BASE}/admin/affiliate/payouts`, auth, admin, async (ctx: Ctx) => {
    const q: AdminPayoutListQuery = { ...pageQuery(ctx), status: ctx.query.get("status") ?? undefined };
    return deps.admin.listAffiliatePayouts(q);
  });

  // ── J6: chat moderation ──────────────────────────────────────────────────────────────────────

  router.get(`${BASE}/admin/chat`, auth, admin, async (ctx: Ctx) => {
    const includeHidden = (ctx.query.get("includeHidden") ?? "").toLowerCase() === "true";
    return { items: await deps.admin.listChat(listLimit(ctx, 50), includeHidden) };
  });

  router.post(`${BASE}/admin/chat/:id/hide`, auth, admin, async (ctx: Ctx) => {
    const id = intParam(ctx, "id");
    const hidden = await deps.admin.hideChat(ctx.claims!.userId, ctx.claims!.role ?? "player", id);
    if (!hidden) throw new ApiError("NOT_FOUND", `no visible chat message ${id}`, 404);
    return { id, hidden: true };
  });

  router.post(`${BASE}/admin/chat/:id/unhide`, auth, admin, async (ctx: Ctx) => {
    const id = intParam(ctx, "id");
    const restored = await deps.admin.unhideChat(ctx.claims!.userId, ctx.claims!.role ?? "player", id);
    if (!restored) throw new ApiError("NOT_FOUND", `no hidden chat message ${id}`, 404);
    return { id, hidden: false };
  });
}
