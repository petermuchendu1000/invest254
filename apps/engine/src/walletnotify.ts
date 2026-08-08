/**
 * Real-time wallet balance push (Issue: "balance not refreshing in real-time").
 *
 * The WS engine only pushed a `balance` frame on engine-driven events (auth / open_position /
 * position_settled). Balance changes that originate in a REST-API RPC — M-Pesa deposit
 * confirmation, withdrawal hold/settle/refund, admin manual credit/debit, deposit-bonus credit,
 * bonus conversion — never reached the connected browser, so the on-screen balance went stale
 * until a full reload.
 *
 * This mirrors the proven `game_config_changed` design (migration 0028 + GameConfigStore):
 * migration 0040's trigger fires `pg_notify('wallet_changed', <user_id>)` from an AFTER trigger
 * on `wallets`, and this notifier LISTENs on that channel and hands each changed userId to the
 * server, which pushes a fresh `balance` frame to that user's sockets.
 *
 * Robustness: a dedicated LISTEN connection with reconnect-on-error backoff. If the connection
 * drops, it re-arms; the server also re-reads the wallet on the next auth as a natural backstop.
 */

export const WALLET_CHANNEL = "wallet_changed";

/** Minimal LISTEN surface — `pg.Pool.connect()` satisfies this; kept structural for tests. */
export interface WalletListenClient {
  query(sql: string, params?: unknown[]): Promise<unknown>;
  on(event: "notification", cb: (msg: { channel: string; payload?: string }) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  release?(err?: boolean): void;
}
export type WalletListenConnector = () => Promise<WalletListenClient>;

export interface WalletNotifierOptions {
  /** Opens a dedicated connection for LISTEN (e.g. `() => pool.connect()`). */
  connect: WalletListenConnector;
  /** Invoked with each changed userId; the caller pushes to that user's live sockets. */
  onChange: (userId: string) => void;
  /** Reconnect backoff after a LISTEN connection error. Default 5s. */
  reconnectMs?: number;
  onError?: (err: Error, ctx: string) => void;
}

export class WalletNotifier {
  private client: WalletListenClient | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(private readonly opts: WalletNotifierOptions) {}

  /** Arm the LISTEN. Resolves once the initial attempt completes (reconnects continue in the background). */
  async init(): Promise<void> {
    await this.arm();
  }

  private report(err: Error, ctx: string): void {
    this.opts.onError?.(err, ctx);
  }

  private drop(): void {
    const c = this.client;
    this.client = undefined;
    try {
      c?.release?.(true);
    } catch {
      /* ignore release errors on a broken connection */
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const ms = this.opts.reconnectMs ?? 5_000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.arm();
    }, ms);
    this.reconnectTimer.unref?.();
  }

  private async arm(): Promise<void> {
    if (this.stopped || this.client) return;
    try {
      const client = await this.opts.connect();
      this.client = client;
      client.on("notification", (msg) => {
        if (msg.channel !== WALLET_CHANNEL) return;
        const userId = msg.payload;
        if (userId) this.opts.onChange(userId);
      });
      client.on("error", (err) => {
        this.report(err, "listen");
        this.drop();
        this.scheduleReconnect();
      });
      await client.query(`listen ${WALLET_CHANNEL}`);
    } catch (err) {
      this.report(err as Error, "connect");
      this.drop();
      this.scheduleReconnect();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.drop();
  }
}
