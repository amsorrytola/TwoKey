"use client";

import { useEffect, useState } from "react";
import { API, api, fmtMoney, fmtMs, laneColor, Lane, LANES, laneLabel } from "@/lib/api";
import { Bit, Label, Panel } from "./primitives";

/**
 * The screen for the skeptic. No hero numbers on coloured tiles — a dense scorecard
 * that reports the false-negative rate first, because that is the number that decides
 * whether an insurer can let this run unattended.
 */
export function TrustReport({ state, onReload }: { state: any; onReload: () => void }) {
  const [rep, setRep] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [ledger, setLedger] = useState<any>(null);

  async function load() {
    try { setRep(await api("/api/report")); } catch { setRep(null); }
    try { setHist(await api("/api/learning/history")); } catch {}
    try { setLedger(await api("/api/ledger?limit=40")); } catch {}
  }
  useEffect(() => { load(); }, []);

  const o = rep?.overall;

  return (
    <div className="h-full overflow-auto p-2 grid gap-2" style={{ gridTemplateColumns: "1fr 1fr 320px" }}>
      {/* ── headline scorecard ───────────────────────────────────────── */}
      <Panel title="Governed outcome vs ground truth" className="col-span-2"
             right={<button onClick={async () => { setBusy(true); await api("/api/report/run", { method: "POST" }); setBusy(false); }}
                            className="label px-2 py-0.5 border" style={{ borderColor: "var(--rule)" }}>
                      {busy ? "running…" : "re-run evaluation"}
                    </button>}>
        {!o && <div className="label">No evaluation on file. Run one to populate this report.</div>}
        {o && (
          <>
            <table>
              <tbody>
                <Row k="False negatives — unsafe action executed" v={`${o.fn}`}
                     sub="the number that decides whether this can run unattended"
                     color={o.fn === 0 ? "var(--pass)" : "var(--fail)"} big />
                <Row k="False positives — safe action escalated" v={`${o.fp}`}
                     sub={`${(o.fp_rate * 100).toFixed(1)}% FP rate · the alert-fatigue cost`}
                     color={o.fp_rate < 0.2 ? "var(--pass)" : "var(--warn)"} big />
                <Row k="Recall (unsafe actions caught)" v={o.recall.toFixed(3)} />
                <Row k="Precision" v={o.precision.toFixed(3)} />
                <Row k="Regulator-mandated reviews" v={`${o.mandated_reviews ?? 0}`}
                     sub="required by jurisdiction, excluded from FP" />
                <tr><td colSpan={2} style={{ height: 8 }} /></tr>
                <Row k="Agent accuracy — ungoverned" v={`${(o.agent_accuracy_ungoverned * 100).toFixed(1)}%`}
                     sub="what would have happened with no Interlock" />
                <Row k="Accuracy — governed" v={`${(o.governed_accuracy * 100).toFixed(1)}%`}
                     color={o.governed_accuracy > o.agent_accuracy_ungoverned ? "var(--pass)" : undefined}
                     sub={`${((o.governed_accuracy - o.agent_accuracy_ungoverned) * 100).toFixed(1)} pts from governance alone`} />
                <tr><td colSpan={2} style={{ height: 8 }} /></tr>
                <Row k="Straight-through (no human touched it)" v={`${(o.straight_through_rate * 100).toFixed(1)}%`} />
                <Row k="Human touch rate" v={`${(o.human_touch_rate * 100).toFixed(1)}%`} />
                <Row k="Latency p50 / p95" v={`${fmtMs(o.p50_ms)} / ${fmtMs(o.p95_ms)}`} />
                <Row k="Within latency budget" v={`${(o.within_budget_rate * 100).toFixed(0)}%`} />
                <Row k="Cost per governed action" v={`$${o.cost_per_action_usd.toFixed(5)}`}
                     sub={`≈ $${(o.cost_per_action_usd * 30000).toFixed(0)} per 30k actions/week`} />
              </tbody>
            </table>

            {rep.leakage_prevented && Object.keys(rep.leakage_prevented).length > 0 && (
              <div className="mt-3 pt-2 border-t" style={{ borderColor: "var(--rule)" }}>
                <Label>leakage prevented on this run</Label>
                {Object.entries(rep.leakage_prevented).map(([cur, amt]: any) => (
                  <div key={cur} className="mono" style={{ fontSize: 18, marginTop: 2 }}>{fmtMoney(amt, cur)}</div>
                ))}
              </div>
            )}
          </>
        )}
      </Panel>

      {/* ── ledger integrity ─────────────────────────────────────────── */}
      <Panel title="Flight recorder integrity"
             right={<span className="label">EU AI Act Art.12</span>}>
        <div className="flex items-baseline gap-2 mb-2">
          <span style={{ fontSize: 20, color: ledger?.verify?.ok ? "var(--pass)" : "var(--fail)" }} className="mono">
            {ledger?.verify?.ok ? "CHAIN VERIFIED" : "CHAIN BROKEN"}
          </span>
        </div>
        <Bit k="entries" v={ledger?.verify?.entries ?? 0} mono />
        <Bit k="head" v={(ledger?.verify?.head_hash ?? "").slice(0, 20) + "…"} mono />
        {ledger?.verify?.first_bad_seq && (
          <Bit k="first bad seq" v={<span style={{ color: "var(--fail)" }}>#{ledger.verify.first_bad_seq}</span>} mono />
        )}
        <button
          onClick={async () => {
            const seq = Math.max(2, Math.floor((ledger?.verify?.entries ?? 4) / 2));
            await api("/api/ledger/tamper", { method: "POST", body: JSON.stringify({ seq, field: "amount", value: 999999 }) });
            await load(); onReload();
          }}
          className="w-full mt-3 py-1.5 label"
          style={{ border: "1px solid var(--rule)", borderRadius: 2, color: "var(--ink-2)" }}
        >
          tamper with a stored verdict (demo)
        </button>

        <Label className="mt-3 mb-1">recent entries</Label>
        <div className="max-h-56 overflow-auto">
          {(ledger?.entries ?? []).map((e: any) => (
            <div key={e.seq} className="flex items-center gap-2 py-[3px] border-b mono"
                 style={{ borderColor: "var(--rule-soft)", fontSize: 10 }}>
              <span style={{ width: 34, color: "var(--ink-3)" }}>#{e.seq}</span>
              <span className="label" style={{ width: 78 }}>{e.kind}</span>
              <span style={{ color: "var(--ink-3)" }}>{e.hash.slice(0, 12)}</span>
              <span className="ml-auto" style={{ color: laneColor[(e.payload?.lane ?? "AUTO") as Lane] }}>
                {e.payload?.lane ?? ""}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      {/* ── per-trap breakdown ───────────────────────────────────────── */}
      <Panel title="By failure mode" className="col-span-2">
        <table>
          <thead>
            <tr className="label border-b" style={{ borderColor: "var(--rule)" }}>
              <th className="text-left py-1">trap</th><th className="text-right">n</th>
              <th className="text-right">TP</th><th className="text-right">TN</th>
              <th className="text-right">FP</th><th className="text-right">FN</th>
              <th className="text-right">straight-through</th><th className="text-right">p50</th>
            </tr>
          </thead>
          <tbody>
            {(rep?.by_trap ?? []).map((t: any) => (
              <tr key={t.trap} className="border-b" style={{ borderColor: "var(--rule-soft)" }}>
                <td className="py-1" style={{ fontSize: 11 }}>{t.trap.replace(/_/g, " ")}</td>
                <td className="mono text-right" style={{ fontSize: 11 }}>{t.n}</td>
                <td className="mono text-right" style={{ fontSize: 11, color: "var(--pass)" }}>{t.tp}</td>
                <td className="mono text-right" style={{ fontSize: 11, color: "var(--ink-3)" }}>{t.tn}</td>
                <td className="mono text-right" style={{ fontSize: 11, color: t.fp ? "var(--warn)" : "var(--ink-3)" }}>{t.fp}</td>
                <td className="mono text-right" style={{ fontSize: 11, color: t.fn ? "var(--fail)" : "var(--ink-3)" }}>{t.fn}</td>
                <td className="mono text-right" style={{ fontSize: 11 }}>{(t.straight_through_rate * 100).toFixed(0)}%</td>
                <td className="mono text-right" style={{ fontSize: 11, color: "var(--ink-3)" }}>{fmtMs(t.p50_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* ── learning loop + fairness ─────────────────────────────────── */}
      <Panel title="Closed loop"
             right={<button onClick={async () => { await api("/api/learning/recalibrate", { method: "POST" }); await load(); onReload(); }}
                            className="label px-2 py-0.5 border" style={{ borderColor: "var(--rule)" }}>
                      run recalibration
                    </button>}>
        <div style={{ fontSize: 11, color: "var(--ink-2)" }}>
          Split-conformal quantile over labelled verdicts. α is the error rate the business
          accepts on unattended decisions; τ is derived from it, not chosen by hand.
        </div>
        <Bit k="α (accepted error)" v={(state?.alpha ?? 0).toFixed(2)} mono />
        <Bit k="τ (current)" v={(state?.tau ?? 0).toFixed(3)} mono />

        {(hist?.history ?? []).length > 0 && (
          <>
            <Label className="mt-3 mb-1">escalation rate by calibration night</Label>
            <Spark points={(hist.history ?? []).map((h: any) => h.escalation_rate)} />
            <div className="flex justify-between mono" style={{ fontSize: 9, color: "var(--ink-3)" }}>
              <span>night 1</span><span>night {hist.history.length}</span>
            </div>
          </>
        )}

        <Label className="mt-3 mb-1">cohort fairness · drift sentinel</Label>
        {(hist?.fairness?.cohorts ?? []).map((c: any) => (
          <div key={c.cohort} className="flex items-center gap-2 py-[2px]">
            <span className="mono" style={{ fontSize: 10, width: 62 }}>{c.cohort}</span>
            <span style={{ height: 5, width: `${c.auto_rate * 110}px`, background: "var(--ink-3)" }} />
            <span className="mono" style={{ fontSize: 10 }}>{(c.auto_rate * 100).toFixed(0)}%</span>
            <span className="label ml-auto">n={c.n}</span>
          </div>
        ))}
        {hist?.fairness && (
          <Bit k="max cohort gap" v={
            <span style={{ color: hist.fairness.status === "ok" ? "var(--pass)" : "var(--warn)" }}>
              {hist.fairness.max_gap} · {hist.fairness.status}
            </span>} mono />
        )}
      </Panel>

      {/* ── LLM vs deterministic ─────────────────────────────────────── */}
      <Panel title="What is an LLM and what is not">
        <div style={{ fontSize: 11, color: "var(--ink-2)", marginBottom: 8 }}>
          LLMs propose and assess. They never choose the lane and never move money.
        </div>
        {rep?.llm_vs_non_llm && Object.entries(rep.llm_vs_non_llm).map(([k, val]: any) => (
          <div key={k} className="py-1 border-b" style={{ borderColor: "var(--rule-soft)" }}>
            <div className="label">{k.replace(/_/g, " ")}</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-2)" }}>
              {Array.isArray(val) ? val.join(", ") : String(val)}
            </div>
          </div>
        ))}
      </Panel>

      {/* ── models ───────────────────────────────────────────────────── */}
      <Panel title="Heterogeneous model roster">
        <div style={{ fontSize: 11, color: "var(--ink-2)", marginBottom: 8 }}>
          The second key runs a different vendor on a separate credential, so one bad model
          or one leaked key cannot turn both.
        </div>
        {Object.entries(state?.models ?? {}).map(([role, m]: any) => (
          <div key={role} className="flex items-baseline justify-between py-1 border-b"
               style={{ borderColor: "var(--rule-soft)" }}>
            <span className="label">{role.replace(/_/g, " ")}</span>
            <span className="mono text-right" style={{ fontSize: 10 }}>
              {m.model}<span style={{ color: "var(--ink-3)" }}> · {m.vendor}</span>
            </span>
          </div>
        ))}
        <Label className="mt-2 mb-1">rate-limit budget</Label>
        {(state?.key_pool ?? []).map((k: any) => (
          <div key={k.key} className="flex justify-between mono" style={{ fontSize: 10 }}>
            <span style={{ color: "var(--ink-3)" }}>{k.key}</span>
            <span>{k.remaining_tokens} tok</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function Row({ k, v, sub, color, big }: {
  k: string; v: string; sub?: string; color?: string; big?: boolean;
}) {
  return (
    <tr className="border-b" style={{ borderColor: "var(--rule-soft)" }}>
      <td className="py-1.5">
        <div style={{ fontSize: 11 }}>{k}</div>
        {sub && <div className="label" style={{ color: "var(--ink-3)" }}>{sub}</div>}
      </td>
      <td className="mono text-right py-1.5" style={{ fontSize: big ? 18 : 12, color: color ?? "var(--ink)" }}>{v}</td>
    </tr>
  );
}

function Spark({ points }: { points: number[] }) {
  if (!points.length) return null;
  const w = 260, h = 40, max = Math.max(...points, 0.01);
  const d = points.map((p, i) => `${(i / Math.max(1, points.length - 1)) * w},${h - (p / max) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="block">
      <polyline points={d} fill="none" stroke="var(--ink-2)" strokeWidth={1.5} />
      {points.map((p, i) => (
        <circle key={i} cx={(i / Math.max(1, points.length - 1)) * w} cy={h - (p / max) * h} r={2} fill="var(--brand)" />
      ))}
    </svg>
  );
}
