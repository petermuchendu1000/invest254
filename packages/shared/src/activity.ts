import { SeededRng } from "./prng.js";
import { formatKes, type Cents } from "./money.js";

/**
 * Deterministic generators for the "Live Activity" social-proof feed and simulated chat
 * filler. Pure functions of a SeededRng so the same seed reproduces the same stream —
 * used both by the engine's runtime simulator and by the DB seed (conceptually mirrored
 * in SQL). Simulated entries are clearly flagged (`activity_feed.is_simulated = true`;
 * simulated chat carries a NULL user_id) so real vs. simulated is always auditable.
 */
export type ActivityKind = "withdrawal" | "win" | "bonus" | "signup";

/** Kenyan-style handle building blocks (matches the BTC/KES, M-Pesa target market). */
export const FIRST_NAMES: readonly string[] = [
  "brian", "kevin", "john", "peter", "james", "david", "samuel", "dennis", "victor", "collins",
  "wanjiku", "achieng", "amina", "njeri", "faith", "mercy", "grace", "cynthia", "esther", "joy",
  "otieno", "kamau", "mwangi", "kiprop", "wafula", "omondi", "chebet", "barasa", "mutua", "njoroge",
  "shiro", "zawadi", "baraka", "imani", "salim", "halima", "rashid", "abdi", "yusuf", "fatuma",
];
const HANDLE_STYLES = ["{n}_254", "{n}.ke", "{n}{d}", "{n}_{d}", "mr{n}", "ms{n}", "{n}official", "the{n}"];

/** Build a plausible, deterministic public handle (no PII — fully synthetic). */
export function makeUsername(rng: SeededRng): string {
  const name = FIRST_NAMES[Math.floor(rng.next() * FIRST_NAMES.length)]!;
  const style = HANDLE_STYLES[Math.floor(rng.next() * HANDLE_STYLES.length)]!;
  const d = Math.floor(rng.range(1, 1000));
  return style.replace("{n}", name).replace("{d}", String(d));
}

export interface ActivityEvent { kind: ActivityKind; username: string; amountCents: Cents | null; message: string; }

// Weighted kind mix — wins/withdrawals dominate the feel; signups are occasional.
const KIND_WEIGHTS: ReadonlyArray<[ActivityKind, number]> = [["win", 0.5], ["withdrawal", 0.3], ["bonus", 0.15], ["signup", 0.05]];
// Inclusive cent ranges per kind (KES * 100).
const AMOUNT_RANGE: Record<Exclude<ActivityKind, "signup">, [Cents, Cents]> = {
  withdrawal: [50_000, 5_000_000], // KES 500 – 50,000
  win: [10_000, 2_500_000],        // KES 100 – 25,000
  bonus: [1_000, 50_000],          // KES 10 – 500
};

function pickKind(rng: SeededRng): ActivityKind {
  let r = rng.next();
  for (const [kind, w] of KIND_WEIGHTS) { if (r < w) return kind; r -= w; }
  return "win";
}
/** Uniform integer cents in [min, max]. */
function amountCents(rng: SeededRng, kind: Exclude<ActivityKind, "signup">): Cents {
  const [lo, hi] = AMOUNT_RANGE[kind];
  return Math.round(rng.range(lo, hi + 1) - 0.5);
}

/** Build the human-readable feed line for an event. */
export function activityMessage(kind: ActivityKind, username: string, amountCents: Cents | null, multiplier?: number): string {
  switch (kind) {
    case "withdrawal": return `@${username} cashed out ${formatKes(amountCents ?? 0)} to M-Pesa`;
    case "win": return `@${username} just won ${formatKes(amountCents ?? 0)}${multiplier ? ` on a ×${multiplier.toFixed(2)} trade` : ""}`;
    case "bonus": return `BONUS of ${formatKes(amountCents ?? 0)} issued to @${username}`;
    case "signup": return `@${username} just joined Invest254`;
  }
}

/** One deterministic simulated activity event. */
export function simulateActivity(rng: SeededRng): ActivityEvent {
  const kind = pickKind(rng);
  const username = makeUsername(rng);
  if (kind === "signup") return { kind, username, amountCents: null, message: activityMessage(kind, username, null) };
  const amt = amountCents(rng, kind);
  const mult = kind === "win" ? Number(rng.range(1.1, 5).toFixed(2)) : undefined;
  return { kind, username, amountCents: amt, message: activityMessage(kind, username, amt, mult) };
}

/**
 * Simulated chat filler — written to read like real Kenyan Aviator/betting group chat
 * (Sheng/Swahili-English mix, M-Pesa cash-out talk), not AI copy. Emoji is rare on purpose:
 * real chat is mostly plain text. Simulated rows are always flagged (user_id = null), so this
 * is social-proof filler, never presented as verified individual advice.
 */
export const CHAT_LINES: readonly string[] = [
  "nimeweka 200 nimetoa 1,500 leo",
  "cashout mapema bro usingoje x10",
  "mimi huwa nacashout kwa 2x tu",
  "hii curve iko poa leo",
  "weka pesa polepole usiharakishe",
  "nani ako up leo?",
  "niko na streak ya wins tatu mfululizo",
  "usiogope kuweka, weka tu utaona",
  "form ni kucashout mapema",
  "nimeanza na 100 saa hii niko 800",
  "weka 500 utoe 3k",
  "polepole ndio mwendo",
  "tumia akili usiweke yote kwa moja",
  "M-Pesa deposit ni instant kabisa",
  "green run imeanza, tuweke",
  "nacashout na 3x sina stress",
  "deposit small, toa mapema, rudia",
  "wewe umeweka ngapi leo?",
  "chukua profit mapema bro",
  "hii ndio side hustle yangu fr",
  "nimetoa 5k nimeweka kwa M-Pesa",
  "cashout ni discipline bana",
  "usikimbie x10, chukua 2x uende",
  "leo niko poa, wins tatu",
  "weka ka 200 hivi ujaribu",
  "pesa iko, deposit iko instant",
  "mimi nacashout kabla curve ianguke",
  "naona green leo, tuweke haraka",
  "sina haraka, polepole na 2x",
  "form ni kuweka na kutoa mapema",
  "nani anajua timing ya cashout?",
  "leo nimeanza vizuri, deposit imeingia",
  "toa mapema ushinde mara nyingi",
  "mimi huweka kidogo natoa mob",
  "usikae pembeni, weka deposit ushiriki",
  "niko na target ya 2k leo",
  "cashout ni kila kitu, ni timing bro",
  "weka deposit uone vibe yenyewe",
  "nimeweka rent nikatoa double 💰",
  "cashout kwa 1.5x pia ni win",
  "hapa ni akili sio bahati tu",
  "leo ni leo, deposit tu",
  "green tena, weka haraka 🔥",
  "aki hii game inanipa doo",
  "nimecashout, next round tuko",
  "weka pesa mnono uone difference",
  "timing ya cashout ndio kila kitu",
  "small stake, toa mapema, rudia tena",
  "leo doo iko, tumefika",
  "usiogope, anza na 200 tu",
];

/** One deterministic simulated chat line (username has no backing profile -> system/simulated). */
export function simulateChat(rng: SeededRng): { username: string; message: string } {
  return { username: makeUsername(rng), message: CHAT_LINES[Math.floor(rng.next() * CHAT_LINES.length)]! };
}
