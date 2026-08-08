# 07 — Wallet & Transactions

## 1. Balances
Each user has one `wallets` row with two buckets (cents, KES):
- **real_balance** — withdrawable; funded by deposits & winnings.
- **bonus_balance** — restricted; from bonuses/promos; converts to real after wagering met.

## 2. The ledger is the source of truth
Every balance change writes an immutable `ledger_entries` row (double-entry style). The `wallets`
row is a fast cache; it must always equal the sum of ledger entries per bucket. A nightly job
reconciles `wallets` vs `Σ ledger` and alerts on mismatch.

## 3. Atomic settlement (critical)
All money operations run inside a single Postgres transaction using `SELECT … FOR UPDATE` on the
wallet row (or a Redis lock keyed by user) to prevent races/double-spend:

```sql
-- Open position (debit stake)
begin;
  select * from wallets where user_id = :uid for update;
  -- assert real_balance + bonus_balance >= stake
  update wallets set real_balance = real_balance - :stake_real,
                     bonus_balance = bonus_balance - :stake_bonus,
                     updated_at = now()
   where user_id = :uid;
  insert into ledger_entries(user_id,type,amount,balance_kind,ref_table,ref_id)
       values (:uid,'stake',-:stake,'real',  'positions',:pid);
  insert into positions(...);
commit;
```
- **Stake priority:** bonus funds are wagered before real (configurable), to satisfy wagering rules.
- **Payout** credits `real_balance` (winnings are withdrawable) and writes a `payout` ledger entry.
- **Idempotency:** settling a position is keyed by `position_id`; re-runs are no-ops.

### 3.1 Implemented as Postgres RPCs (migration 0010)
Two `SECURITY DEFINER` functions (service-role only) make open/settle atomic + idempotent:
- **`fn_open_position(user, stake, direction, entry_rate, duration_s, game_day, nonce)`** — locks the
  wallet (`FOR UPDATE`), verifies funds, debits `real_balance`, inserts the `positions` row (status
  `open`, **without** the outcome) and a `stake` ledger entry; returns `(position_id, new_balance)`.
- **`fn_settle_position(position, exit_rate, result, multiplier, payout)`** — locks the position; if
  already settled it is a **no-op** (idempotent); otherwise updates the row, credits `real_balance`
  (if payout > 0) and writes a `payout` ledger entry; returns `(settled, new_balance)`.
The engine's `PgGameRepository` calls these; the in-memory repository mirrors the same contract for
tests. Verified live against the database (balances, ledger rows, idempotent re-settle, insufficient
funds).

## 4. Transaction states (deposits/withdrawals)
```
deposit:    pending → processing → success | failed
withdrawal: pending → (admin approve) → processing → success | failed | reversed
```
- Failed deposits never credit. Failed/reversed withdrawals **re-credit** real_balance (reversal entry).

### 4.1 Implemented as Postgres RPCs (migration 0014)
Deposits/withdrawals are atomic + idempotent `SECURITY DEFINER` functions (service-role only),
mirroring the 0010 game RPCs and **verified live**:
- **`fn_create_deposit` → `fn_attach_stk` → `fn_complete_deposit`** — deposit credits `real_balance`
  and writes a `deposit` ledger entry on `ResultCode 0`; idempotent by `checkout_request_id`.
- **`fn_create_withdrawal`** — HOLDs funds (debit + negative `withdrawal` ledger) at request time.
- **`fn_approve_withdrawal` / `fn_reject_withdrawal`** — admin approve (→ B2C) or reject (reverse hold).
- **`fn_complete_withdrawal`** — B2C result: success keeps the debit; failure writes
  `withdrawal_reversal` and re-credits. Idempotent by transaction id.
The engine's `PgPaymentRepository` calls these; `InMemoryPaymentRepository` mirrors the contract for
tests. See docs/08 §6 for the full implementation map.

## 5. Limits & responsible gaming
- Min stake 250; min deposit & withdrawal configurable (default 200 / 250).
- Per-user daily deposit limit, daily loss limit, self-exclusion (cooldown) — see Compliance doc.
- Withdrawals blocked if KYC insufficient or active wagering requirement unmet (bonus funds).
