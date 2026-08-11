import Link from 'next/link';

export const metadata = { title: 'Offline — Invest254' };

// Served by the service worker when a navigation fails with no network.
export default function OfflinePage() {
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-2xl font-bold text-accent-fg">
        P
      </div>
      <h1 className="text-xl font-semibold tracking-tight">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-muted">
        Invest254 needs a connection for live prices, your wallet and trading. Reconnect and try
        again — the curve and your balance always come straight from the server.
      </p>
      <Link
        href="/"
        className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-medium text-accent-fg"
      >
        Retry
      </Link>
    </section>
  );
}
