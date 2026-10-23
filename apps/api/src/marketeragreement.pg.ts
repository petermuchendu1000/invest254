/**
 * The terms a platform admin agrees with ONE marketer (migration 0214): a session target, and what
 * that marketer's /dashboard shows.
 *
 * REPORTING ONLY, like the live sessions it counts. Completing a target credits nothing, reserves
 * nothing and touches no money table — `completed` is a COUNT asked of sessions the marketer already
 * ran, and `amountCents` is the figure the admin agreed to pay through the payout/advance path that
 * already exists. Nothing in this file can move a balance.
 *
 * The visibility switches are PRESENTATION. The endpoints they hide stay open and the data is the
 * marketer's own; a hidden block means "we do not put this in front of you", never "you cannot reach
 * this". Anything that must be unreachable belongs behind a server-side gate instead.
 */
export interface AgreementQuerier { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; }

export interface SessionTarget {
  id: string;
  targetSessions: number;
  /** What completing the target is worth, in KES cents. Display only. */
  amountCents: number;
  /** A session shorter than this does not count toward the target. */
  qualifyMinutes: number;
  startedAt: string;
  closedAt: string | null;
  /** Qualifying sessions STARTED since this target opened. */
  completed: number;
  /** completed >= targetSessions. The admin still pays by hand; this only says the count is met. */
  done: boolean;
}

/** Which blocks of /dashboard this marketer sees. Every one defaults true. */
export interface DashboardPrefs {
  showEarnings: boolean;
  showLive: boolean;
  showAudience: boolean;
  showAdvance: boolean;
  showActivity: boolean;
}

/** One marketer-role profile on a brand, with the terms currently in force. */
export interface AdminMarketerRow {
  marketerId: string;
  username: string | null;
  phone: string | null;
  status: string | null;
  target: SessionTarget | null;
  prefs: DashboardPrefs;
}

export interface MarketerAgreementStore {
  /** The marketer's own view: their open target (if any) and what they may see. */
  forMarketer(siteId: string, marketerId: string): Promise<{ target: SessionTarget | null; prefs: DashboardPrefs }>;
  listMarketers(siteId: string): Promise<AdminMarketerRow[]>;
  startTarget(siteId: string, marketerId: string, input: { targetSessions: number; amountCents: number; qualifyMinutes: number }, by: string): Promise<SessionTarget>;
  closeTarget(siteId: string, marketerId: string): Promise<SessionTarget | null>;
  savePrefs(siteId: string, marketerId: string, patch: Partial<DashboardPrefs>, by: string): Promise<DashboardPrefs>;
}

/** No row means every block is visible — a marketer nobody has configured sees what they always saw. */
export const PREFS_DEFAULT: DashboardPrefs = {
  showEarnings: true, showLive: true, showAudience: true, showAdvance: true, showActivity: true,
};

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const int = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

function mapPrefs(x: Record<string, unknown> | undefined): DashboardPrefs {
  if (!x) return { ...PREFS_DEFAULT };
  // `!== false` rather than `=== true`: a column that arrives null (an outer join with no prefs row)
  // must read as the default ON, not as hidden. Hiding a marketer's money because a join missed is
  // the worse failure of the two.
  return {
    showEarnings: x.show_earnings !== false,
    showLive: x.show_live !== false,
    showAudience: x.show_audience !== false,
    showAdvance: x.show_advance !== false,
    showActivity: x.show_activity !== false,
  };
}

function mapTarget(x: Record<string, unknown> | undefined): SessionTarget | null {
  if (!x || x.id == null) return null;
  const targetSessions = int(x.target_sessions);
  const completed = Math.max(0, int(x.completed));
  return {
    id: String(x.id),
    targetSessions,
    amountCents: Math.max(0, int(x.amount_cents)),
    qualifyMinutes: int(x.qualify_minutes, 30),
    startedAt: iso(x.started_at),
    closedAt: x.closed_at ? iso(x.closed_at) : null,
    completed,
    done: targetSessions > 0 && completed >= targetSessions,
  };
}

/**
 * Sessions that count toward a target.
 *
 * `s.started_at >= t.started_at` — STARTED under this target, not merely ended under it. That gives
 * every session exactly one owner: the target open when it began, or none. Keying on `ended_at`
 * instead would hand a session that spans a boundary to the new target, crediting the incoming
 * agreement with work done under the outgoing one.
 *
 * `ended_at is not null` excludes the session running right now: a target counts work finished, and
 * a session that is still open has not been. It is REDUNDANT and kept deliberately — mutation
 * testing showed removing it kills no test, because an open session's `ended_at - started_at` is
 * NULL and `where ... and NULL` already drops the row. It stays because it is the rule in words:
 * the next person to touch the duration expression should not have to rediscover that the null
 * arithmetic was the only thing excluding a live session.
 *
 * The duration floor is the one stored ON THE TARGET, so changing the rule later cannot restate a
 * target already in progress.
 */
const COMPLETED = `
  (select count(*) from public.marketer_live_sessions s
    where s.site_id = t.site_id and s.marketer_id = t.marketer_id
      and s.ended_at is not null
      and s.started_at >= t.started_at
      and s.ended_at - s.started_at >= make_interval(mins => t.qualify_minutes))::int`;

