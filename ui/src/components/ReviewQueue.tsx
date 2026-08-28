"use client";

import { useEffect, useState } from "react";
import { ActionSummary, Verdict, api, fmtMoney, laneColor } from "@/lib/api";
import { Bit, Label, LaneChip, Panel, RiskRadar } from "./primitives";

/**
 * Art.14 human oversight, made workable. The reviewer is not handed a raw claim —
 * they get the evidence already staged, the disagreement already named, and two keys:
 * approve what the AI proposed, or override it with a reason that becomes training data.
 */
export function ReviewQueue({
  queue, verdict, onOpen, onDecided,
}: {
  queue: ActionSummary[];
  verdict: Verdict | null;
  onOpen: (id: string) => void;
  onDecided: () => void;
}) {
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  // A reviewer works this queue all shift. Keys beat clicks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
      if (!verdict) return;
      if (e.key.toLowerCase() === "a") { e.preventDefault(); decide("approve"); }
      if (e.key.toLowerCase() === "o") { e.preventDefault(); decide("override_deny"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function decide(decision: string) {
    if (!verdict) return;
    if (!reason.trim()) return alert("A reason is legally required on every override.");
    setBusy(true);
    try {
      await api(`/api/queue/${verdict.id}/decide`, {
        method: "POST",
        body: JSON.stringify({
          decision, reason,
          amount: decision === "override_amount" ? parseFloat(amount || "0") : null,
          reviewer: "R. Sidana",
        }),
      });
      setReason(""); setAmount(""); onDecided();
    } finally { setBusy(false); }
  }

  return (
    <div className="h-full grid gap-2 p-2 min-h-0" style={{ gridTemplateColumns: "330px 1fr" }}>
      <Panel title={`Awaiting human decision · ${queue.length}`} pad={false}>
        {queue.length === 0 && (
          <div className="p-4">
            <div style={{ fontSize: 12 }}>Queue clear.</div>
            <div className="label mt-1" style={{ color: "var(--ink-3)" }}>
              Nothing is waiting on a person. Actions arrive here only when the mesh cannot
              clear them, or when the jurisdiction requires a human signature.
            </div>
          </div>
        )}
        {queue.map((a) => (
          <button key={a.id} onClick={() => onOpen(a.id)}
                  className="w-full text-left px-3 py-2 border-b block"
                  style={{
                    borderColor: "var(--rule-soft)",
                    background: verdict?.id === a.id ? "var(--panel-2)" : undefined,
                    boxShadow: verdict?.id === a.id ? `inset 2px 0 0 ${laneColor.HUMAN}` : undefined,
                  }}>
            <div className="flex items-center justify-between">
              <span className="mono" style={{ fontSize: 11 }}>{a.claim_id}</span>
              <span className="mono" style={{ fontSize: 11 }}>{fmtMoney(a.amount, a.currency)}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="label">{a.action.replace(/_/g, " ")} · risk {a.overall_risk.toFixed(2)}</span>
              <span className="label">{a.customer_masked}</span>
            </div>
            <div className="label mt-1 truncate" style={{ color: "var(--ink-3)" }}>{a.route_reason}</div>
          </button>
        ))}
      </Panel>

      {!verdict && (
        <div className="grid place-items-center label" style={{ color: "var(--ink-3)" }}>
          Select an item to review.
        </div>
      )}

      {verdict && (
        <div className="grid gap-2 min-h-0" style={{ gridTemplateColumns: "1fr 300px" }}>
          <div className="flex flex-col gap-2 min-h-0">
            <Panel title="What the AI wants to do">
              <div className="flex items-baseline gap-3 mb-2">
                <LaneChip lane={verdict.lane} />
                <span className="mono" style={{ fontSize: 15 }}>{verdict.intent.action.replace(/_/g, " ")}</span>
                <span className="mono ml-auto" style={{ fontSize: 15 }}>
                  {fmtMoney(verdict.intent.params?.amount ?? 0, verdict.currency)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-2)" }}>{verdict.route.reason}</div>
            </Panel>

            <Panel title="Claim">
              <Bit k="claim" v={verdict.claim.id} mono />
              <Bit k="product" v={verdict.claim.product} mono />
              <Bit k="incident → filed" v={`${verdict.claim.incident_date} → ${verdict.claim.filed_date}`} mono />
              <Bit k="claimed" v={fmtMoney(verdict.claim.amount_claimed, verdict.currency)} mono />
              <Bit k="damage estimate" v={verdict.claim.damage_estimate != null
                ? fmtMoney(verdict.claim.damage_estimate, verdict.currency) : "NOT ON FILE"} mono />
              <Bit k="policy limit" v={verdict.policy
                ? fmtMoney(verdict.policy.coverage_limit, verdict.currency) : "POLICY NOT FOUND"} mono />
              <Bit k="history on file" v={verdict.claim.customer_id && verdict.customer_present ? "yes" : "no"} />
              <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--rule-soft)", fontSize: 11 }}>
                {verdict.claim.description}
              </div>
            </Panel>

            <Panel title="Why it was escalated — evidence already staged">
              {verdict.checks.filter((c) => c.status !== "pass").map((c) => (
                <div key={c.name} className="py-1.5 border-b" style={{ borderColor: "var(--rule-soft)" }}>
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: 11 }}>{c.label}</span>
                    <span className="label" style={{ color: c.status === "fail" ? "var(--fail)" : "var(--warn)" }}>
                      {c.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-2)" }}>{c.summary}</div>
                  {c.evidence?.explanation && (
                    <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 2 }}>{c.evidence.explanation}</div>
                  )}
                  {(c.evidence?.rules ?? []).filter((r: any) => !r.ok).map((r: any) => (
                    <div key={r.id} className="mono" style={{ fontSize: 10, color: "var(--fail)", marginTop: 2 }}>
                      {r.id} {r.desc} — {r.detail}
                    </div>
                  ))}
                </div>
              ))}
              {verdict.checks.every((c) => c.status === "pass") && (
                <div className="label">All checks passed; escalation is regulator-mandated for this action type.</div>
              )}
            </Panel>
          </div>

          <div className="flex flex-col gap-2 min-h-0 overflow-auto">
            <Panel title="Risk"><div className="flex justify-center"><RiskRadar v={verdict.risk_vector} size={150} /></div></Panel>

            <Panel title="Your decision">
              <textarea
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (required — recorded in the ledger and used to recalibrate)"
                className="w-full p-2 mb-2"
                style={{
                  background: "var(--ground)", border: "1px solid var(--rule)",
                  borderRadius: 2, fontSize: 11, minHeight: 62, resize: "vertical",
                }}
              />
              <div className="flex flex-col gap-1.5">
                <Act label="Approve as proposed" hint="execute the AI's action unchanged"
                     color="var(--auto)" onClick={() => decide("approve")} busy={busy} keys="A" />
                <div className="flex gap-1.5">
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="amount"
                         className="mono px-2" style={{
                           background: "var(--ground)", border: "1px solid var(--rule)",
                           borderRadius: 2, width: 96, fontSize: 11,
                         }} />
                  <Act label="Override amount" hint="" color="var(--edit)" grow
                       onClick={() => decide("override_amount")} busy={busy} />
                </div>
                <Act label="Override — do not pay" hint="hold the action; nothing moves"
                     color="var(--block)" onClick={() => decide("override_deny")} busy={busy} keys="O" />
              </div>
              <div className="label mt-2" style={{ color: "var(--ink-3)" }}>
                Recorded under {verdict.policy_snapshot?.regulatory_basis || "policy"} ·
                retained {verdict.policy_snapshot?.retention_months} months
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function Act({ label, hint, color, onClick, busy, grow, keys }: {
  label: string; hint: string; color: string; onClick: () => void;
  busy: boolean; grow?: boolean; keys?: string;
}) {
  return (
    <button onClick={onClick} disabled={busy}
            className={`text-left px-2.5 py-1.5 ${grow ? "flex-1" : ""}`}
            style={{ border: `1px solid ${color}`, borderRadius: 2, background: `${color}10` }}>
      <div className="flex items-center gap-2">
        <span style={{ fontSize: 11, color, fontWeight: 500 }}>{label}</span>
        {keys && <span className="kbd ml-auto">{keys}</span>}
      </div>
      {hint && <div className="label" style={{ color: "var(--ink-3)" }}>{hint}</div>}
    </button>
  );
}
