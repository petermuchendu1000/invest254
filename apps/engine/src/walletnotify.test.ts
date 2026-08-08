import { test } from "node:test";
import assert from "node:assert/strict";
import { WalletNotifier, WALLET_CHANNEL, type WalletListenClient } from "./walletnotify.js";

/** A fake LISTEN client that lets a test drive `notification` / `error` events. */
class FakeClient implements WalletListenClient {
  listened: string[] = [];
  released = false;
  private notifyCb?: (m: { channel: string; payload?: string }) => void;
  private errorCb?: (e: Error) => void;
  async query(sql: string): Promise<unknown> {
    this.listened.push(sql);
    return { rows: [] };
  }
  on(event: "notification" | "error", cb: any): unknown {
    if (event === "notification") this.notifyCb = cb;
    else this.errorCb = cb;
    return this;
  }
  release(): void {
    this.released = true;
  }
  emitNotify(payload?: string, channel = WALLET_CHANNEL): void {
    this.notifyCb?.(payload === undefined ? { channel } : { channel, payload });
  }
  emitError(err: Error): void {
    this.errorCb?.(err);
  }
}

test("arms LISTEN on the wallet channel and forwards changed userIds", async () => {
  const client = new FakeClient();
  const changed: string[] = [];
  const n = new WalletNotifier({ connect: async () => client, onChange: (id) => changed.push(id) });
  await n.init();

  assert.ok(client.listened.some((s) => s.toLowerCase() === `listen ${WALLET_CHANNEL}`));

  client.emitNotify("user-1");
  client.emitNotify("user-2");
  client.emitNotify(undefined); // ignored — no payload
  client.emitNotify("user-3", "some_other_channel"); // ignored — wrong channel

  assert.deepEqual(changed, ["user-1", "user-2"]);
  await n.stop();
  assert.equal(client.released, true);
});

test("reconnects after a listen error", async () => {
  let connects = 0;
  const clients: FakeClient[] = [];
  const n = new WalletNotifier({
    connect: async () => {
      connects += 1;
      const c = new FakeClient();
      clients.push(c);
      return c;
    },
    onChange: () => {},
    reconnectMs: 5,
  });
  await n.init();
  assert.equal(connects, 1);

  clients[0]!.emitError(new Error("connection reset"));
  await new Promise((r) => setTimeout(r, 20)); // wait past the reconnect backoff

  assert.equal(connects, 2, "should have re-armed a fresh LISTEN connection");
  assert.equal(clients[0]!.released, true, "the broken connection is released");
  await n.stop();
});
