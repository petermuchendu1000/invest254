/**
 * seed-activity.mjs — fill a brand's public activity feed with SEEDED social-proof rows.
 *
 * WHY THIS IS A SCRIPT AND NOT A FEATURE. Seeding a feed is a marketing decision taken once per
 * brand launch, by a person, who should have to type the brand and the count. Putting it behind an
 * API route would make invented activity something the product does on its own; a script that an
 * operator runs deliberately keeps a human on the hook for it.
 *
 * It writes ONLY to public.activity_seed (0193). It must never be made to write to `transactions`,
 * `positions`, `wallets` or `deposit_commissions`: those are the ledger, and a fabricated row in
 * them would move a real balance, a real report and a real commission. Because this table is
 * outside all of that, undoing a seeding run is a DELETE and costs nothing:
 *
 *   delete from activity_seed where site_id = (select id from sites where slug = '<slug>');
 *
 * Rows are backdated across the last ~48 hours rather than inserted at `now()`, because 200 rows
 * all aged "0s ago" is the one thing that makes a seeded feed obvious at a glance.
 *
 * Env:  DATABASE_URL (required — Supabase session-pooler :5432). Credentials are never written in
 *       this file; a hard-coded connection string in a repo is a leaked database.
 * Run:  DATABASE_URL=... node scripts/seed-activity.mjs <site-slug> <count>
 *       DATABASE_URL=... node scripts/seed-activity.mjs cpfmarket 120 --dry-run
 */
import { Pool } from "pg";

const DRY_RUN = process.argv.includes("--dry-run");
const [slug, countArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));

/** The window seeded over. Two days is long enough that ages look organic, short enough to read as "recent". */
const WINDOW_SECONDS = 48 * 60 * 60;
/** KES, inclusive. A feed of only big wins reads as bait; a feed of only small ones reads as dead. */
const MIN_KES = 500;
const MAX_KES = 25_000;

/**
 * Kenyan first names, as they are actually written here. These are display names with no account
 * behind them, which is why the feed shows them verbatim instead of shortening them the way it
 * shortens a real player's username.
 */
const NAMES = [
  "Wanjiku", "Kamau", "Njeri", "Otieno", "Achieng", "Mutua", "Wafula", "Chebet",
  "Kiprotich", "Nyambura", "Omondi", "Mwangi", "Auma", "Kipchoge", "Wairimu",
  "Barasa", "Atieno", "Mueni", "Kariuki", "Jebet", "Ochieng", "Nekesa", "Githinji",
  "Adhiambo", "Maina", "Chepkoech", "Onyango", "Wambui", "Kirui", "Naliaka",
  "Mumo", "Simiyu", "Makena", "Oduor", "Syombua", "Rotich", "Kagendo", "Juma",
  "Waweru", "Anyango", "Kilonzo", "Cherono", "Mutiso", "Nduta", "Okoth", "Kemunto",
];

/**
 * Deposits dominate, wins are common, withdrawals are the rarest. That ordering is roughly what the
 * real feed looks like, and a seeded feed that is mostly withdrawals would be a feed bragging about
 * money leaving — the opposite of the point.
 */
const KINDS = [
  ...Array(5).fill("deposit"),
  ...Array(3).fill("win"),
  ...Array(2).fill("withdrawal"),
];

const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

/** Round to a tidy KES figure: people deposit 1,500, not 1,487. */
function amountCents() {
  const kes = MIN_KES + Math.random() * (MAX_KES - MIN_KES);
  const step = kes < 2_000 ? 50 : kes < 10_000 ? 100 : 500;
  return Math.round(kes / step) * step * 100;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is required"); process.exit(2); }
  const count = Number.parseInt(countArg ?? "", 10);
  if (!slug || !Number.isFinite(count) || count < 1 || count > 5_000) {
    console.error("usage: DATABASE_URL=... node scripts/seed-activity.mjs <site-slug> <count 1..5000> [--dry-run]");
    process.exit(2);
  }

  const pool = new Pool({ connectionString: url, max: 3 });
  try {
    const { rows } = await pool.query("select id, slug from public.sites where slug = $1", [slug]);
    const site = rows[0];
    if (!site) { console.error(`no site with slug '${slug}'`); process.exit(1); }

    // Ages are drawn independently and then sorted, so the feed thins out towards the older end the
    // way a real one does rather than arriving on a perfectly even tick.
    const ages = Array.from({ length: count }, () => Math.floor(Math.random() * WINDOW_SECONDS)).sort((a, b) => a - b);
    const seeds = ages.map((ageSeconds) => ({
      kind: pick(KINDS),
      name: pick(NAMES),
      amountCents: amountCents(),
      ageSeconds,
    }));

    if (DRY_RUN) {
      for (const s of seeds.slice(0, 10)) {
        console.log(`${s.kind.padEnd(10)} ${s.name.padEnd(12)} KES ${(s.amountCents / 100).toLocaleString()}  ${Math.round(s.ageSeconds / 60)}m ago`);
      }
      console.log(`--dry-run: ${seeds.length} rows would be inserted for '${site.slug}' (showing first 10)`);
      return;
    }

    // One multi-row INSERT: the whole run lands or none of it does, so a half-seeded feed is never
    // left behind for someone to puzzle over. unnest keeps it to a single bind for any count.
    await pool.query(
      `insert into public.activity_seed (site_id, kind, name, amount_cents, created_at)
       select $1, k, n, a, now() - make_interval(secs => g)
         from unnest($2::text[], $3::text[], $4::bigint[], $5::double precision[]) as t(k, n, a, g)`,
      [
        site.id,
        seeds.map((s) => s.kind),
        seeds.map((s) => s.name),
        seeds.map((s) => s.amountCents),
        seeds.map((s) => s.ageSeconds),
      ],
    );
    console.log(`seeded ${seeds.length} activity_seed rows for '${site.slug}' across the last ${WINDOW_SECONDS / 3600}h`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
