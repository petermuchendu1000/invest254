import { type Cents } from "@invest254/shared";
import type { ActivityKind } from "@invest254/shared";
import type { Querier } from "./wallet.js";

/**
 * EngagementRepository: durable store for the activity feed and chat. Kept separate from
 * GameRepository (money) by responsibility. The engine writes here as the service role
 * (RLS-bypassing), so simple INSERT/SELECT/UPDATE suffice — no SECURITY DEFINER RPCs.
 * Simulated activity is flagged `is_simulated=true`; simulated chat has `user_id = null`.
 */
export interface ActivityRow { id: number; kind: ActivityKind; username: string; amountCents: Cents | null; isSimulated: boolean; message: string; createdAtMs: number; }
export interface ChatRow { id: number; userId: string | null; username: string; message: string; createdAtMs: number; }
/** A chat row as the admin moderation view sees it — visibility included (J6). */
export interface AdminChatRow extends ChatRow { isHidden: boolean; }
export interface InsertActivity { kind: ActivityKind; username: string; amountCents: Cents | null; isSimulated: boolean; message: string; }
export interface InsertChat { userId: string | null; username: string; message: string; }

export interface EngagementRepository {
  insertActivity(a: InsertActivity): Promise<ActivityRow>;
  listRecentActivity(limit: number): Promise<ActivityRow[]>; // newest first
  insertChat(c: InsertChat): Promise<ChatRow>;
  listRecentChat(limit: number): Promise<ChatRow[]>;          // visible (not hidden) only, newest first
  hideChat(id: number): Promise<boolean>;                     // moderation; true if a visible row was hidden
  unhideChat(id: number): Promise<boolean>;                   // moderation (J6); true if a hidden row was restored
  /** Moderation list (J6): newest-first, includes hidden rows (with their visibility) when asked. */
  adminListChat(limit: number, includeHidden: boolean): Promise<AdminChatRow[]>;
  getUsername(userId: string): Promise<string | null>;        // authoritative public handle for a player
}

/** Privacy mask for real player handles shown in the public feed (e.g. "wanj***"). */
export function maskHandle(username: string): string {
  const u = String(username ?? "");
  if (u.length <= 1) return "***";
  if (u.length <= 2) return `${u[0]}***`;
  return `${u.slice(0, Math.min(4, Math.max(2, Math.floor(u.length / 2))))}***`;
}

export class InMemoryEngagementRepository implements EngagementRepository {
  private activity: ActivityRow[] = [];
  private chat: ChatRow[] = [];
  private hidden = new Set<number>();
  private usernames = new Map<string, string>();
  private aId = 0;
  private cId = 0;

  /** Test/dev helper: register a player's display handle. */
  setUsername(userId: string, username: string): void { this.usernames.set(userId, username); }

  async insertActivity(a: InsertActivity): Promise<ActivityRow> {
    const row: ActivityRow = { id: ++this.aId, ...a, createdAtMs: Date.now() };
    this.activity.push(row);
    return row;
  }
  async listRecentActivity(limit: number): Promise<ActivityRow[]> {
    return this.activity.slice(-limit).reverse();
  }
  async insertChat(c: InsertChat): Promise<ChatRow> {
    const row: ChatRow = { id: ++this.cId, userId: c.userId, username: c.username, message: c.message, createdAtMs: Date.now() };
    this.chat.push(row);
    return row;
  }
  async listRecentChat(limit: number): Promise<ChatRow[]> {
    return this.chat.filter((r) => !this.hidden.has(r.id)).slice(-limit).reverse();
  }
  async hideChat(id: number): Promise<boolean> {
    if (this.hidden.has(id) || !this.chat.some((r) => r.id === id)) return false;
    this.hidden.add(id);
    return true;
  }
  async unhideChat(id: number): Promise<boolean> {
    if (!this.hidden.has(id)) return false;
    this.hidden.delete(id);
    return true;
  }
  async adminListChat(limit: number, includeHidden: boolean): Promise<AdminChatRow[]> {
    return this.chat
      .filter((r) => includeHidden || !this.hidden.has(r.id))
      .slice(-limit).reverse()
      .map((r) => ({ ...r, isHidden: this.hidden.has(r.id) }));
  }
  async getUsername(userId: string): Promise<string | null> { return this.usernames.get(userId) ?? null; }
}

const toCents = (v: unknown): Cents | null => (v === null || v === undefined ? null : (typeof v === "string" ? Number(v) : (v as number)));
const toMs = (v: unknown): number => (v instanceof Date ? v.getTime() : new Date(String(v)).getTime());

export class PgEngagementRepository implements EngagementRepository {
  constructor(private readonly q: Querier) {}
  async insertActivity(a: InsertActivity): Promise<ActivityRow> {
    const r = await this.q.query(
      "insert into activity_feed(kind, username, amount, is_simulated, message) values($1,$2,$3,$4,$5) returning id, created_at",
      [a.kind, a.username, a.amountCents, a.isSimulated, a.message]);
    return { id: Number(r.rows[0].id), ...a, createdAtMs: toMs(r.rows[0].created_at) };
  }
  async listRecentActivity(limit: number): Promise<ActivityRow[]> {
    const r = await this.q.query("select id, kind, username, amount, is_simulated, message, created_at from activity_feed order by created_at desc limit $1", [limit]);
    return r.rows.map((x) => ({ id: Number(x.id), kind: x.kind as ActivityKind, username: String(x.username), amountCents: toCents(x.amount), isSimulated: Boolean(x.is_simulated), message: String(x.message), createdAtMs: toMs(x.created_at) }));
  }
  async insertChat(c: InsertChat): Promise<ChatRow> {
    const r = await this.q.query("insert into chat_messages(user_id, username, message) values($1,$2,$3) returning id, created_at", [c.userId, c.username, c.message]);
    return { id: Number(r.rows[0].id), userId: c.userId, username: c.username, message: c.message, createdAtMs: toMs(r.rows[0].created_at) };
  }
  async listRecentChat(limit: number): Promise<ChatRow[]> {
    const r = await this.q.query("select id, user_id, username, message, created_at from chat_messages where is_hidden = false order by created_at desc limit $1", [limit]);
    return r.rows.map((x) => ({ id: Number(x.id), userId: x.user_id ?? null, username: String(x.username), message: String(x.message), createdAtMs: toMs(x.created_at) }));
  }
  async hideChat(id: number): Promise<boolean> {
    const r = await this.q.query("update chat_messages set is_hidden = true where id = $1 and is_hidden = false returning id", [id]);
    return r.rows.length > 0;
  }
  async unhideChat(id: number): Promise<boolean> {
    const r = await this.q.query("update chat_messages set is_hidden = false where id = $1 and is_hidden = true returning id", [id]);
    return r.rows.length > 0;
  }
  async adminListChat(limit: number, includeHidden: boolean): Promise<AdminChatRow[]> {
    const r = await this.q.query(
      `select id, user_id, username, message, is_hidden, created_at from chat_messages
        where ($2::boolean or is_hidden = false)
        order by created_at desc, id desc limit $1`,
      [limit, includeHidden]);
    return r.rows.map((x) => ({ id: Number(x.id), userId: x.user_id ?? null, username: String(x.username), message: String(x.message), isHidden: Boolean(x.is_hidden), createdAtMs: toMs(x.created_at) }));
  }
  async getUsername(userId: string): Promise<string | null> {
    const r = await this.q.query("select username from profiles where id = $1", [userId]);
    return r.rows.length ? String(r.rows[0].username) : null;
  }
}
