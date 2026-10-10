/**
 * The brand's recent REAL activity: deposits that settled, withdrawals that were paid, and trades
 * that won. This is what the candlestick screen's Live Chat shows between players' messages.
 *
 * Every row here describes something that actually happened to a real account on this brand. The
 * screen it feeds was copied from a page whose equivalent feed is generated — its own rows come back
 * typed `system_simulated`, naming withdrawals nobody made — and that is the one thing from the mock
 * that is not reproduced. A feed of invented winnings above a deposit button is a lie told to the
 * person about to deposit.
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
}

export interface BrandActivityStore {
  recent(siteId: string, limit: number): Promise<BrandActivityItem[]>;
}

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
       * Demo and practice rows are excluded in the positions arm; transactions carry no demo flag
       * because a demo wallet never reaches a payment provider.
       */
      const r = await q.query(
        `select kind, username, amount_cents, ago_seconds from (
             select 'deposit' as kind, p.username,
                    t.amount as amount_cents,
                    extract(epoch from (now() - t.created_at)) as ago_seconds,
                    t.created_at as at
               from transactions t join profiles p on p.id = t.user_id
              where t.site_id = $1 and t.kind = 'deposit' and t.status = 'success'
              order by t.created_at desc limit $2
           union all
             select 'withdrawal', p.username, t.amount,
                    extract(epoch from (now() - t.created_at)),
                    t.created_at
               from transactions t join profiles p on p.id = t.user_id
              where t.site_id = $1 and t.kind = 'withdrawal' and t.status = 'success'
              order by t.created_at desc limit $2
           union all
             select 'win', p.username, o.payout,
                    extract(epoch from (now() - o.settled_at)),
                    o.settled_at
               from positions o join profiles p on p.id = o.user_id
              where o.site_id = $1 and o.result = 'win' and o.status = 'settled'
                and o.settled_at is not null and o.payout > 0
                and coalesce(o.demo, false) = false and coalesce(o.practice, false) = false
              order by o.settled_at desc limit $2
         ) rows
         order by at desc limit $2`,
        [siteId, limit],
      );
      return r.rows.map((x) => ({
        kind: x.kind === 'withdrawal' ? 'withdrawal' : x.kind === 'win' ? 'win' : 'deposit',
        name: publicName(x.username as string | null),
        amountCents: Math.max(0, Math.round(Number(x.amount_cents ?? 0))),
        agoSeconds: Math.max(0, Math.round(Number(x.ago_seconds ?? 0))),
      }));
    },
  };
}
