# 11 — Activity Feed & Chat

> Status: **implemented** in `apps/engine` (`engagement.ts`, `activityservice.ts`, `chatservice.ts`)
> and `packages/shared` (`activity.ts`, `chatfilter.ts`); backlog seeded by migration 0013.
> Pure generation/sanitization logic is covered by automated tests.

## 1. Live Activity feed
Left-rail stream of social-proof events (as in the screenshot): "CONGRATULATIONS @user on
withdrawal of X", win notices, "BONUS of X issued".

### 1.1 Source: mixed (real + simulated) — MVP default
- **Real events:** `ActivityService.record{Win,Withdrawal,Bonus,Signup}()` insert with
  `is_simulated=false` and broadcast over WS `activity`. Wired: a settled win with
  `payout ≥ BIG_WIN_CENTS` posts a **privacy-masked** handle (`maskHandle`, e.g. `wanj***`)
  to protect player identity. Withdrawal/bonus/signup hooks are exposed for the
  payments/bonus/auth systems to call.
- **Simulated events:** `ActivityService` runs a deterministic generator (seeded;
  `packages/shared/activity.ts`) on a cadence, flagged `is_simulated=true`. Keeps the feed
  lively at low traffic. **Migration 0013 seeds ≥500 simulated activity rows** so the feed is
  populated from first load; on connect the engine sends an `activity_batch` backfill.

> Transparency note: simulated entries are an industry-common engagement device but must comply with
> advertising/consumer-protection rules. Simulation is toggleable and simulated/real are
> distinguishable in the DB for audit (`is_simulated`). **Recommended:** keep simulation modest and
> review with your legal counsel.

### 1.2 Config
- **MVP (implemented):** engine env — `ACTIVITY_SIM=on|off`, `ACTIVITY_CADENCE_MS` (default 4000),
  `BIG_WIN_CENTS` (default 500000 = KES 5,000), `ONLINE_FLOOR`.
- **Future:** DB-driven admin config (name pool, amount ranges, messages/minute, thresholds).

## 2. Chat
- Authenticated players post short messages (≤200 chars), streamed via WS `chat`;
  `ChatService.post()` validates, **rate-limits 1 msg / 2s per user** (consumed only on
  acceptance), and persists. On join, `subscribe_chat` returns a `chat_batch`.
- **Sanitization (`packages/shared/chatfilter.ts`, tested):** URLs and phone numbers
  (07xx / +2547xx / long digit runs) are stripped; a profanity set is masked; empty/over-length
  rejected. Each applied filter is reported in `reasons`.
- **Identity:** the display username is the **server-resolved** `profiles.username` (never trusted
  from the client); dev mode falls back to `guest_<id>`. Simulated/seeded chat carries `user_id=NULL`.
- **Moderation:** `ChatService.hide(id)` sets `is_hidden=true`; hidden messages are excluded from
  `listRecentChat`. (Mute/ban live with admin — docs/10.)
- **Seed:** migration 0013 seeds ≥500 simulated chat messages.

## 3. Online counter
- Engine tracks live WS connections → broadcasts `online { count }` on connect/disconnect.
- A configurable display floor (`ONLINE_FLOOR`) is applied: `count = max(realConnections, floor)`;
  the raw real count is always available server-side.
