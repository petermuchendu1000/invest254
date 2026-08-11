# 12 — Bonuses & Promotions

## 1. Bonus balance & wagering
- Bonuses credit **bonus_balance** (restricted), tracked in `bonuses` with a **wagering requirement**
  (`wagering_x`): the bonus must be staked `amount × wagering_x` before it converts to **real_balance**.
- Play debits bonus before real (configurable); `wagered` increments by qualifying stake.
- When `wagered ≥ amount × wagering_x` → bonus `status='cleared'`, remaining bonus moves to real.
- Expiry: uncleared bonus past `expires_at` → `status='expired'` (removed from bonus_balance).

## 2. Bonus types
| Type | Trigger | Example |
|------|---------|---------|
| welcome | first signup/verify | KES 10 free play, wagering ×3 (configurable; can disable) |
| promo (deposit-match) | redeem `promo_code` on deposit | 100% match up to KES 500, wagering ×5 |
| promo (fixed) | redeem code | flat KES 50, wagering ×2 |
| manual | admin-issued | goodwill / retention |

## 3. Promo codes
- `promo_codes`: `type` (deposit_match/fixed), `value`, `max_amount`, `wagering_x`, `uses_left`,
  `expires_at`, `active`.
- `POST /promo/redeem { code }` validates active/uses/expiry, applies bonus, decrements `uses_left`.

## 4. Rules & anti-abuse
- One welcome bonus per phone/device.
- Bonus funds are **non-withdrawable** until wagering cleared; withdrawal attempts with active
  wagering are blocked (clear message shown).
- Affiliate commission does **not** accrue on bonus-funded turnover (see Affiliate doc).
- Max bonus exposure per user; admin can void abusive bonuses (audited).

## 5. Activity feed
- Bonus issuance can emit a feed item ("BONUS of X issued"), matching the screenshot.