const OPEN_TARGET = `
  select t.*, ${COMPLETED} as completed
    from public.marketer_session_targets t
   where t.site_id = $1 and t.marketer_id = $2 and t.closed_at is null`;

export function makePgMarketerAgreement(q: AgreementQuerier): MarketerAgreementStore {
  async function openTarget(siteId: string, marketerId: string): Promise<SessionTarget | null> {
    const r = await q.query(OPEN_TARGET, [siteId, marketerId]);
    return mapTarget(r.rows[0]);
  }

  async function prefsOf(siteId: string, marketerId: string): Promise<DashboardPrefs> {
    const r = await q.query(
      `select show_earnings, show_live, show_audience, show_advance, show_activity
         from public.marketer_dashboard_prefs where site_id = $1 and marketer_id = $2`,
      [siteId, marketerId],
    );
    return mapPrefs(r.rows[0]);
  }

  return {
    async forMarketer(siteId, marketerId) {
      const [target, prefs] = await Promise.all([openTarget(siteId, marketerId), prefsOf(siteId, marketerId)]);
      return { target, prefs };
    },

    async listMarketers(siteId) {
      /**
       * Every marketer-role profile on the brand, with the terms in force. This is the first admin
       * listing of these accounts: `MarketersPanel` lists `public.marketers`, which is a DIFFERENT
       * identity space sharing no ids with profiles, so it has never shown these people at all.
       */
      const r = await q.query(
        `select p.id::text as marketer_id, p.username, p.phone, p.status,
                t.id, t.target_sessions, t.amount_cents, t.qualify_minutes, t.started_at, t.closed_at,
                -- The SAME expression the marketer's own view uses, not a copy of it: an admin who
                -- reads 4/5 here and a marketer who reads 3/5 there is the argument this feature
                -- exists to avoid, and two hand-written copies of one rule is how that happens.
                -- With no target the outer join nulls t, the subquery counts nothing, and mapTarget
                -- discards the row on a null id before that zero is ever shown.
                ${COMPLETED} as completed,
                d.show_earnings, d.show_live, d.show_audience, d.show_advance, d.show_activity
           from public.profiles p
           left join public.marketer_session_targets t
             on t.site_id = p.site_id and t.marketer_id = p.id and t.closed_at is null
           left join public.marketer_dashboard_prefs d
             on d.site_id = p.site_id and d.marketer_id = p.id
          where p.site_id = $1 and p.role = 'marketer'
          order by lower(coalesce(p.username, '')), p.id`,
        [siteId],
      );
      return r.rows.map((x) => ({
        marketerId: String(x.marketer_id),
        username: (x.username as string | null) ?? null,
        phone: (x.phone as string | null) ?? null,
        status: (x.status as string | null) ?? null,
        target: mapTarget(x),
        prefs: mapPrefs(x),
      }));
    },

    async startTarget(siteId, marketerId, input, by) {
      /**
       * Starting a target IS the reset. The previous one is closed first, in the same statement
       * order every time, so `uq_session_target_open` can never see two open rows — and a target
       * that was already met keeps its own `started_at`, so closing it does not restate what it
       * counted.
       */
      await q.query(
        `update public.marketer_session_targets set closed_at = now()
          where site_id = $1 and marketer_id = $2 and closed_at is null`,
        [siteId, marketerId],
      );
      await q.query(
        `insert into public.marketer_session_targets
           (site_id, marketer_id, target_sessions, amount_cents, qualify_minutes, created_by)
         values ($1, $2, $3, $4, $5, $6)`,
        [siteId, marketerId, input.targetSessions, input.amountCents, input.qualifyMinutes, by],
      );
      const created = await openTarget(siteId, marketerId);
      if (!created) throw new Error("TARGET_START_FAILED");
      return created;
    },

    async closeTarget(siteId, marketerId) {
      const current = await openTarget(siteId, marketerId);
      if (!current) return null;
      await q.query(
        `update public.marketer_session_targets set closed_at = now()
          where site_id = $1 and marketer_id = $2 and closed_at is null`,
        [siteId, marketerId],
      );
      return { ...current, closedAt: new Date().toISOString() };
    },

    async savePrefs(siteId, marketerId, patch, by) {
      const next = { ...(await prefsOf(siteId, marketerId)), ...patch };
      await q.query(
        `insert into public.marketer_dashboard_prefs
           (site_id, marketer_id, show_earnings, show_live, show_audience, show_advance, show_activity, updated_at, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7, now(), $8)
         on conflict (site_id, marketer_id) do update set
           show_earnings = excluded.show_earnings, show_live = excluded.show_live,
           show_audience = excluded.show_audience, show_advance = excluded.show_advance,
           show_activity = excluded.show_activity, updated_at = now(), updated_by = excluded.updated_by`,
        [siteId, marketerId, next.showEarnings, next.showLive, next.showAudience, next.showAdvance, next.showActivity, by],
      );
      return next;
    },
  };
}
