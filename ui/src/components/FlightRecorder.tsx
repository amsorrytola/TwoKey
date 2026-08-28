"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Verdict, fmtMoney, fmtMs, laneColor, statusColor } from "@/lib/api";
import { CheckTimeline } from "./CheckTimeline";
import { Bit, Dot, Label, LaneChip, Panel, RiskRadar, RiskScale } from "./primitives";

/**
 * "When an auditor asks why the AI did that — you just replay it."
 * Left: the declared intent and the evidence it cited, with source trust.
 * Centre: the parallel check timeline, scrubbable step by step.
 * Right: fused risk vector, routing decision, execution and the ledger entry.
 */
export function FlightRecorder({ v }: { v: Verdict | null }) {
  const [sel, setSel] = useState<string | undefined>();
  const [t, setT] = useState(1);

  const events = v?.timeline ?? [];
  useEffect(() => { setT(1); setSel(undefined); }, [v?.id]);

  const cutoff = useMemo(() => {
    if (!events.length) return Infinity;
    const i = Math.min(events.length - 1, Math.floor(t * (events.length - 1)));
    return events[i].t_ms;
  }, [t, events]);

  if (!v) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center" style={{ maxWidth: 420 }}>
          <div className="mono" style={{ fontSize: 26, color: "var(--brand)", lineHeight: 1 }}>&gt;</div>
          <div className="mt-3" style={{ fontSize: 13 }}>Flight recorder</div>
          <div className="mt-1.5" style={{ fontSize: 11, color: "var(--ink-2)" }}>
            Every governed action is replayable: the plan the agent declared, the six checks
            that ran against it on a real millisecond timeline, the evidence each produced,
            and the ledger entry it wrote.
          </div>
          <div className="mt-3 label" style={{ color: "var(--ink-3)" }}>
            Select a row in the action stream, or press <span className="kbd">J</span>
            {" / "}<span className="kbd">K</span> to walk the stream.
          </div>
        </div>
      </div>
    );
  }

  const visible = v.checks.filter((c) => v.intent.latency_ms + c.ended_ms <= cutoff + 1);
  const check = v.checks.find((c) => c.name === sel);

  return (
    <div className="h-full grid gap-2 p-2 min-h-0" style={{ gridTemplateColumns: "300px 1fr 300px" }}>
      {/* ── intent + evidence ───────────────────────────────────────── */}
      <div className="flex flex-col gap-2 min-h-0">
        <Panel title="Intent contract">
          <div className="flex items-baseline justify-between mb-2">
            <span className="mono" style={{ fontSize: 14 }}>{v.intent.action.replace(/_/g, " ")}</span>
            <span className="mono" style={{ fontSize: 14 }}>
              {v.intent.params?.amount ? fmtMoney(v.intent.params.amount, v.currency) : "—"}
            </span>
          </div>
          <Bit k="declared by" v={v.agent_model} mono />
          <Bit k="profile" v={v.agent_profile} mono />
          <Bit k="self-confidence" v={v.intent.confidence.toFixed(2)} mono />
          <Bit k="declared in" v={fmtMs(v.intent.latency_ms)} mono />

          <Label className="mt-3 mb-1">Declared rationale</Label>
          {v.intent.rationale.map((s) => {
            const step = check?.name === "trace_auditor"
              ? (check.evidence?.steps ?? []).find((x: any) => x.step === s.step) : null;
            return (
              <div key={s.step} className="flex gap-2 py-1 border-b" style={{ borderColor: "var(--rule-soft)" }}>
                <span className="mono shrink-0" style={{ fontSize: 10, color: "var(--ink-3)" }}>{s.step}</span>
                <span style={{ fontSize: 11, color: "var(--ink-2)" }}>{s.text}</span>
                {step && (
                  <span className="mono shrink-0" style={{
                    fontSize: 10,
                    color: step.score < 0.5 ? "var(--fail)" : step.score < 0.75 ? "var(--warn)" : "var(--pass)",
                  }}>{step.score.toFixed(2)}</span>
                )}
              </div>
            );
          })}
        </Panel>

        <Panel title="Cited evidence · source trust">
          {v.intent.cited_clauses.length === 0 && (
            <div className="label">No clauses cited — a high-consequence action with no governed basis.</div>
          )}
          {v.intent.cited_clauses.map((c) => (
            <div key={c.id} className="py-1.5 border-b" style={{ borderColor: "var(--rule-soft)" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="mono" style={{ fontSize: 11 }}>{c.id}</span>
                <span className="flex items-center gap-1.5">
                  <span className="label">{c.source}</span>
                  <span className="mono" style={{
                    fontSize: 10,
                    color: c.trust >= 0.9 ? "var(--pass)" : c.trust >= 0.5 ? "var(--warn)" : "var(--fail)",
                  }}>{c.trust.toFixed(2)}</span>
                </span>
              </div>
              <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 2 }}>{c.text}</div>
            </div>
          ))}
          <Bit k="mean source trust" v={v.source_trust.mean.toFixed(2)} mono />
        </Panel>
      </div>

      {/* ── timeline + evidence detail ──────────────────────────────── */}
      <div className="flex flex-col gap-2 min-h-0">
        <Panel
          title="Verification mesh · parallel execution"
          right={
            <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
              mesh {fmtMs(v.mesh_latency_ms)} wall · {v.checks.reduce((s, c) => s + c.latency_ms, 0)}ms serial ·
              {" "}{(v.checks.reduce((s, c) => s + c.latency_ms, 0) / Math.max(1, v.mesh_latency_ms)).toFixed(1)}× saved
            </span>
          }
        >
          <CheckTimeline checks={visible} agentMs={v.intent.latency_ms} onSelect={(c) => setSel(c.name)} selected={sel} />

          <div className="flex items-center gap-3 mt-3 pt-2 border-t" style={{ borderColor: "var(--rule)" }}>
            <Label>replay</Label>
            <input type="range" min={0} max={1} step={0.01} value={t}
                   onChange={(e) => setT(parseFloat(e.target.value))}
                   className="flex-1" style={{ accentColor: "var(--brand)" }} />
            <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
              t+{fmtMs(cutoff === Infinity ? v.total_latency_ms : cutoff)}
            </span>
          </div>
          <div className="mt-1.5 space-y-0.5 max-h-24 overflow-auto">
            {events.filter((e) => e.t_ms <= cutoff + 1).slice(-6).map((e, i) => (
              <div key={i} className="flex gap-3 mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                <span style={{ width: 52, textAlign: "right" }}>t+{fmtMs(e.t_ms)}</span>
                <span style={{ color: "var(--ink-2)" }}>{e.event}</span>
                <span className="truncate">{e.detail}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title={check ? `Evidence · ${check.label}` : "Evidence"} className="min-h-0" pad>
          {!check && <div className="label">Click a check on the timeline to open the evidence it produced.</div>}
          {check && <Evidence c={check} />}
        </Panel>
      </div>

      {/* ── risk, route, execution, ledger ──────────────────────────── */}
      <div className="flex flex-col gap-2 min-h-0 overflow-auto">
        <Panel title="Fused risk vector">
          <div className="flex justify-center py-1"><RiskRadar v={v.risk_vector} /></div>
          <div className="mt-2">
            <div className="flex items-baseline justify-between mb-1">
              <Label>overall</Label>
              <span className="mono" style={{ fontSize: 16 }}>{v.overall_risk.toFixed(3)}</span>
            </div>
            <RiskScale score={v.overall_risk} thresholds={v.policy_snapshot?.thresholds} />
            <div className="flex justify-between mt-1 mono" style={{ fontSize: 9, color: "var(--ink-3)" }}>
              <span>0 safe</span>
              <span>τ {v.policy_snapshot?.thresholds?.auto_max}</span>
              <span>1 unsafe</span>
            </div>
          </div>
          {v.risk?.source_trust?.penalty_applied > 0 && (
            <Bit k="untrusted-source penalty" v={`+${v.risk.source_trust.penalty_applied}`} mono />
          )}
        </Panel>

        <Panel title="Routing decision">
          <div className="mb-2"><LaneChip lane={v.lane} /></div>
          <div style={{ fontSize: 11, color: "var(--ink-2)" }}>{v.route.reason}</div>
          {v.route.mandated && (
            <div className="mt-1.5 label" style={{ color: "var(--human)" }}>
              regulator-mandated review, not a risk score
            </div>
          )}
          {v.policy_snapshot?.regulatory_basis && (
            <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--rule-soft)" }}>
              <Label>legal basis</Label>
              <div style={{ fontSize: 10, color: "var(--ink-3)" }}>{v.policy_snapshot.regulatory_basis}</div>
            </div>
          )}
          {(v.route.edits ?? []).length > 0 && (
            <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--rule-soft)" }}>
              <Label>repairs applied</Label>
              {v.route.edits.map((e: any, i: number) => (
                <div key={i} className="mono" style={{ fontSize: 10, marginTop: 3 }}>
                  <span style={{ color: "var(--ink-3)" }}>{e.field}</span>{" "}
                  <span style={{ color: "var(--fail)", textDecoration: "line-through" }}>
                    {typeof e.from === "number" ? Math.round(e.from) : String(e.from).slice(0, 22)}
                  </span>{" → "}
                  <span style={{ color: "var(--edit)" }}>
                    {typeof e.to === "number" ? Math.round(e.to) : String(e.to).slice(0, 22)}
                  </span>
                  <div className="label">{e.rule}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {v.two_key && (
          <Panel title="Two-key concurrence">
            <Bit k="second model" v={v.two_key.model} mono />
            <Bit k="vendor" v={v.two_key.vendor ?? "—"} mono />
            <Bit k="credential" v="separate key" mono />
            <Bit k="its decision" v={`${v.two_key.decision ?? "—"} ${v.two_key.amount ? Math.round(v.two_key.amount) : ""}`} mono />
            <Bit k="concurred" v={
              <span style={{ color: v.two_key.concur ? "var(--pass)" : "var(--warn)" }}>
                {v.two_key.concur ? "yes — both keys turned" : "no"}
              </span>} />
            {v.two_key.reconciled_to && <Bit k="reconciled to" v={Math.round(v.two_key.reconciled_to)} mono />}
            <div className="mt-1" style={{ fontSize: 10, color: "var(--ink-3)" }}>{v.two_key.explanation}</div>
          </Panel>
        )}

        <Panel title="Execution">
          <Bit k="status" v={v.execution.status} mono />
          <Bit k="money moved" v={fmtMoney(v.execution.money_moved ?? 0, v.currency)} mono />
          <Bit k="idempotency" v={<span title={v.execution.idempotency_key}>{(v.execution.idempotency_key ?? "").slice(0, 14)}…</span>} mono />
          {v.execution.budget_remaining != null && (
            <Bit k="budget left" v={fmtMoney(v.execution.budget_remaining, v.currency)} mono />
          )}
          <Label className="mt-2 mb-1">saga stages</Label>
          {(v.execution.saga ?? []).map((s: any) => (
            <div key={s.name} className="flex items-center justify-between py-[2px]">
              <span className="mono" style={{ fontSize: 10 }}>{s.name}</span>
              <span className="label" style={{
                color: s.status === "committed" ? "var(--pass)"
                     : s.status === "failed" ? "var(--fail)"
                     : s.status === "compensated" ? "var(--edit)" : "var(--ink-3)",
              }}>{s.status.replace(/_/g, " ")}</span>
            </div>
          ))}
        </Panel>

        <Panel title="Ledger entry">
          <Bit k="seq" v={`#${v.ledger?.seq}`} mono />
          <Bit k="hash" v={(v.ledger?.hash ?? "").slice(0, 20) + "…"} mono />
          <Bit k="prev" v={(v.ledger?.prev_hash ?? "").slice(0, 20) + "…"} mono />
          <Bit k="signature" v={v.ledger?.signature} mono />
          <Bit k="retention" v={`${v.policy_snapshot?.retention_months} months`} mono />
          <Bit k="cost" v={`$${(v.cost_usd ?? 0).toFixed(5)} · ${v.llm_calls} calls`} mono />
        </Panel>
      </div>
    </div>
  );
}

/* evidence renderers — one per check, because a generic JSON dump proves nothing */
function Evidence({ c }: { c: Check }) {
  const e = c.evidence ?? {};
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Dot status={c.status} />
        <span style={{ fontSize: 12 }}>{c.summary}</span>
        <span className="mono ml-auto" style={{ fontSize: 10, color: "var(--ink-3)" }}>
          risk {c.score.toFixed(3)} · {fmtMs(c.latency_ms)} · {c.model ?? c.kind}
        </span>
      </div>

      {c.name === "static_policy" && (
        <table>
          <tbody>
            {(e.rules ?? []).map((r: any) => (
              <tr key={r.id} className="border-b" style={{ borderColor: "var(--rule-soft)" }}>
                <td className="mono py-1" style={{ fontSize: 10, width: 34, color: "var(--ink-3)" }}>{r.id}</td>
                <td className="py-1" style={{ fontSize: 11, color: r.ok ? "var(--ink-2)" : "var(--ink)" }}>{r.desc}</td>
                <td className="mono py-1" style={{ fontSize: 10, color: "var(--fail)" }}>{r.detail}</td>
                <td className="py-1 text-right" style={{ fontSize: 10, color: r.ok ? "var(--pass)" : "var(--fail)" }}>
                  {r.ok ? "pass" : "VIOLATED"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {c.name === "evidence_nli" && (
        <>
          <Bit k="verdict" v={<span style={{
            color: e.verdict === "ENTAILED" ? "var(--pass)" : e.verdict === "CONTRADICTED" ? "var(--fail)" : "var(--warn)",
          }}>{e.verdict}</span>} mono />
          <Bit k="judge confidence" v={(e.confidence ?? 0).toFixed(2)} mono />
          <Bit k="min source trust" v={(e.min_source_trust ?? 0).toFixed(2)} mono />
          <div className="mt-2" style={{ fontSize: 11, color: "var(--ink-2)" }}>{e.explanation}</div>
        </>
      )}

      {c.name === "semantic_entropy" && (
        <>
          <Bit k="resamples" v={e.k} mono />
          <Bit k="normalised entropy" v={(e.normalized ?? 0).toFixed(3)} mono />
          <Bit k="agreement" v={`${Math.round((e.agreement ?? 0) * 100)}%`} mono />
          <Label className="mt-2 mb-1">meaning clusters</Label>
          {(e.clusters ?? []).map((cl: any) => (
            <div key={cl.decision} className="flex items-center gap-2 py-[2px]">
              <span className="mono" style={{ fontSize: 10, width: 150 }}>{cl.decision}</span>
              <span style={{ height: 6, width: `${(cl.n / (e.k + 1)) * 100}%`, background: "var(--ink-3)" }} />
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{cl.n}</span>
            </div>
          ))}
        </>
      )}

      {c.name === "trace_auditor" && (
        <>
          {(e.steps ?? []).map((s: any) => (
            <div key={s.step} className="flex gap-2 py-1 border-b" style={{ borderColor: "var(--rule-soft)" }}>
              <span className="mono" style={{ fontSize: 10, width: 16, color: "var(--ink-3)" }}>{s.step}</span>
              <span style={{ height: 6, marginTop: 4, width: `${s.score * 90}px`,
                             background: s.score < 0.5 ? "var(--fail)" : s.score < 0.75 ? "var(--warn)" : "var(--pass)" }} />
              <span className="mono" style={{ fontSize: 10, width: 34 }}>{s.score.toFixed(2)}</span>
              <span style={{ fontSize: 10, color: "var(--ink-2)" }}>{s.note}</span>
            </div>
          ))}
        </>
      )}

      {c.name === "consequence_sim" && (
        <>
          <Bit k="money that would move" v={Math.round(e.money_moved ?? 0)} mono />
          <Bit k="reversible" v={<span style={{ color: e.reversible ? "var(--pass)" : "var(--fail)" }}>
            {e.reversible ? "yes" : "no — fail-closed applies"}</span>} />
          <Bit k="systems touched" v={(e.systems ?? []).join(", ")} mono />
          <Bit k="downstream actions" v={(e.downstream_actions ?? []).join(", ") || "—"} mono />
          <Bit k="budget after" v={`${Math.round(e.budget_after ?? 0)} / ${Math.round(e.budget_cap ?? 0)}`} mono />
          {e.budget_breaker_tripped && <Bit k="breaker" v={<span style={{ color: "var(--fail)" }}>TRIPPED</span>} />}
        </>
      )}

      {c.name === "prompt_guard" && (
        <>
          <Bit k="label" v={<span style={{ color: e.label === "INJECTION" ? "var(--fail)" : "var(--pass)" }}>{e.label}</span>} mono />
          <Bit k="p(injection)" v={(e.p_injection ?? 0).toFixed(4)} mono />
          <Label className="mt-2 mb-1">scanned text</Label>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-2)" }}>{e.scanned}</div>
        </>
      )}
    </div>
  );
}
