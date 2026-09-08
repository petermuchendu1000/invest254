'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { DigitHeatmap } from '@/components/game/digits/DigitHeatmap';
import { MultipliersPanel } from '@/components/game/digits/MultipliersPanel';
import { DerivChart } from '@/components/game/digits/DerivChart';
import { VolatilitySelector } from '@/components/game/digits/VolatilitySelector';
import { useGameSocket, type DigitSettledData } from '@/lib/game/GameSocketProvider';
import { instrumentById, DEFAULT_INSTRUMENT_ID, type Instrument } from '@/lib/game/instruments';
import { useDisplayMoney } from '@/lib/money';
import { useWallet } from '@/lib/wallet/hooks';
import { useSession } from '@/lib/auth/session';
import { useDepositUi } from '@/lib/wallet/depositUi';

// ── Contract model ───────────────────────────────────────────────────────────────────────────────
const MARKETS = [
  { id: 'matchesdiffers', label: 'Matches/Differs' },
  { id: 'evenodd', label: 'Even/Odd' },
  { id: 'overunder', label: 'Over/Under' },
] as const;
type Market = (typeof MARKETS)[number]['id'];
type TradeType = 'digits' | 'multipliers';
type Outcome = 'even' | 'odd' | 'over' | 'under' | 'matches' | 'differs';

// Chart timeframe / zoom presets (1T = default). barSpacing = pixels per bar on the time scale.
const TIMEFRAMES = [
  { label: '1T', barSpacing: 7 },
  { label: '2T', barSpacing: 11 },
  { label: '5T', barSpacing: 16 },
  { label: '10T', barSpacing: 24 },
] as const;

// Display-only payout factor, mirroring the engine's DIGIT default (shared `digitPayoutFactor`,
// 0.95 ⇒ 5% edge). The ENGINE is authoritative for the actual payout; this only renders the CTA
// "return" and "% payout". Kept a local literal so the client bundle never pulls node:crypto via
// the shared barrel. return = stake × factor / winProb.
const PAYOUT_FACTOR = 0.95;
const WINDOW = 120; // ticks used for the digit-frequency heatmap

const lastDigitOf = (rate: number) => (((Math.round(rate * 100) % 10) + 10) % 10);

function winProbability(outcome: Outcome, barrier: number): number {
  switch (outcome) {
    case 'even':
    case 'odd':
      return 0.5;
    case 'over':
      return (9 - barrier) / 10;
    case 'under':
      return barrier / 10;
    case 'matches':
      return 0.1;
    case 'differs':
      return 0.9;
  }
  return 0;
}

const outcomesFor = (m: Market): [{ key: Outcome; label: string }, { key: Outcome; label: string }] =>
  m === 'evenodd'
    ? [{ key: 'even', label: 'Even' }, { key: 'odd', label: 'Odd' }]
    : m === 'overunder'
      ? [{ key: 'over', label: 'Over' }, { key: 'under', label: 'Under' }]
      : [{ key: 'matches', label: 'Matches' }, { key: 'differs', label: 'Differs' }];

type Pending = { stakeCents: number; outcome: Outcome };
type Result = { id: number; won: boolean; delta: number; label: string };

