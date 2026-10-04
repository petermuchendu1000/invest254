'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ANCHORS_NEEDED, fibLines, hitTest, humanDuration, measure, pitchforkLines,
  type Anchor, type Drawing, type DrawingKind, type Point, type ToolId,
} from '@/lib/chart/drawings';

/**
 * The drawing surface — what makes the chart's left rail do something.
 *
 * An SVG laid over the plot. Objects are held in CHART space (a time and a price per anchor) and
 * projected to pixels on every paint, so they stay pinned to their bars when the chart is panned or
 * zoomed. `lightweight-charts` draws series and nothing else, so all of this is ours.
 *
 * It is `pointer-events: none` whenever the cursor tool is active, which is what lets the chart keep
 * its own pan, pinch and crosshair: the overlay only takes the pointer while you are actually
 * drawing. That is the difference between a drawing layer and a layer that breaks the chart.
 */

export interface Projection {
  /** Chart time (epoch seconds) → x pixels, or null when the time is outside the visible range. */
  xOf: (time: number) => number | null;
  /** Price → y pixels, or null when the price is off the visible scale. */
  yOf: (price: number) => number | null;
  /** The inverse pair, for turning a pointer position into an anchor. */
  timeOf: (x: number) => number | null;
  priceOf: (y: number) => number | null;
  /** Seconds per bar at the current timeframe, so the measure tool can count bars. */
  barSeconds: number;
  /** Decimal places the instrument quotes, for the labels. */
  digits: number;
}

const COLORS: Record<DrawingKind, string> = {
  trend: '#4597ff',
  horizontal: '#f0b90b',
  fib: '#a78bfa',
  pitchfork: '#2dd4bf',
  text: '#ffffff',
  measure: '#41be56',
};

const newId = (): string => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function ChartDrawings({
  tool, project, drawings, onChange, onToolDone, selected, onSelect, width, height, revision,
}: {
  tool: ToolId;
  project: Projection;
  drawings: readonly Drawing[];
  onChange: (next: Drawing[]) => void;
  /** Called once an object is finished, so the rail can fall back to the cursor as MetaTrader does. */
  onToolDone: () => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  width: number;
  height: number;
  /** Bumped by the chart whenever the visible range moves, to force a re-projection. */
  revision: number;
}) {
  /** Anchors placed so far for the object being drawn. */
  const [pending, setPending] = useState<Anchor[]>([]);
  /** Where the pointer is while an object is in progress, for the rubber-band preview. */
  const [hover, setHover] = useState<Anchor | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const drawingTool = tool !== 'cursor' && tool !== 'crosshair' && tool !== 'trash' ? tool : null;

  // Changing tool abandons a half-placed object rather than finishing it with the next tool's clicks.
  useEffect(() => { setPending([]); setHover(null); }, [tool]);

  const anchorAt = useCallback((e: { clientX: number; clientY: number }): Anchor | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const time = project.timeOf(e.clientX - rect.left);
    const price = project.priceOf(e.clientY - rect.top);
    return time === null || price === null ? null : { time, price };
  }, [project]);

  const pointAt = useCallback((e: { clientX: number; clientY: number }): Point | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null;
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    // The cursor tool selects an existing object; it never creates one.
    if (!drawingTool) {
      const p = pointAt(e);
      if (p) onSelect(hitTest(p, segmentsOf(drawings, project)));
      return;
    }
    const a = anchorAt(e);
    if (!a) return;
    e.preventDefault();
    const next = [...pending, a];
    if (next.length < ANCHORS_NEEDED[drawingTool]) { setPending(next); return; }

    // Complete. Text asks for its content; everything else is finished by its anchors alone.
    let label: string | undefined;
    if (drawingTool === 'text') {
      const entered = window.prompt('Label');
      if (!entered) { setPending([]); onToolDone(); return; }
      label = entered;
    }
    onChange([...drawings, {
      id: newId(), kind: drawingTool, points: next, color: COLORS[drawingTool],
      ...(label === undefined ? {} : { label }),
    }]);
    setPending([]);
    setHover(null);
    onToolDone();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingTool || pending.length === 0) return;
    setHover(anchorAt(e));
  };

  // Escape abandons an object mid-draw; Delete removes the selected one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPending([]); setHover(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        onChange(drawings.filter((d) => d.id !== selected));
        onSelect(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, drawings, onChange, onSelect]);

  // `revision` is in the dependency list so a pan or zoom repaints every object at its new position.
  void revision;

  const preview: Drawing | null = drawingTool && pending.length > 0 && hover
    ? { id: '__preview', kind: drawingTool, points: [...pending, hover], color: COLORS[drawingTool] }
    : null;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="absolute inset-0 z-10"
      // The chart keeps pan, pinch and crosshair unless a tool is actually in use.
      style={{ pointerEvents: tool === 'cursor' || tool === 'crosshair' ? 'none' : 'auto',
               cursor: drawingTool ? 'crosshair' : 'default', touchAction: drawingTool ? 'none' : 'auto' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      aria-hidden
    >
      {/* The cursor tool must still be able to SELECT, so it gets a transparent catcher that sits
          under nothing and above nothing — enabled only while the rail is on the cursor. */}
      {tool === 'cursor' ? (
        <rect x={0} y={0} width={width} height={height} fill="transparent" style={{ pointerEvents: 'auto' }} onPointerDown={onPointerDown} />
      ) : null}
      {drawings.map((d) => <Shape key={d.id} d={d} project={project} selected={d.id === selected} />)}
      {preview ? <Shape d={preview} project={project} selected={false} preview /> : null}
      {/* Anchors already committed for the object in progress, so a three-click pitchfork shows its
          progress rather than appearing to have swallowed the first two clicks. */}
      {pending.map((p, i) => {
        const x = project.xOf(p.time), y = project.yOf(p.price);
        return x === null || y === null ? null
          : <circle key={i} cx={x} cy={y} r={3.5} fill={drawingTool ? COLORS[drawingTool] : '#fff'} />;
      })}
    </svg>
  );
}

