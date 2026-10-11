/**
 * The brand's recent REAL activity: deposits that settled, withdrawals that were paid, and trades
 * that won. This is what the candlestick screen's Live Chat shows between players' messages.
 *
 * Every row the QUERIES here read out of `transactions` and `positions` describes something that
 * actually happened to a real account on this brand, and that stays true: those arms were never
 * going to grow a generated row. The screen it feeds was copied from a page whose equivalent feed
 * is wholly generated — its own rows come back typed `system_simulated`, naming withdrawals nobody
 * made.
 *
 * SEEDED ROWS. On top of the real events the feed now also carries rows from `activity_seed` (0193),
 * which the product owner seeds so a newly-launched brand's feed is not empty. They are kept in
 * their own table, outside every money table, so the ledger stays exactly as correct as it was and
 * the seeds can be deleted wholesale at any time. Nothing downstream of them moves a balance; what
 * they do move is what a person about to deposit believes about this brand, which is the reason the
 * boundary is drawn in the schema rather than in a flag on a real row.
 *
 * PRIVACY. A public feed naming real people and real money has to give up as little as it can:
 *  - the name is the account's own username, truncated, never a phone number, an id or an email;
 *  - an account with no username is shown as "A trader" rather than being identified another way;
 *  - only the amount and a coarse age go out — no transaction id, no receipt, no exact timestamp;
 *  - demo and practice activity is excluded, because it did not happen with money;
 *  - the query is site-scoped, so one brand's feed can never carry another brand's players.
 */
export interface ActivityQuerier { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; }

/** One thing that happened, as the feed states it. */
export interface BrandActivityItem {
  kind: 'deposit' | 'withdrawal' | 'win';
  /** The trader's display name, already truncated. Never an id, a phone or an email. */
  name: string;
  amountCents: number;
  /** Whole seconds ago, so the client can say "2m ago" without being handed a wall-clock time. */
  agoSeconds: number;
  /**
   * True for a row that came from `activity_seed` (0193) rather than from a settled transaction or
   * position.
   *
   * Carried so the distinction survives in the API payload itself: an operator, an auditor, or
   * whoever next reads this endpoint can tell seeded social proof from a real event without
   * joining anything. The client does not have to use it, and today does not — but the server
   * should never be the thing that makes the two indistinguishable.
   */
  seeded?: boolean;
}

/** One trader on the board, as the Top tab lists them. */
export interface LeaderboardRow {
  rank: number;
  name: string;
  trades: number;
  profitCents: number;
}

/** The windows the mock's four chips select. */
export type LeaderboardPeriod = 'today' | 'yesterday' | 'week' | 'month';

export interface BrandActivityStore {
  recent(siteId: string, limit: number): Promise<BrandActivityItem[]>;
  leaderboard(siteId: string, period: LeaderboardPeriod, limit: number): Promise<LeaderboardRow[]>;
}

/** Each chip's window, as SQL the query can drop in. Closed at both ends so a day means that day. */
const WINDOW: Record<LeaderboardPeriod, string> = {
  today: "o.settled_at >= date_trunc('day', now())",
  yesterday: "o.settled_at >= date_trunc('day', now()) - interval '1 day' and o.settled_at < date_trunc('day', now())",
  week: "o.settled_at >= date_trunc('week', now())",
  month: "o.settled_at >= date_trunc('month', now())",
};

/**
 * Shorten a username for public display: the first word, capped, with nothing revealing kept.
 *
 * Usernames on this product are chosen by the player and are already public to support staff, but a
 * feed on the trade screen is a different audience, so this keeps the first token only — "wanjiku"
 * from "wanjiku_254" — which is the shape the mock uses and the least that still reads as a person.
 */
export function publicName(username: string | null | undefined): string {
  const first = String(username ?? '').trim().split(/[\s_.\-@]+/)[0] ?? '';
  const cleaned = first.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 12);
  if (cleaned.length < 2) return 'A trader';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

