/**
 * Chat input sanitization (anti-scam, anti-spam). Pure and deterministic so it can be
 * unit-tested and reused by any surface. The engine's ChatService layers stateful
 * rate-limiting on top (see apps/engine/src/chat.ts).
 *
 * Rules (docs/11): messages are <= MAX_CHAT_LEN chars; URLs and phone numbers are
 * stripped (players must not trade contact details / off-platform links); a small
 * profanity set is masked. A message that is empty after sanitization is rejected.
 */
export const MAX_CHAT_LEN = 200;

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|ke|app|xyz|info|link|me)\b\S*/gi;
// Phone-ish: +2547XXXXXXXX, 07XXXXXXXX, 01XXXXXXXX, or any run of 7+ digits (allowing spaces/dashes).
const PHONE_RE = /\b(?:\+?254|0)?[\s-]?(?:7|1)\d{2}[\s-]?\d{3}[\s-]?\d{3}\b|\b\d(?:[\s-]?\d){6,}\b/g;
// Minimal profanity set (word-boundary, case-insensitive). Extendable via admin later.
const PROFANITY = ["fuck", "shit", "bitch", "asshole", "bastard", "dick", "cunt"];
const PROFANITY_RE = new RegExp(`\\b(${PROFANITY.join("|")})\\b`, "gi");

export interface SanitizeResult {
  ok: boolean;          // true if a non-empty message survives sanitization and length check
  text: string;         // sanitized text (safe to persist/broadcast)
  reasons: string[];    // what was changed/why rejected: "empty" | "too_long" | "link" | "number" | "profanity"
}

export function sanitizeChat(raw: string, maxLen: number = MAX_CHAT_LEN): SanitizeResult {
  const reasons: string[] = [];
  const collapsed = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return { ok: false, text: "", reasons: ["empty"] };
  if (collapsed.length > maxLen) return { ok: false, text: "", reasons: ["too_long"] };

  let text = collapsed;
  // NB: use replace + compare (never .test()) — calling .test() on a /g regex mutates
  // its lastIndex and would corrupt the following .replace().
  let next = text.replace(URL_RE, "[link removed]");
  if (next !== text) { reasons.push("link"); text = next; }
  next = text.replace(PHONE_RE, "[number removed]");
  if (next !== text) { reasons.push("number"); text = next; }
  next = text.replace(PROFANITY_RE, (m) => "*".repeat(m.length));
  if (next !== text) { reasons.push("profanity"); text = next; }

  text = text.replace(/\s+/g, " ").trim();
  if (text.length === 0) return { ok: false, text: "", reasons: reasons.length ? reasons : ["empty"] };
  return { ok: true, text, reasons };
}
