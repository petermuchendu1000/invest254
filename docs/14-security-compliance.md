# 14 — Security & Compliance

> Invest254 handles real money and is a gambling product. This section is guidance, **not legal
> advice** — operate under your licence and your lawyer's direction.

## 1. Regulatory (Kenya-focused)
- **Licensing:** a valid gaming licence is required (the team has counsel engaged). The footer licence
  line must reflect the **actual** issued licence.
- **BCLB / Kenya:** betting/gaming is regulated by the Betting Control and Licensing Board; rules cover
  advertising, minors, and operations. Confirm current requirements with counsel.
- **Taxes:** Kenyan regimes have included **excise duty on stakes** and **withholding tax on winnings**.
  Build tax handling as a configurable module (deduct/report) per current law.
- **AML/CFT:** transaction monitoring, thresholds, suspicious-activity reporting, record retention.
- **Responsible gaming:** ≥18 age-gate, self-exclusion, deposit/loss limits, reality checks, help links.
- **Advertising/consumer protection:** be cautious with the simulated activity feed and "win up to ×5"
  messaging; ensure claims are not misleading. Review with counsel.

## 2. Fairness & integrity
- Authoritative server-side curve + settlement; clients never decide outcomes.
- Provably-fair seed commit/reveal (simple server RNG, MVP) — see [Game Engine](02-game-engine.md).
- RTP monitor + audit; house edge changes are audited and versioned.

## 3. Application security
- All money ops atomic + idempotent; ledger immutable; reconciliation jobs.
- RLS on all player tables; service-role key used only in trusted server functions.
- Secrets in a vault (Daraja, SMS, service-role key); never in client or repo.
- Input validation/schema on every endpoint; rate limiting; CSRF/CORS locked down.
- M-Pesa callbacks IP-allowlisted + payload-validated + idempotent.
- JWT verification on REST and WS; least-privilege roles; admin app isolated.
- Audit log for every admin action and money movement.

## 4. Data protection
- Kenya **Data Protection Act (2019)** alignment: lawful basis, minimal PII, encryption at rest
  (Supabase) + in transit (TLS), retention policy, user data-access/deletion process.
- KYC documents (post-MVP) in a private, access-controlled bucket.

## 5. Abuse & fraud
- Multi-account/collusion detection, self-referral block, bonus-abuse controls, velocity checks,
  device fingerprinting (later), withdrawal review queue.

## 6. Threat model highlights
| Threat | Mitigation |
|--------|------------|
| Client tampering with outcomes | server-authoritative engine; client is display-only |
| Double-spend / race on wallet | row locks + idempotency + immutable ledger |
| Replay of M-Pesa callbacks | idempotency by CheckoutRequestID + allowlist |
| Bonus farming via affiliates | commission on real turnover only; self-referral block |
| Under-age play | DOB age-gate before deposit/play |
| RTP manipulation | config changes audited; RTP monitor + alerts |