export function makePgBrandActivity(q: ActivityQuerier): BrandActivityStore {
  return {
    async recent(siteId, limit) {
      /**
       * Deposits and withdrawals that COMPLETED, and positions that WON, newest first.
       *
       * One statement rather than three round trips, and `limit` is applied inside each arm as well
       * as outside so a brand with a million settled deposits still reads an index-sized slice.
       *
       * EACH ARM IS PARENTHESISED, and must stay that way: in Postgres an ORDER BY or LIMIT written
       * directly on a UNION arm belongs to the whole UNION, so without the brackets this is a
       * syntax error (42601) and the route 500s. Neither tsc nor a unit test can see that — nothing
       * but a real database parses this string — which is how it reached production once already.
       * Demo and practice rows are excluded in the positions arm; transactions carry no demo flag
       * because a demo wallet never reaches a payment provider.
       */
      const r = await q.query(
        `select kind, username, amount_cents, ago_seconds from (
           (select 'deposit' as kind, p.username,
                   t.amount as amount_cents,
                   extract(epoch from (now() - t.created_at)) as ago_seconds,
                   t.created_at as at
              from transactions t join profiles p on p.id = t.user_id
             where t.site_id = $1 and t.kind = 'deposit' and t.status = 'success'
             order by t.created_at desc limit $2)
           union all
           (select 'withdrawal', p.username, t.amount,
                   extract(epoch from (now() - t.created_at)),
                   t.created_at
              from transactions t join profiles p on p.id = t.user_id
             where t.site_id = $1 and t.kind = 'withdrawal' and t.status = 'success'
             order by t.created_at desc limit $2)
           union all
           (select 'win', p.username, o.payout,
                   extract(epoch from (now() - o.settled_at)),
                   o.settled_at
              from positions o join profiles p on p.id = o.user_id
             where o.site_id = $1 and o.result = 'win' and o.status = 'settled'
               and o.settled_at is not null and o.payout > 0
               and coalesce(o.demo, false) = false and coalesce(o.practice, false) = false
             order by o.settled_at desc limit $2)
         ) rows
         order by at desc limit $2`,
        [siteId, limit],
      );
      const real: BrandActivityItem[] = r.rows.map((x) => ({
        kind: x.kind === 'withdrawal' ? 'withdrawal' : x.kind === 'win' ? 'win' : 'deposit',
        name: publicName(x.username as string | null),
        amountCents: Math.max(0, Math.round(Number(x.amount_cents ?? 0))),
        agoSeconds: Math.max(0, Math.round(Number(x.ago_seconds ?? 0))),
      }));

      /**
       * The SEEDED rows (0193), merged in so a brand nobody has deposited on yet still has a feed.
       *
       * A SECOND statement rather than a fourth UNION arm, because the arm above is the one piece of
       * SQL in this file that has already broken production once and the comment on it says why: its
       * brackets are load-bearing and nothing but a real database parses them. Editing that string
       * to bolt marketing copy onto it risks the route for the sake of saving a round trip against a
       * tiny, single-index table. The merge is then done here, where it is plain to read.
       *
       * `name` is taken as stored and NOT passed through publicName: that function exists to shrink
       * a real player's username to the least that still reads as a person, and there is no player
       * behind a seed row to protect — running it would only mangle the display name on purpose.
       */
      const s = await q.query(
        `select kind, name, amount_cents,
                extract(epoch from (now() - created_at)) as ago_seconds
           from public.activity_seed
          where site_id = $1
          order by created_at desc
          limit $2`,
        [siteId, limit],
      );
      const seeded: BrandActivityItem[] = s.rows.map((x) => ({
        kind: x.kind === 'withdrawal' ? 'withdrawal' : x.kind === 'win' ? 'win' : 'deposit',
        name: String(x.name ?? '').trim() || 'A trader',
        amountCents: Math.max(0, Math.round(Number(x.amount_cents ?? 0))),
        agoSeconds: Math.max(0, Math.round(Number(x.ago_seconds ?? 0))),
        seeded: true,
      }));

      // Newest first across both sources, then cut to `limit` — the age is the sort key the DTO
      // already carries, so the merged order is exactly the order the client renders.
      return [...real, ...seeded].sort((a, b) => a.agoSeconds - b.agoSeconds).slice(0, limit);
    },

    async leaderboard(siteId, period, limit) {
      /**
       * Ranked by NET profit over the window, which is the only ranking that is not misleading.
       *
       * Ranking by winnings alone would put whoever staked most at the top regardless of whether
       * they are up or down, and a board that calls a losing player a top trader is worse than no
       * board. `pnl` is what settlement already wrote per position, so this sums rows rather than
       * recomputing anything — there is no second opinion about money here.
       *
       * Demo and practice are excluded for the same reason they are excluded from the feed.
       */
      const r = await q.query(
        `select p.username, count(*)::int as trades, sum(o.pnl)::bigint as profit_cents
           from positions o join profiles p on p.id = o.user_id
          where o.site_id = $1 and o.status = 'settled' and o.settled_at is not null
            and coalesce(o.demo, false) = false and coalesce(o.practice, false) = false
            and ${WINDOW[period] ?? WINDOW.today}
          group by p.username
         having sum(o.pnl) > 0
          order by sum(o.pnl) desc
          limit $2`,
        [siteId, limit],
      );
      return r.rows.map((x, i) => ({
        rank: i + 1,
        name: publicName(x.username as string | null),
        trades: Math.max(0, Math.round(Number(x.trades ?? 0))),
        profitCents: Math.max(0, Math.round(Number(x.profit_cents ?? 0))),
      }));
    },
  };
}
