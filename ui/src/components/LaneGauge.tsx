"use client";

import { Lane, LANES, laneColor, laneLabel } from "@/lib/api";

/** Where autonomy actually sits right now. One bar, five segments, real counts. */
export function LaneGauge({ counts, total }: { counts: Record<string, number>; total: number }) {
  const n = total || 1;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2 w-full" style={{ background: "var(--rule-soft)" }}>
        {LANES.map((l) => {
          const c = counts?.[l] ?? 0;
          if (!c) return null;
          return <div key={l} style={{ width: `${(c / n) * 100}%`, background: laneColor[l] }} title={`${laneLabel[l]} ${c}`} />;
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {LANES.map((l) => {
          const c = counts?.[l] ?? 0;
          return (
            <span key={l} className="flex items-baseline gap-1.5" style={{ opacity: c ? 1 : 0.35 }}>
              <span style={{ width: 6, height: 6, background: laneColor[l], display: "inline-block" }} />
              <span className="label" style={{ color: "var(--ink-2)" }}>{laneLabel[l]}</span>
              <span className="mono" style={{ fontSize: 11 }}>{c}</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                {total ? `${Math.round((c / n) * 100)}%` : "—"}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
