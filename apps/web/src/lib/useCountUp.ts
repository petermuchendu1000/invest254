import { useEffect, useRef, useState } from 'react';

/**
 * Animate a number from its previous value to `target` over `durationMs` using
 * an ease-out curve. Returns the current interpolated value. Respects reduced
 * motion (snaps instantly). Re-runs whenever `target` or `runKey` changes.
 */
export function useCountUp(target: number, durationMs = 900, runKey?: unknown): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const from = fromRef.current;
    const delta = target - from;
    if (reduce || durationMs <= 0 || delta === 0) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setValue(from + delta * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = target;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, runKey]);

  return value;
}
