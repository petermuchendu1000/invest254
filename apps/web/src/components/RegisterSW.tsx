'use client';

import { useEffect } from 'react';

// Registers the PWA service worker after the page loads. Production-only so it
// never interferes with Next.js dev/HMR. Renders nothing.
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* registration is best-effort; the app works without it */
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
