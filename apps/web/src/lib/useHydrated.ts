'use client';

import { useEffect, useState } from 'react';

/** True only after the first client mount — use to avoid SSR/client hydration mismatches. */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