/** Every drawing, as the line segments selection is tested against. */
function segmentsOf(drawings: readonly Drawing[], project: Projection): Array<{ id: string; a: Point; b: Point }> {
  const out: Array<{ id: string; a: Point; b: Point }> = [];
  for (const d of drawings) {
    for (const [a, b] of segmentPairs(d, project)) out.push({ id: d.id, a, b });
  }
  return out;
}

function segmentPairs(d: Drawing, project: Projection): Array<[Point, Point]> {
  const px = (an: Anchor): Point | null => {
    const x = project.xOf(an.time), y = project.yOf(an.price);
    return x === null || y === null ? null : { x, y };
  };
  const pairs: Array<[Point, Point]> = [];
  const push = (a: Anchor, b: Anchor) => { const p = px(a), q = px(b); if (p && q) pairs.push([p, q]); };

  if (d.kind === 'horizontal' || d.kind === 'text') {
    const p = px(d.points[0]!);
    // A horizontal line spans the pane, so its hit area is the whole width at that price.
    if (p) pairs.push([{ x: 0, y: p.y }, { x: 10_000, y: p.y }]);
    return pairs;
  }
  const [a, b, c] = d.points;
  if (!a || !b) return pairs;
  if (d.kind === 'trend' || d.kind === 'measure') { push(a, b); return pairs; }
  if (d.kind === 'fib') {
    for (const l of fibLines(a, b)) push({ time: a.time, price: l.price }, { time: b.time, price: l.price });
    return pairs;
  }
  if (d.kind === 'pitchfork' && c) {
    const f = pitchforkLines(a, b, c);
    for (const l of [f.median, f.upper, f.lower]) push(l.from, l.to);
  }
  return pairs;
}

function Shape({ d, project, selected, preview }: { d: Drawing; project: Projection; selected: boolean; preview?: boolean }) {
  const px = (an: Anchor): Point | null => {
    const x = project.xOf(an.time), y = project.yOf(an.price);
    return x === null || y === null ? null : { x, y };
  };
  const stroke = selected ? '#ffffff' : d.color;
  const width = selected ? 2 : 1.5;
  const dash = preview ? '4 3' : undefined;
  const common = { stroke, strokeWidth: width, fill: 'none', ...(dash ? { strokeDasharray: dash } : {}) };
  const [a, b, c] = d.points;
  if (!a) return null;
  const pa = px(a);

  if (d.kind === 'horizontal') {
    return pa ? (
      <g>
        <line x1={0} y1={pa.y} x2="100%" y2={pa.y} {...common} />
        <text x={6} y={pa.y - 5} fill={stroke} fontSize={10} fontFamily="monospace">{a.price.toFixed(project.digits)}</text>
      </g>
    ) : null;
  }
  if (d.kind === 'text') {
    return pa ? <text x={pa.x} y={pa.y} fill={stroke} fontSize={12} fontWeight={600}>{d.label ?? ''}</text> : null;
  }
  if (!b) return null;
  const pb = px(b);

  if (d.kind === 'trend') return pa && pb ? <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} {...common} /> : null;

  if (d.kind === 'measure' && pa && pb) {
    const m = measure(a, b, project.barSeconds);
    const tone = m.up ? '#41be56' : '#f23645';
    const bars = m.bars === null ? '' : ` · ${m.bars} bars`;
    return (
      <g>
        <rect x={Math.min(pa.x, pb.x)} y={Math.min(pa.y, pb.y)} width={Math.abs(pb.x - pa.x)} height={Math.abs(pb.y - pa.y)}
              fill={tone} fillOpacity={0.12} stroke={tone} strokeWidth={1} />
        <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={tone} strokeWidth={1.5} />
        <text x={(pa.x + pb.x) / 2} y={Math.min(pa.y, pb.y) - 6} fill={tone} fontSize={11} fontFamily="monospace" textAnchor="middle">
          {`${m.delta >= 0 ? '+' : ''}${m.delta.toFixed(project.digits)} (${m.percent.toFixed(2)}%) · ${humanDuration(m.seconds)}${bars}`}
        </text>
      </g>
    );
  }

  if (d.kind === 'fib' && pa && pb) {
    const left = Math.min(pa.x, pb.x), right = Math.max(pa.x, pb.x);
    return (
      <g>
        {fibLines(a, b).map((l) => {
          const y = project.yOf(l.price);
          if (y === null) return null;
          return (
            <g key={l.ratio}>
              <line x1={left} y1={y} x2={right} y2={y} stroke={stroke} strokeWidth={l.ratio === 0 || l.ratio === 1 ? 1.5 : 1}
                    strokeDasharray={l.ratio === 0 || l.ratio === 1 ? undefined : '3 3'} />
              <text x={right + 4} y={y + 3} fill={stroke} fontSize={9} fontFamily="monospace">
                {`${l.label} ${l.price.toFixed(project.digits)}`}
              </text>
            </g>
          );
        })}
      </g>
    );
  }

  if (d.kind === 'pitchfork' && c) {
    const f = pitchforkLines(a, b, c);
    return (
      <g>
        {[f.median, f.upper, f.lower].map((l, i) => {
          const p = px(l.from), q = px(l.to);
          return p && q ? <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} {...common} strokeWidth={i === 0 ? width + 0.5 : width} /> : null;
        })}
      </g>
    );
  }
  return null;
}
