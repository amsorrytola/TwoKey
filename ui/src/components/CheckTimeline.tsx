"use client";

import { Check, fmtMs, statusColor } from "@/lib/api";
import { Dot } from "./primitives";

/**
 * The signature view: six checks drawn as PARALLEL lanes on a real millisecond axis.
 * The point the brief asks us to prove — that governance runs concurrently rather than
 * serially — is visible here rather than asserted.
 */
export function CheckTimeline({
  checks, agentMs, onSelect, selected,
}: {
  checks: Check[]; agentMs: number;
  onSelect?: (c: Check) => void; selected?: string;
}) {
  if (!checks?.length) return null;
  const meshEnd = Math.max(...checks.map((c) => c.ended_ms), 1);
  const total = agentMs + meshEnd;
  const pct = (ms: number) => (ms / total) * 100;
  const ticks = 4;

  return (
    <div className="w-full">
      {/* axis */}
      <div className="relative h-4 mb-1">
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const ms = (total / ticks) * i;
          return (
            <div key={i} className="absolute top-0 mono" style={{ left: `${(i / ticks) * 100}%`, fontSize: 9, color: "var(--ink3)", transform: i === ticks ? "translateX(-100%)" : i ? "translateX(-50%)" : undefined }}>
              {fmtMs(ms)}
            </div>
          );
        })}
      </div>

      {/* agent bar — the untrusted controller, before any check runs */}
      <Row
        label="intent contract"
        sub="untrusted controller"
        left={0}
        width={pct(agentMs)}
        color="var(--ink3)"
        right={fmtMs(agentMs)}
        striped
      />

      <div className="my-1 border-t" style={{ borderColor: "var(--rule)" }} />

      {checks.map((c) => (
        <Row
          key={c.name}
          label={c.label}
          sub={c.kind.replace("_", " ")}
          left={pct(agentMs + c.started_ms)}
          width={Math.max(0.6, pct(c.ended_ms - c.started_ms))}
          color={statusColor[c.status] ?? "var(--ink3)"}
          right={fmtMs(c.latency_ms)}
          status={c.status}
          summary={c.summary}
          onClick={onSelect ? () => onSelect(c) : undefined}
          active={selected === c.name}
        />
      ))}
    </div>
  );
}

function Row({
  label, sub, left, width, color, right, status, summary, onClick, active, striped,
}: {
  label: string; sub: string; left: number; width: number; color: string; right: string;
  status?: string; summary?: string; onClick?: () => void; active?: boolean; striped?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`grid items-center gap-2 px-1 ${onClick ? "cursor-pointer" : ""}`}
      style={{
        gridTemplateColumns: "132px 1fr 118px 58px",
        height: 24,
        background: active ? "var(--panel-2)" : undefined,
      }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {status && <Dot status={status} />}
        <span className="truncate" style={{ fontSize: 11 }}>{label}</span>
      </div>

      <div className="relative h-full flex items-center">
        <div className="absolute inset-x-0" style={{ height: 1, background: "var(--rule-soft)" }} />
        <div
          className="absolute"
          style={{
            left: `${left}%`, width: `${width}%`, height: 9,
            background: striped
              ? `repeating-linear-gradient(90deg, ${color}55 0 3px, transparent 3px 6px)`
              : `${color}30`,
            borderLeft: `2px solid ${color}`,
            borderRadius: 1,
          }}
        />
      </div>

      <div className="mono truncate" style={{ fontSize: 10, color: "var(--ink3)" }} title={summary}>
        {summary ?? sub}
      </div>
      <div className="mono text-right" style={{ fontSize: 10, color: "var(--ink2)" }}>{right}</div>
    </div>
  );
}
