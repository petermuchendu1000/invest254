 'use client';

import { useEffect, useRef } from 'react';
import { CURVE_AMPLITUDE, CURVE_BASE_RATE } from '@invest254/shared/config';
import type { Tick } from '@/lib/game/types';

interface Colors {
  up: string;
  down: string;
  border: string;
  muted: string;
  axis: string;
  accent: string;
  secondary: string;
}

function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement);
  const g = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    up: g('--pp-up', '#16C784'),
    down: g('--pp-down', '#EA3943'),
    border: g('--pp-border', '#2A323D'),
    muted: g('--pp-muted', '#8B97A7'),
    axis: g('--pp-muted', '#8B97A7'),
    accent: g('--pp-accent', '#00D395'),
    // MARKETER "below the divider" tone: an explicit per-brand token (--pp-secondary) when set, else a
    // neutral slate-indigo. Deliberately NOT signal red, so the divider stays legible without the
    // trading green/red colour tell. (--pp-info is avoided: some brands set it equal to the accent.)
    secondary: g('--pp-secondary', '#8A93C2'),
  };
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(h)) return hex;
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

type Pt = [number, number];

// Catmull-Rom control-point tension. Smaller = tighter/sharper peaks (was 1/6).
const SMOOTH = 0.085;

function smoothPath(ctx: CanvasRenderingContext2D, p: Pt[]): void {
  const first = p[0];
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (let i = 0; i < p.length - 1; i++) {
    const p1 = p[i];
    const p2 = p[i + 1];
    if (!p1 || !p2) continue;
    const p0 = p[i - 1] ?? p1;
    const p3 = p[i + 2] ?? p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) * SMOOTH;
    const cp1y = p1[1] + (p2[1] - p0[1]) * SMOOTH;
    const cp2x = p2[0] - (p3[0] - p1[0]) * SMOOTH;
    const cp2y = p2[1] - (p3[1] - p1[1]) * SMOOTH;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
  }
}

// Signed display value ∈ (-1, 1): the curve's tanh signal recovered from `rate`.
const toValue = (rate: number) => (rate - CURVE_BASE_RATE) / CURVE_AMPLITUDE;
// Tight symmetric vertical scale so waves fill the canvas (taller); ±1 spikes clip a touch.
const Y_MAX = 0.9;
// y-axis calibration lines/labels at 0.2 intervals.
const AXIS_TICKS = [-0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8];

