import { normalizeMsisdn, MIN_DEPOSIT_CENTS, MIN_WITHDRAWAL_CENTS, type Cents } from "@invest254/shared";
import type { PaymentRepository, CompleteResult, CreateWithdrawalResult } from "./payments.js";
import type { DarajaClient } from "./daraja.js";

/**
 * PaymentService orchestrates the deposit/withdrawal flows on top of the atomic RPCs
 * (PaymentRepository) and the Daraja provider. It is transport-agnostic: an HTTP layer
 * (apps/api) binds these methods to REST routes + Daraja callbacks. All money correctness
 * (credit/hold/reversal/idempotency) lives in the repository RPCs; this layer adds input
 * validation, MSISDN normalization, provider calls, and post-settlement event hooks.
 */
export interface PaymentEvents {
  /** Fired once when a withdrawal is confirmed paid (for the real activity feed). */
  onWithdrawalSuccess?(e: { userId: string; amountCents: Cents }): void;
}
export interface PaymentServiceOptions { minDepositCents?: Cents; minWithdrawalCents?: Cents; events?: PaymentEvents; verifyStkCallbacks?: boolean; }

export class PaymentService {
  private readonly minDeposit: Cents;
  private readonly minWithdrawal: Cents;
  private readonly events: PaymentEvents;
  private readonly verifyStk: boolean;
  constructor(private readonly repo: PaymentRepository, private readonly daraja: DarajaClient, opts: PaymentServiceOptions = {}) {
    this.minDeposit = opts.minDepositCents ?? MIN_DEPOSIT_CENTS;
    this.minWithdrawal = opts.minWithdrawalCents ?? MIN_WITHDRAWAL_CENTS;
    this.events = opts.events ?? {};
    // Secure by default: a client can POST to the public STK callback URL, so a raw
    // resultCode=0 is NOT trusted — we re-check with Safaricom before crediting. Opt out only
    // for environments where the callback source is otherwise authenticated (e.g. IP allowlist).
    this.verifyStk = opts.verifyStkCallbacks ?? true;
  }

  // ── Deposit (STK Push) ──
  async initiateDeposit(userId: string, amountCents: number, phoneRaw: string): Promise<{ txId: string; checkoutRequestId: string }> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("INVALID_AMOUNT");
    if (amountCents < this.minDeposit) throw new Error("BELOW_MIN");
    const msisdn = normalizeMsisdn(phoneRaw);
    const txId = await this.repo.createDeposit(userId, amountCents, msisdn);
    const stk = await this.daraja.stkPush({ amountCents, msisdn, accountRef: "Invest254", desc: "Deposit" });
    await this.repo.attachStk(txId, stk.merchantRequestId, stk.checkoutRequestId);
    return { txId, checkoutRequestId: stk.checkoutRequestId };
  }
  /**
   * Daraja STK callback handler (idempotent). A success (resultCode 0) is verified against
   * Safaricom via STKPushQuery before crediting so forged callbacks can't mint balance; while
   * the prompt is still processing (or the query is transiently unavailable) we throw so the
   * caller returns non-200 and Safaricom retries — the deposit is never credited unverified.
   */
  async handleStkCallback(checkoutRequestId: string, resultCode: number, resultDesc: string, receipt: string | null, raw: unknown): Promise<CompleteResult> {
    let code = resultCode;
    let desc = resultDesc;
    if (resultCode === 0 && this.verifyStk) {
      const q = await this.daraja.stkPushQuery(checkoutRequestId);
      if (q.processing || q.resultCode == null) {
        console.warn(`[payments] STK verify inconclusive for ${checkoutRequestId} (processing=${q.processing}); leaving pending for retry`);
        throw new Error("STK_VERIFY_PENDING");
      }
      code = q.resultCode;
      if (code !== 0) desc = `verified:${resultDesc}`;
    }
    return this.repo.completeDeposit(checkoutRequestId, code, desc, receipt, raw);
  }

  // ── Withdrawal (B2C) ──
  /** Player requests a withdrawal: validates and HOLDS funds atomically (status pending). */
  async requestWithdrawal(userId: string, amountCents: number, phoneRaw: string): Promise<CreateWithdrawalResult> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("INVALID_AMOUNT");
    if (amountCents < this.minWithdrawal) throw new Error("BELOW_MIN");
    const msisdn = normalizeMsisdn(phoneRaw);
    return this.repo.createWithdrawal(userId, amountCents, msisdn, this.minWithdrawal);
  }
  /** Finance admin approves: flips to processing and dispatches the B2C payment. */
  async approveWithdrawal(txId: string, adminId: string): Promise<{ approved: boolean; conversationId?: string }> {
    const ap = await this.repo.approveWithdrawal(txId, adminId);
    if (!ap.approved || ap.amountCents === null || ap.phone === null) return { approved: false };
    const b2c = await this.daraja.b2cPayment({ amountCents: ap.amountCents, msisdn: ap.phone, remarks: "Withdrawal", resultId: txId });
    return { approved: true, conversationId: b2c.conversationId };
  }
  /** Finance admin rejects a pending withdrawal: reverses the hold. */
  rejectWithdrawal(txId: string, adminId: string): Promise<{ reversed: boolean; newBalance: Cents }> {
    return this.repo.rejectWithdrawal(txId, adminId);
  }
  /** Daraja B2C result handler (idempotent). Success keeps the debit; failure reverses it. */
  async handleB2cResult(txId: string, resultCode: number, conversationId: string | null, receipt: string | null, raw: unknown): Promise<CompleteResult> {
    const res = await this.repo.completeWithdrawal(txId, resultCode, conversationId, receipt, raw);
    if (res.applied && res.status === "success") {
      const tx = await this.repo.getTransaction(txId);
      if (tx) this.events.onWithdrawalSuccess?.({ userId: tx.userId, amountCents: tx.amountCents });
    }
    return res;
  }

  getBalance(userId: string): Promise<Cents> { return this.repo.getBalance(userId); }
}
