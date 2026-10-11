# 56 — Live sessions and the brand community

Two features that work together. **Migrations:** `0191_marketer_live_sessions.sql`, `0192_brand_community.sql`

## Live sessions (`marketer_live_sessions`)
A marketer marks when they go live; the dashboard shows what that session earned.

**It is a REPORT, not a gate.** `fn_pay_referral_commissions` still writes `deposit_commissions` for
every deposit, live or not. `earnedCents` asks which of the commissions this marketer *already
earned* fall inside the window. Nobody's pay changes because this exists — an operator reads the
number and decides. Making per-session pay the real rule would be a separate, deliberate change to
the money path.

- **Window:** `[started_at − margin, coalesce(ended_at, ends_at) + margin]`. A running session
  reports what it has earned *so far*.
- **The margin is copied onto the session at start**, so changing the brand setting later cannot
  restate what a past session earned.
- The join is on the **deposit's** timestamp, not the commission row's, so a commission written
  later by a retry or the reconcile sweep still belongs to the deposit that caused it.
- Start Live first expires anything past its time, so a forgotten session never blocks the next one.
  One open session per marketer is enforced by a **partial unique index**, not a read-then-write.

| Setting (`site_live_settings`, platform admin) | Default |
|---|---|
| `enabled` — off means the marketer sees no buttons at all | `false` |
| `session_minutes` | 60 |
| `margin_minutes` — the ± window that still counts | 10 |
| `extend_minutes` — one press of Extend | 30 |
| `max_sessions_daily` — 0 is unlimited | 0 |

**Routes:** `GET /marketers/me/live`, `POST …/live/{start,end,extend}` (marketer's own, guarded by
`requireMarketer`, which checks the database rather than the JWT claim).
`GET|PUT /platform/sites/:id/live-settings` (platform admin, audited).

## The community channel (`community_posts`)
A **channel, not a group**: operators post, players read and vote. There is no player composer in
the UI *or* on the server — a brand's own channel carrying an unmoderated player conversation is a
support and compliance surface nobody asked for, and players already have a voice in the trade
screen's live chat (docs/54).

- `kind` is `post`, `poll` or `live`, so the client renders each without parsing the body.
- Votes are keyed `(post_id, user_id)`: one player is one vote, and re-voting **updates**. The
  counts are counts of people.
- Voting refuses **in SQL** — the insert only lands if the option belongs to the post, the post
  belongs to this brand, and the poll is open. A post id guessed from another brand matches nothing.
- Going live writes a pinned `live` card and unpins the previous one.

**Routes:** `GET /community` + `POST /community/:id/vote` (any signed-in player);
`POST /community`, `/:id/pin`, `/:id/close`, `/:id/delete` (admin only). Page: `/community`.

## The live announcement
Start Live writes the card **and** broadcasts an in-app notification to every player account on the
brand, through the existing machinery (`0106`/`0141`), whose audience scoping is what stops one
brand reaching another's players. In-app only — not SMS, not WhatsApp.

Both run **after** the session exists and **cannot fail the request**: a marketer about to stream
must never be told "you are not live" because a fan-out had a bad minute.

### The copy
Persuasive and true. It names the brand, says what is happening, and invites people in. The
per-player version (`liveMessage`) also states **that player's own balance** — a real number they
can verify in the same app — and is built server-side from their own row, so a client cannot put a
different balance or a different link in front of someone.

It deliberately does **not**: promise a win, imply the session is more likely to pay, invent a
countdown, or claim anyone else is winning right now. Those are the lines that turn a marketing
message into a misrepresentation, which on a real-money product in this market is a regulatory
problem before it is an ethical one.

There are two versions for one reason: the broadcast goes to everyone, so it carries no figure that
would be wrong for somebody.