export function CurveCanvas({
  getTicks,
  getLastTick,
  windowMs,
  marketer = false,
}: {
  getTicks: () => Tick[];
  getLastTick: () => Tick | null;
  windowMs: number;
  /** MARKETER: render a neutral single-colour wave — no price axis/grid/labels and no red/green
   *  up-down split — so the motion reads as a game visual, not a trading chart (TikTok Phase 2). */
  marketer?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const windowRef = useRef(windowMs);
  windowRef.current = windowMs;
  const marketerRef = useRef(marketer);
  marketerRef.current = marketer;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let colors = readColors();
    let seenT = 0;
    let seenPerf = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      cssW = r.width;
      cssH = r.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const mo = new MutationObserver(() => {
      colors = readColors();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const PAD_Y = 12;
    // gutter so the curve never paints over the y-axis labels; marketers have no axis, so no gutter.
    const PAD_LEFT = marketer ? 8 : 30;

    // Vertical geometry for the fixed ±Y_MAX scale; 0 sits dead-centre.
    const geom = () => {
      const usableH = Math.max(1, cssH - 2 * PAD_Y);
      const Y = (v: number) => {
        const c = Math.max(-Y_MAX, Math.min(Y_MAX, v));
        return PAD_Y + usableH * ((Y_MAX - c) / (2 * Y_MAX));
      };
      return { Y, y0: PAD_Y + usableH * 0.5 };
    };

    // MARKETER: a single centre DIVIDER — the reference line the wave rises above (accent) or dips
    // below (neutral). No numeric labels, no calibration grid: a game guide line, not a price axis.
    const drawDivider = (Y: (v: number) => number) => {
      const y = Y(0);
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = hexA(colors.muted, 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(cssW, y);
      ctx.stroke();
      ctx.restore();
    };

    // y-axis calibration grid (0.2 steps) + labels; the 0-axis is emphasised.
    const drawAxis = (Y: (v: number) => number) => {
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const v of AXIS_TICKS) {
        const y = Y(v);
        const zero = v === 0;
        ctx.strokeStyle = hexA(colors.axis, zero ? 0.5 : 0.13);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD_LEFT, y);
        ctx.lineTo(cssW, y);
        ctx.stroke();
        ctx.fillStyle = hexA(colors.muted, zero ? 0.95 : 0.55);
        ctx.fillText(v.toFixed(1), PAD_LEFT - 5, y);
      }
    };

    const drawEmpty = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      const { Y, y0 } = geom();
      if (marketerRef.current) drawDivider(Y); else drawAxis(Y);   // MARKETER: just the centre divider
      ctx.fillStyle = colors.muted;
      ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(marketerRef.current ? 'Loading…' : 'Waiting for live ticks…', cssW / 2, y0 - 8);
    };

    const render = () => {
      const w = windowRef.current;
      const last = getLastTick();
      if (last && last.t !== seenT) {
        seenT = last.t;
        seenPerf = performance.now();
      }
      const rightEdge = last ? last.t + (reduce ? 0 : performance.now() - seenPerf) : Date.now();
      const start = rightEdge - w;

      const all = getTicks();
      let pts: Tick[] = [];
      for (let i = 0; i < all.length; i++) {
        const t = all[i]!;
        if (t.t >= start) pts.push(t);
      }
      if (pts.length < 2) {
        drawEmpty();
        return;
      }
      // decimate for very dense windows
      if (pts.length > 800) {
        const step = Math.ceil(pts.length / 800);
        const ds: Tick[] = [];
        for (let i = 0; i < pts.length; i += step) ds.push(pts[i]!);
        const tail = pts[pts.length - 1]!;
        if (ds[ds.length - 1] !== tail) ds.push(tail);
        pts = ds;
      }

      const { Y, y0 } = geom();
      const X = (t: number) => PAD_LEFT + ((t - start) / w) * (cssW - PAD_LEFT);
      // MARKETER: two-tone around the centre divider — brand accent above, a contrasting neutral below.
      // Keeps the "above vs below" legibility a viewer needs, without the trading green/red colour pair.
      const mk = marketerRef.current;
      const upC = mk ? colors.accent : colors.up;
      const dnC = mk ? colors.secondary : colors.down;

      const last2 = pts[pts.length - 1]!;
      const coords: Pt[] = pts.map((p) => [X(p.t), Y(toValue(p.rate))]);
      coords.push([cssW, Y(toValue(last2.rate))]); // hold the line to the live right edge

      const firstX = coords[0]![0];
      const lastX = coords[coords.length - 1]![0];

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      // Behind the curve: the calibration grid for players, just the centre divider for marketers.
      if (mk) drawDivider(Y); else drawAxis(Y);

      // Closed area between the curve and the 0-axis (filled twice, clipped per side).
      const buildArea = () => {
        ctx.beginPath();
        smoothPath(ctx, coords);
        ctx.lineTo(lastX, y0);
        ctx.lineTo(firstX, y0);
        ctx.closePath();
      };

      // ── Above 0 → green (clip to the region above the axis) ──
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cssW, y0);
      ctx.clip();
      buildArea();
      const gUp = ctx.createLinearGradient(0, PAD_Y, 0, y0);
      gUp.addColorStop(0, hexA(upC, 0.34));
      gUp.addColorStop(1, hexA(upC, 0));
      ctx.fillStyle = gUp;
      ctx.fill();
      ctx.beginPath();
      smoothPath(ctx, coords);
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = upC;
      ctx.shadowColor = upC;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();

      // ── Below 0 → red (clip to the region below the axis) ──
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y0, cssW, Math.max(1, cssH - y0));
      ctx.clip();
      buildArea();
      const gDn = ctx.createLinearGradient(0, y0, 0, cssH - PAD_Y);
      gDn.addColorStop(0, hexA(dnC, 0));
      gDn.addColorStop(1, hexA(dnC, 0.34));
      ctx.fillStyle = gDn;
      ctx.fill();
      ctx.beginPath();
      smoothPath(ctx, coords);
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = dnC;
      ctx.shadowColor = dnC;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();

      // 0-axis + labels on top of the fill (MARKETER: just the divider, redrawn so the wave doesn't bury it).
      if (mk) drawDivider(Y); else drawAxis(Y);

      // Live dot, coloured by the current side (accent above the divider, neutral below for marketers).
      const lastV = toValue(last2.rate);
      const ly = Y(lastV);
      ctx.beginPath();
      ctx.arc(cssW - 2, ly, 3, 0, Math.PI * 2);
      ctx.fillStyle = lastV >= 0 ? upC : dnC;
      ctx.fill();
    };

    let raf = 0;
    let interval: ReturnType<typeof setInterval> | null = null;
    if (reduce) {
      interval = setInterval(render, 250);
      render();
    } else {
      const loop = () => {
        render();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (interval) clearInterval(interval);
      ro.disconnect();
      mo.disconnect();
    };
  }, [getTicks, getLastTick]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-label={marketer ? 'Live game motion' : 'Live price curve'} role="img" />;
}
