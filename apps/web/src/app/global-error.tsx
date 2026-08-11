'use client';

// Last-resort boundary for failures in the root layout itself. It must render
// its own <html>/<body> because the normal layout has crashed.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          background: '#07090f',
          color: '#e6edf3',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          padding: '1.5rem',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Invest254 hit a problem</h1>
        <p style={{ maxWidth: '24rem', color: '#8b949e', fontSize: '0.875rem' }}>
          The app failed to load. Please reload — your account and balance are safe.
        </p>
        <button
          onClick={reset}
          style={{
            height: '2.75rem',
            padding: '0 1.25rem',
            borderRadius: '0.75rem',
            border: 'none',
            background: '#00a859',
            color: '#fff',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
