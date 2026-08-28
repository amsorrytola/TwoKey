"use client";

import { ActionSummary, fmtMoney, fmtMs, fmtTime, laneColor } from "@/lib/api";
import { LaneChip, RiskBars } from "./primitives";

/**
 * Dense operational feed, newest first. Every row answers: what did the AI try to do,
 * how risky was it, where did it go, and what did it cost in time and money.
 * No cards. No icons. One line per governed action.
 */
export function ActionStream({
  actions, selected, onSelect, running,
}: {
  actions: ActionSummary[];
  selected?: string;
  onSelect: (a: ActionSummary) => void;
  running: { claim_id: string; checks: number }[];
}) {
  return (
    <div className="min-h-0 h-full flex flex-col">
      <div className="grid px-3 h-6 items-center shrink-0 border-b label"
           style={{ gridTemplateColumns: COLS, borderColor: "var(--rule)" }}>
        <span>time</span><span>claim</span><span>customer</span><span>agent intent</span>
        <span className="text-right">amount</span><span>risk</span><span>lane</span>
        <span className="text-right">latency</span><span className="text-right">moved</span>
      </div>

      <div className="flex-1 overflow-auto">
        {running.map((r) => (
          <div key={r.claim_id} className="grid px-3 items-center border-b appended"
               style={{ gridTemplateColumns: COLS, height: 28, borderColor: "var(--rule-soft)" }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>····</span>
            <span className="mono" style={{ fontSize: 11 }}>{r.claim_id}</span>
            <span style={{ gridColumn: "span 5" }} className="flex items-center gap-2">
              <span className="relative overflow-hidden" style={{ width: 90, height: 2, background: "var(--rule)" }}>
                <span className="absolute inset-y-0 runbar" style={{ width: "34%", background: "var(--ink-3)" }} />
              </span>
              <span className="label">verifying · {r.checks}/6 checks returned</span>
            </span>
            <span /><span />
          </div>
        ))}

        {actions.length === 0 && running.length === 0 && (
          <div className="p-5">
            <div style={{ fontSize: 12, color: "var(--ink-2)" }}>
              No actions governed yet. Nothing has reached a core system.
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              <Hint k="click a claim" v="pick one from Planted failure modes on the left" />
              <Hint k="B" v="run a batch of 8" />
              <Hint k="S" v="surge — 3x volume across the whole claim set" />
              <Hint k="⌘K" v="command palette — every claim and control is in here" />
            </div>
          </div>
        )}

        {actions.map((a) => {
          const on = a.id === selected;
          const missed = a.ground_truth?.trap && a.lane === "AUTO";
          return (
            <div
              key={a.id}
              onClick={() => onSelect(a)}
              className="grid px-3 items-center border-b cursor-pointer land"
              style={{
                gridTemplateColumns: COLS, height: 30, borderColor: "var(--rule-soft)",
                background: on ? "var(--panel-2)" : undefined,
                boxShadow: on ? `inset 2px 0 0 ${laneColor[a.lane]}` : undefined,
              }}
            >
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{fmtTime(a.ts)}</span>
              <span className="mono" style={{ fontSize: 11 }}>
                {a.claim_id}
                {a.ground_truth?.trap && (
                  <span className="label ml-1.5" style={{ color: "var(--ink-3)" }}>
                    {a.ground_truth.trap.replace(/_/g, " ")}
                  </span>
                )}
              </span>
              <span className="mono truncate" style={{ fontSize: 11, color: "var(--ink-2)" }}>{a.customer_masked}</span>
              <span className="truncate" style={{ fontSize: 11 }}>
                {a.action.replace(/_/g, " ")}
                {(a.edits ?? 0) > 0 && <span className="label ml-1.5" style={{ color: "var(--edit)" }}>repaired</span>}
                {a.two_key_concur === false && <span className="label ml-1.5" style={{ color: "var(--two-key)" }}>keys differed</span>}
              </span>
              <span className="mono text-right" style={{ fontSize: 11 }}>
                {a.amount ? fmtMoney(a.amount, a.currency) : "—"}
              </span>
              <span className="flex items-center gap-2">
                <RiskBars v={a.risk_vector} />
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-2)" }}>
                  {a.overall_risk.toFixed(2)}
                </span>
              </span>
              <span><LaneChip lane={a.lane} /></span>
              <span className="mono text-right" style={{
                fontSize: 10, color: a.within_budget ? "var(--ink-3)" : "var(--warn)",
              }}>
                {fmtMs(a.total_latency_ms)}
              </span>
              <span className="mono text-right" style={{
                fontSize: 11, color: a.money_moved ? "var(--ink)" : "var(--ink-3)",
              }}>
                {a.money_moved ? fmtMoney(a.money_moved, a.currency) : "—"}
                {missed ? <span style={{ color: "var(--fail)" }}> !</span> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Hint({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="kbd" style={{ minWidth: 26, textAlign: "center" }}>{k}</span>
      <span className="label" style={{ color: "var(--ink-3)" }}>{v}</span>
    </div>
  );
}

const COLS = "58px 150px 92px 1fr 96px 92px 78px 66px 96px";