/** Deriv-style binary/digits trade surface — trades REAL contracts against the authoritative engine. */
export function DigitsTradeScreen() {
  const [instId, setInstId] = useState<string>(DEFAULT_INSTRUMENT_ID);
  const instrument: Instrument = instrumentById(instId);
  const { getInstrumentTicks, getLastInstrumentTick, instrumentResetKey, subscribeInstrument, openDigit, onDigitSettled } = useGameSocket();
  const { fmt, symbol, isForeign, toKesCents } = useDisplayMoney();
  const token = useSession((s) => s.token);
  const openDeposit = useDepositUi((s) => s.openDeposit);
  const { data: wallet } = useWallet();
  const spendable = (wallet?.real ?? 0) + (wallet?.bonus ?? 0);

  const [market, setMarket] = useState<Market>('evenodd');
  const [tradeType, setTradeType] = useState<TradeType>('digits');
  const [mode, setMode] = useState<'auto' | 'manual'>('manual');
  const [barrier, setBarrier] = useState(5); // Over/Under
  const [pick, setPick] = useState(0); // Matches/Differs

  // Chart toolbar UI state (presentational): timeframe/zoom, Historical View pause, 1T menu.
  const [tf, setTf] = useState<(typeof TIMEFRAMES)[number]>(TIMEFRAMES[0]);
  const [tfOpen, setTfOpen] = useState(false);
  const [historical, setHistorical] = useState(false);
  const tfRef = useRef<HTMLDivElement | null>(null);

  const presets = useMemo(() => (isForeign ? [1, 5, 10, 25, 50, 100] : [50, 100, 200, 500, 1000, 5000]), [isForeign]);
  const step = isForeign ? 1 : 50;
  const [stake, setStake] = useState<string>(String(isForeign ? 10 : 200));
  const stakeCents = useMemo(() => {
    const n = Number.parseFloat(stake);
    return Number.isFinite(n) && n > 0 ? toKesCents(n) : 0;
  }, [stake, toKesCents]);

  // AUTO-bot params (display-currency units for money, plain number for the multiplier).
  const [targetProfit, setTargetProfit] = useState(isForeign ? '20' : '2000');
  const [stopLoss, setStopLoss] = useState(isForeign ? '10' : '1000');
  const [multiplier, setMultiplier] = useState('2');

  // Session state (authoritative — driven by server digit_settled events).
  const [pnl, setPnl] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [flash, setFlash] = useState<{ won: boolean; delta: number } | null>(null);
  const [running, setRunning] = useState(false);

  const [snap, setSnap] = useState<{ price: number; digit: number | null; changePct: number; freqs: number[] }>({
    price: 0,
    digit: null,
    changePct: 0,
    freqs: Array<number>(10).fill(0),
  });

  const pendingRef = useRef<Pending | null>(null);
  const runningRef = useRef(false);
  runningRef.current = running;
  const lossStreakRef = useRef(0);
  const autoOutcomeRef = useRef<Outcome>('even');
  const idRef = useRef(0);
  const pnlRef = useRef(0);
  pnlRef.current = pnl;

  const totalReturnCents = useCallback(
    (cents: number, outcome: Outcome) => Math.round((cents * PAYOUT_FACTOR) / winProbability(outcome, barrier)),
    [barrier],
  );

  // Subscribe the socket to the selected instrument's authoritative feed (re-subscribes on change).
  useEffect(() => { subscribeInstrument(instId); }, [instId, subscribeInstrument]);

  // Close the timeframe menu on outside click.
  useEffect(() => {
    if (!tfOpen) return;
    const onDoc = (e: MouseEvent) => { if (tfRef.current && !tfRef.current.contains(e.target as Node)) setTfOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [tfOpen]);

  // Resolve settlements authoritatively from the engine (single in-flight contract at a time).
  useEffect(() => {
    const off = onDigitSettled((s: DigitSettledData) => {
      const p = pendingRef.current;
      pendingRef.current = null;
      const won = s.won;
      const delta = s.pnlCents; // authoritative P/L in cents
      lossStreakRef.current = won ? 0 : lossStreakRef.current + 1;
      setPnl((x) => x + delta);
      setFlash({ won, delta });
      idRef.current += 1;
      const label = `${(p?.outcome ?? '').toString().toUpperCase()} · ${s.digit}`;
      setResults((r) => [{ id: idRef.current, won, delta, label }, ...r].slice(0, 8));
      window.setTimeout(() => setFlash(null), 900);
    });
    return off;
  }, [onDigitSettled]);

  const place = useCallback(
    (outcome: Outcome, cents: number): boolean => {
      if (!Number.isFinite(cents) || cents <= 0) return false;
      if (pendingRef.current) return false; // one contract in flight at a time
      if (!token || cents > spendable) {
        openDeposit({ amountCents: cents });
        return false;
      }
      if (winProbability(outcome, barrier) <= 0) return false;
      const target = outcome === 'over' || outcome === 'under' ? barrier : outcome === 'matches' || outcome === 'differs' ? pick : 0;
      pendingRef.current = { stakeCents: cents, outcome };
      openDigit({ instrumentId: instId, kind: outcome, target, stakeCents: cents });
      return true;
    },
    [token, spendable, openDeposit, barrier, pick, instId, openDigit],
  );

  // Live snapshot (price / current digit / change% / heatmap) + AUTO-bot loop, off the tick stream.
  useEffect(() => {
    const id = window.setInterval(() => {
      const ticks = getInstrumentTicks();
      const n = ticks.length;
      if (n === 0) return;
      const last = ticks[n - 1]!;
      const digit = lastDigitOf(last.rate);
      const firstIdx = Math.max(0, n - 60);
      const first = ticks[firstIdx]!;
      const changePct = first.rate ? ((last.rate - first.rate) / first.rate) * 100 : 0;
      const win = Math.min(n, WINDOW);
      const counts = Array<number>(10).fill(0);
      for (let i = n - win; i < n; i++) { const dd = lastDigitOf(ticks[i]!.rate); counts[dd] = (counts[dd] ?? 0) + 1; }
      const freqs = counts.map((c) => (c / win) * 100);
      setSnap({ price: last.rate, digit, changePct, freqs });

      // AUTO bot: keep placing on the chosen outcome (martingale on loss) until target/stop.
      if (runningRef.current && !pendingRef.current) {
        const targetCents = toKesCents(Number.parseFloat(targetProfit) || 0);
        const stopCents = toKesCents(Number.parseFloat(stopLoss) || 0);
        if ((targetCents > 0 && pnlRef.current >= targetCents) || (stopCents > 0 && pnlRef.current <= -stopCents)) {
          setRunning(false);
          return;
        }
        const mult = Math.max(1, Number.parseFloat(multiplier) || 1);
        const base = stakeCents;
        const next = Math.min(Math.round(base * Math.pow(mult, lossStreakRef.current)), spendable || base);
        place(autoOutcomeRef.current, next);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [getInstrumentTicks, place, stakeCents, spendable, multiplier, targetProfit, stopLoss, toKesCents]);

  const [primary, secondary] = outcomesFor(market);
  const isMultipliers = tradeType === 'multipliers';
  const needsDigit = !isMultipliers && market !== 'evenodd';
  const selectorValue = market === 'overunder' ? barrier : pick;
  const onSelectDigit = (d: number) => (market === 'overunder' ? setBarrier(d) : setPick(d));

  // Live "share" stat for the chart badge: the probability-weighted frequency of the selected side
  // across the recent tick window (even-share for Even/Odd, over-share for Over/Under, the picked
  // digit's frequency for Matches/Differs). Purely a live read of `snap.freqs`.
  const sharePct = useMemo(() => {
    const f = snap.freqs;
    if (market === 'evenodd') return f.reduce((a, v, i) => a + (i % 2 === 0 ? v : 0), 0);
    if (market === 'overunder') return f.reduce((a, v, i) => a + (i > barrier ? v : 0), 0);
    return f[pick] ?? 0;
  }, [snap.freqs, market, barrier, pick]);
  const shareLabel =
    market === 'evenodd' ? 'Even share' : market === 'overunder' ? `Over ${barrier} share` : `Digit ${pick} share`;

  const stepStake = (dir: 1 | -1) => {
    const n = Math.max(0, (Number.parseFloat(stake) || 0) + dir * step);
    setStake(isForeign ? String(Math.round(n * 100) / 100) : String(Math.round(n)));
  };

  const onCta = (outcome: Outcome) => {
    if (mode === 'auto') {
      if (running) {
        setRunning(false);
        return;
      }
      autoOutcomeRef.current = outcome;
      lossStreakRef.current = 0;
      setRunning(true);
      return;
    }
    place(outcome, stakeCents);
  };

  const ctaMeta = (o: Outcome) => {
    const prob = winProbability(o, barrier);
    const disabled = prob <= 0;
    const profitPct = prob > 0 ? (PAYOUT_FACTOR / prob - 1) * 100 : 0;
    const ret = prob > 0 ? totalReturnCents(stakeCents, o) : 0;
    return { disabled, profitPct, ret };
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 p-0.5 sm:gap-2">
      {/* Trade type — Digits vs Multipliers (kept reachable as a slim switch; Multipliers is its own
          trade type, not a digit sub-market). */}
      <div className="flex justify-center">
        <div className="flex rounded-lg border border-border bg-surface-2 p-0.5">
          {(['digits', 'multipliers'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTradeType(t); if (running) setRunning(false); }}
              className={cn(
                'rounded-md px-4 py-1 text-[12px] font-semibold capitalize transition',
                tradeType === t ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Market tabs (Digits only) — Matches/Differs · Even/Odd · Over/Under */}
      {!isMultipliers ? (
        <div className="flex items-center gap-1.5 xs:gap-2">
          {MARKETS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => { setMarket(m.id); if (running) setRunning(false); }}
              className={cn(
                'min-w-0 flex-1 truncate rounded-full border px-1.5 py-1.5 text-[clamp(11px,3.4vw,14px)] font-semibold transition',
                market === m.id
                  ? 'border-accent/55 bg-accent/15 text-fg shadow-[0_0_16px_-6px_var(--pp-accent)]'
                  : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Chart card — toolbar (1T · instrument · Historical View · live share) + Deriv-style chart */}
      <div className="relative flex min-h-[124px] flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-1.5 p-2 pb-1">
          {/* 1T timeframe / zoom */}
          <div ref={tfRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setTfOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={tfOpen}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-[13px] font-bold text-accent transition hover:border-accent/60"
            >
              {tf.label}
            </button>
            {tfOpen ? (
              <div role="listbox" className="absolute left-0 top-[calc(100%+6px)] z-30 w-28 rounded-lg border border-border bg-surface-2 p-1 shadow-2xl">
                {TIMEFRAMES.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    role="option"
                    aria-selected={o.label === tf.label}
                    onClick={() => { setTf(o); setTfOpen(false); }}
                    className={cn(
                      'block w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold transition',
                      o.label === tf.label ? 'bg-accent/15 text-fg' : 'text-muted hover:text-fg',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Instrument dropdown (wide toolbar variant) */}
          <div className="min-w-0 flex-1">
            <VolatilitySelector
              wide
              instrument={instrument}
              price={snap.price || null}
              changePct={snap.changePct}
              onSelect={(i) => { setInstId(i.id); if (running) setRunning(false); }}
            />
          </div>

          {/* Historical View — freeze auto-follow and scroll back through buffered ticks */}
          <button
            type="button"
            onClick={() => setHistorical((v) => !v)}
            aria-pressed={historical}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-[13px] font-bold text-white transition',
              historical ? 'bg-down ring-2 ring-down/40' : 'bg-down/90 hover:bg-down',
            )}
          >
            Historical View
          </button>

          {/* Live share badge (market-aware) */}
          <span
            title={`${shareLabel} over last ${WINDOW} ticks`}
            className="shrink-0 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[12.5px] font-bold tabular-nums text-fg"
          >
            {Math.round(sharePct)}%
          </span>
        </div>

        <div className="relative min-h-0 flex-1">
          <DerivChart
            getTicks={getInstrumentTicks}
            getLastTick={getLastInstrumentTick}
            resetKey={instrumentResetKey}
            paused={historical}
            barSpacing={tf.barSpacing}
          />
          {historical ? (
            <span className="pointer-events-none absolute left-2 top-2 z-20 rounded-md bg-down/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Historical
            </span>
          ) : null}
          {flash ? (
            <div
              className={cn(
                'pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit rounded-full px-3.5 py-1 text-[13px] font-bold shadow-lg',
                flash.won ? 'bg-up text-white' : 'bg-down text-white',
              )}
            >
              {flash.won ? 'WON ' : 'LOST '}
              {flash.won ? '+' : ''}{fmt(flash.delta)}
            </div>
          ) : null}
        </div>
      </div>

      {/* Digit row (Digits only) — also the picker for Matches/Differs & Over/Under */}
      {!isMultipliers ? (
        <>
          <DigitHeatmap
            freqs={snap.freqs}
            current={snap.digit}
            selected={needsDigit ? selectorValue : null}
            selectable={needsDigit}
            onSelect={onSelectDigit}
          />
          {needsDigit ? (
            <p className="-mt-1 text-center text-[11px] text-muted">
              {market === 'overunder' ? 'Barrier digit' : 'Prediction digit'}: <span className="font-semibold text-fg">{selectorValue}</span> — tap a digit to change
            </p>
          ) : null}
        </>
      ) : null}

      {/* Console */}
      <div className="flex min-h-0 flex-col gap-1.5">
        {isMultipliers ? (
          <MultipliersPanel getLastTick={getLastInstrumentTick} resetKey={instrumentResetKey} instrumentId={instId} />
        ) : (
          <>
            {/* AUTO / MANUAL */}
            <div className="flex rounded-xl border border-border bg-surface p-1">
              {(['auto', 'manual'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); if (running) setRunning(false); }}
                  className={cn(
                    'flex-1 rounded-lg py-2 text-[15px] font-extrabold uppercase tracking-wide transition',
                    mode === m ? 'bg-accent text-accent-fg shadow-[0_2px_16px_-4px_var(--pp-accent)]' : 'text-muted hover:text-fg',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Stake stepper */}
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => stepStake(-1)} aria-label="Decrease stake"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface text-2xl font-light text-muted transition hover:border-accent/60 hover:text-fg">−</button>
              <div className="flex-1 text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Stake</div>
                <div className="flex items-baseline justify-center gap-1.5">
                  <span className="text-base font-bold text-muted">{symbol}</span>
                  <input
                    inputMode="decimal"
                    value={stake}
                    onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
                    aria-label="Stake amount"
                    className="w-28 bg-transparent text-center text-[22px] font-extrabold tabular-nums text-fg outline-none"
                  />
                </div>
              </div>
              <button type="button" onClick={() => stepStake(1)} aria-label="Increase stake"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface text-2xl font-light text-muted transition hover:border-accent/60 hover:text-fg">+</button>
            </div>

            {/* Presets */}
            <div className="grid grid-cols-6 gap-1.5 xs:gap-2">
              {presets.map((q) => {
                const active = Number(stake) === q;
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setStake(String(q))}
                    className={cn(
                      'rounded-lg border py-1.5 text-[clamp(11px,3vw,13px)] font-semibold tabular-nums transition',
                      active ? 'border-accent/55 bg-accent/15 text-fg' : 'border-border bg-surface-2 text-muted hover:text-fg',
                    )}
                  >
                    {isForeign ? `${symbol}${q}` : q >= 1000 ? `${q / 1000}k` : q}
                  </button>
                );
              })}
            </div>

            {/* AUTO-bot params (bot controls — only meaningful in AUTO mode) */}
            {mode === 'auto' ? (
              <div className="grid grid-cols-3 gap-2">
                <BotField icon="target" label="Target" prefix={symbol} value={targetProfit} onChange={setTargetProfit} tone="up" />
                <BotField icon="stop" label="Stop loss" prefix={symbol} value={stopLoss} onChange={setStopLoss} tone="down" />
                <BotField icon="mult" label="Mult" prefix="×" value={multiplier} onChange={setMultiplier} />
              </div>
            ) : null}

            {/* Dual payout CTAs */}
            <div className="grid grid-cols-2 gap-3">
              {[primary, secondary].map((o, i) => {
                const meta = ctaMeta(o.key);
                const isUp = i === 0;
                const active = running && autoOutcomeRef.current === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    disabled={meta.disabled}
                    onClick={() => onCta(o.key)}
                    className={cn(
                      'flex items-center justify-between rounded-xl border px-4 py-2.5 text-left transition disabled:opacity-40',
                      isUp ? 'border-up/40 bg-up/15 text-up hover:bg-up/25' : 'border-down/40 bg-down/15 text-down hover:bg-down/25',
                      active ? 'ring-2 ring-white/60' : '',
                    )}
                  >
                    <div>
                      <div className="text-[17px] font-extrabold leading-tight">{mode === 'auto' && active ? 'Stop' : o.label}</div>
                      <div className="text-[11px] font-semibold tabular-nums opacity-90">{meta.profitPct.toFixed(2)}%</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[15px] font-extrabold tabular-nums">{fmt(meta.ret)}</div>
                      <div className="text-[11px] font-semibold opacity-75">Payout</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Session ledger — hidden on very short viewports (<=660px tall) so the chart + controls
                keep their space on small devices; visible everywhere else. */}
            <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-3 py-1.5 [@media(max-height:660px)]:hidden">
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>Session P/L</span>
                <span className={cn('text-sm font-bold tabular-nums', pnl >= 0 ? 'text-up' : 'text-down')}>
                  {pnl >= 0 ? '+' : ''}{fmt(pnl)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {results.slice(0, 6).map((r) => (
                  <span key={r.id} className={cn('h-2.5 w-2.5 rounded-full', r.won ? 'bg-up' : 'bg-down')} title={`${r.label} · ${r.won ? '+' : ''}${fmt(r.delta)}`} />
                ))}
                {results.length === 0 ? <span className="text-[11px] text-muted">no trades yet</span> : null}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BotFieldIcon({ kind }: { kind: 'target' | 'stop' | 'mult' }) {
  const cls = cn('h-3 w-3', kind === 'target' ? 'text-up' : kind === 'stop' ? 'text-down' : 'text-muted');
  if (kind === 'target') {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" />
      </svg>
    );
  }
  if (kind === 'stop') {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="8" /><path d="M8 12h8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3v18M3 12h18M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

function BotField({
  label,
  prefix,
  value,
  onChange,
  tone,
  icon,
}: {
  label: string;
  prefix: string;
  value: string;
  onChange: (v: string) => void;
  tone?: 'up' | 'down';
  icon: 'target' | 'stop' | 'mult';
}) {
  return (
    <label className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-3 py-2">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
        <BotFieldIcon kind={icon} />
        {label}
      </span>
      <div className="flex items-baseline gap-1">
        <span className="text-xs font-semibold text-muted">{prefix}</span>
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
          className={cn(
            'w-full bg-transparent text-base font-bold tabular-nums outline-none',
            tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-fg',
          )}
        />
      </div>
    </label>
  );
}
