'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatKes } from '@invest254/shared/money';
import { cn } from '@/lib/cn';
import { useCountUp } from '@/lib/useCountUp';
import { useWelcomeBonusFx } from '@/lib/game/welcomeBonusFx';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Full-screen welcome celebration shown once after signup. Deliberately reuses the WIN visual
 * language (green confetti + count-up + chip + haptics) so the 200 KES bonus reads as a real win,
 * then nudges the first deposit. Auto-dismisses; dismiss-on-tap. Purpose-built (not the game
 * OutcomeOverlay) so it never interferes with in-play balance/outcome animations.
 */
export function WelcomeBonusOverlay() {
  const current = useWelcomeBonusFx((s) => s.current);
  const clear = useWelcomeBonusFx((s) => s.clear);
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const amount = current?.amountCents ?? 0;
  const shown = useCountUp(visible ? amount : 0, 1100, current?.id);

  // Show / auto-dismiss lifecycle + celebratory haptics.
  useEffect(() => {
    if (!current) return;
    setVisible(true);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate([0, 40, 60, 40, 60, 90]); } catch { /* unsupported */ }
    }
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [current]);

  // Remove from the store after the exit transition.
  useEffect(() => {
    if (visible || !current) return;
    const t = setTimeout(() => clear(), 260);
    return () => clearTimeout(t);
  }, [visible, current, clear]);

  // Confetti burst (motion allowed).
  useEffect(() => {
    if (!visible || !current || prefersReducedMotion()) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth, H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr);

    const palette = ['#e3b341', '#f2cf5b', '#ffffff', '#3fb950', '#22e07e'];
    type P = { x: number; y: number; vx: number; vy: number; r: number; c: string; rot: number; vr: number };
    const parts: P[] = Array.from({ length: 150 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.4,
      y: H * 0.35 + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 9,
      vy: Math.random() * -11 - 4,
      r: Math.random() * 5 + 3,
      c: palette[Math.floor(Math.random() * palette.length)]!,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
    }));

    const start = performance.now();
    const DUR = 1800;
    const step = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - elapsed / DUR);
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6);
        ctx.restore();
      }
      if (elapsed < DUR) rafRef.current = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, W, H);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); ctx.clearRect(0, 0, W, H); };
  }, [visible, current]);

  if (!current) return null;

  const dismiss = () => setVisible(false);
  const goDeposit = () => { setVisible(false); router.push('/wallet'); };

  return (
    <div
      className={cn(
        'fixed inset-0 z-[60] flex items-center justify-center bg-black/70 transition-opacity duration-200',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      onClick={dismiss}
      role="dialog"
      aria-label="Welcome bonus"
    >
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div
        className={cn(
          'relative mx-4 flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-up/70 bg-surface p-7 text-center',
          'shadow-[0_0_60px_-6px_var(--pp-up)] transition-transform duration-200',
          visible ? 'scale-100' : 'scale-95',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="inline-flex rounded-full bg-up/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-up">
          Welcome gift
        </span>
        <h2 className="text-lg font-semibold text-fg">Your account is ready 🎉</h2>
        <div className="text-5xl font-black tabular-nums text-up">{formatKes(Math.round(shown))}</div>
        <p className="text-sm text-muted">
          We&rsquo;ve added a <span className="font-semibold text-fg">{formatKes(amount)}</span> welcome bonus to your wallet.
          Make your first deposit to boost your stake and start winning up to &times;5.
        </p>
        <div className="mt-1 flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={goDeposit}
            className="w-full rounded-xl bg-up px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Make your first deposit
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="w-full rounded-xl bg-surface-2 px-4 py-3 text-sm font-medium text-fg transition hover:bg-border"
          >
            Start playing
          </button>
        </div>
      </div>
    </div>
  );
}
