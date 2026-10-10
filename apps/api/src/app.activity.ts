import { Router, ApiError, type Ctx } from "./http.js";
import type { ApiDeps } from "./app.js";
import type { BrandActivityItem } from "./activity.pg.js";

const BASE = "/api/v1";
/** The feed is a glance, not a ledger: a screenful, and never enough to mine. */
const MAX = 40;
const DEFAULT = 25;

/**
 * `GET /site/activity?host=<host|slug>` (public) — what has actually been happening on this brand.
 *
 * The candlestick screen's Live Chat shows these between players' messages. Every row describes a
 * real event: a deposit that settled, a withdrawal that was paid, a trade that won. The page this
 * screen was copied from generates its equivalent (its own rows come back typed `system_simulated`,
 * naming withdrawals nobody made), and that is the one thing from the mock not reproduced — a feed
 * of invented winnings above a deposit button is a lie told to the person about to deposit.
 *
 * PUBLIC on purpose, like `/site/brand` beside it: the screen shows it before login, which is when
 * it matters most. That is also why the DTO is as thin as it is — a first name, an amount and a
 * coarse age, with no id, receipt or wall-clock time. See `activity.pg.ts` for the privacy rules the
 * query itself enforces.
 */
export function registerActivityRoutes(router: Router, deps: ApiDeps): void {
  router.get(`${BASE}/site/activity`, async (ctx: Ctx) => {
    if (!deps.brandActivity) return { items: [] as BrandActivityItem[] };

    const host = ctx.query.get("host")?.trim().toLowerCase();
    if (!host) throw new ApiError("VALIDATION", "host query parameter is required", 400);
    const brand = await deps.brandByHost(host);
    if (!brand) throw new ApiError("SITE_NOT_FOUND", `no active brand for host '${host}'`, 404);

    const raw = Number.parseInt(ctx.query.get("limit") ?? "", 10);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX) : DEFAULT;

    return { items: await deps.brandActivity.recent(brand.siteId, limit) };
  });
}
