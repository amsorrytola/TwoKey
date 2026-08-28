"use client";

import { Lane, RiskVector, laneColor, laneLabel, statusColor } from "@/lib/api";

/* ── lane chip ─────────────────────────────────────────────────────────────
   Every lane carries a GLYPH as well as a colour and a word, so the interface
   still reads under deuteranopia, in greyscale, and on a washed-out projector. */
export const laneGlyph: Record<Lane, string> = {
  AUTO: "\u203A",      // ›  runs straight through
  EDIT: "\u2298",      // ⊘  repaired in flight
  TWO_KEY: "\u2016",   // ‖  two keys must turn
  HUMAN: "\u25B3",     // △  raised to a person
  BLOCK: "\u2715",     // ✕  fail-closed
};

export function LaneChip({ lane, dim = false }: { lane: Lane; dim?: boolean }) {
  const c = laneColor[lane];
  return (
    <span className="chip" style={{ color: c, opacity: dim ? 0.55 : 1, background: `${c}12` }}
          title={laneLabel[lane]}>
      <span className="chip-glyph">{laneGlyph[lane]}</span>
      {laneLabel[lane]}
    </span>
  );
}

/* ── section label ─────────────────────────────────────────────────────── */
export function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`label ${className}`}>{children}</div>;
}

export function Panel({
  title, right, children, className = "", pad = true,
}: {
  title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`panel flex flex-col min-h-0 ${className}`}>
      {title && (
        <header className="flex items-center justify-between px-3 h-8 border-b shrink-0"
                style={{ borderColor: "var(--rule)" }}>
          <Label>{title}</Label>
          {right}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${pad ? "p-3" : ""} overflow-auto`}>{children}</div>
    </section>
  );
}

/* ── 4-bar risk sparkline for dense rows ───────────────────────────────── */
const AXES: (keyof RiskVector)[] = ["hallucination", "privacy", "bias", "blast_radius"];
const AXIS_SHORT = { hallucination: "H", privacy: "P", bias: "B", blast_radius: "R" } as const;

export function RiskBars({ v, h = 16 }: { v: RiskVector; h?: number }) {
  if (!v) return null;
  return (
    <span className="inline-flex items-end gap-[2px]" style={{ height: h }} title={
      AXES.map((a) => `${a} ${(v[a] ?? 0).toFixed(2)}`).join("  ")
    }>
      {AXES.map((a) => {
        const val = v[a] ?? 0;
        const col = val >= 0.65 ? "var(--fail)" : val >= 0.35 ? "var(--warn)" : "var(--ink3)";
        return (
          <span key={a} style={{ width: 3, height: Math.max(2, val * h), background: col, display: "block" }} />
        );
      })}
    </span>
  );
}

/* ── risk radar: the 4 axes the brief says overlap in practice ─────────── */
export function RiskRadar({ v, size = 168 }: { v: RiskVector; size?: number }) {
  if (!v) return null;
  const cx = size / 2, cy = size / 2, R = size / 2 - 26;
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 4;
    return [cx + Math.cos(a) * R * r, cy + Math.sin(a) * R * r];
  };
  const poly = AXES.map((a, i) => pt(i, Math.max(0.02, v[a] ?? 0)).join(",")).join(" ");
  const peak = Math.max(...AXES.map((a) => v[a] ?? 0));
  const col = peak >= 0.65 ? "var(--fail)" : peak >= 0.35 ? "var(--warn)" : "var(--pass)";
  return (
    <svg width={size} height={size} role="img" aria-label="risk vector">
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <polygon key={r} points={AXES.map((_, i) => pt(i, r).join(",")).join(" ")}
                 fill="none" stroke="var(--rule)" strokeWidth={1} />
      ))}
      {AXES.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--rule)" strokeWidth={1} />;
      })}
      <polygon points={poly} fill={col} fillOpacity={0.1} stroke={col} strokeWidth={1.5} />
      {AXES.map((a, i) => {
        const [x, y] = pt(i, 1.28);
        return (
          <text key={a} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
                className="mono" fontSize={9} fill="var(--ink3)" letterSpacing="0.06em">
            {AXIS_SHORT[a]} {(v[a] ?? 0).toFixed(2)}
          </text>
        );
      })}
    </svg>
  );
}

/* ── risk scale with the policy thresholds drawn on it ─────────────────── */
export function RiskScale({
  score, thresholds, height = 6,
}: { score: number; thresholds?: Record<string, number>; height?: number }) {
  const marks = thresholds
    ? [
        { at: thresholds.auto_max, c: laneColor.AUTO },
        { at: thresholds.edit_max, c: laneColor.EDIT },
        { at: thresholds.two_key_max, c: laneColor.TWO_KEY },
        { at: thresholds.human_max, c: laneColor.HUMAN },
      ].filter((m) => typeof m.at === "number")
    : [];
  return (
    <div className="relative w-full" style={{ height }}>
      <div className="absolute inset-0" style={{ background: "var(--rule-soft)" }} />
      <div className="absolute top-0 bottom-0 left-0"
           style={{ width: `${Math.min(100, score * 100)}%`, background: "var(--ink3)" }} />
      {marks.map((m, i) => (
        <div key={i} className="absolute top-0 bottom-0"
             style={{ left: `${m.at * 100}%`, width: 1, background: m.c }} />
      ))}
    </div>
  );
}

/* ── check status dot ──────────────────────────────────────────────────── */
export function Dot({ status, size = 6 }: { status: string; size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: 1, display: "inline-block",
      background: statusColor[status] ?? "var(--ink3)",
    }} />
  );
}

export function Bit({ k, v, mono = false }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="label shrink-0">{k}</span>
      <span className={`text-right ${mono ? "mono" : ""}`} style={{ fontSize: 12 }}>{v}</span>
    </div>
  );
}
