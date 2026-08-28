"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionStream } from "@/components/ActionStream";
import { FlightRecorder } from "@/components/FlightRecorder";
import { LaneGauge } from "@/components/LaneGauge";
import { ReviewQueue } from "@/components/ReviewQueue";
import { StatusBar } from "@/components/StatusBar";
import { TrustReport } from "@/components/TrustReport";
import { CommandPalette, Command } from "@/components/CommandPalette";
import { Toasts, useToasts } from "@/components/Toast";
import { Label, Panel } from "@/components/primitives";
import { ActionSummary, Verdict, WS, api, fmtMoney } from "@/lib/api";

export default function Home() {
  const [tab, setTab] = useState("stream");
  const [state, setState] = useState<any>(null);
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [queue, setQueue] = useState<ActionSummary[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [claims, setClaims] = useState<any[]>([]);
  const [running, setRunning] = useState<{ claim_id: string; checks: number }[]>([]);
  const [connected, setConnected] = useState(false);
  const [useCase, setUseCase] = useState("claims-settlement");
  const [jur, setJur] = useState("EU");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const refresh = useCallback(async () => {
    try {
      setState(await api("/api/state"));
      setActions(await api("/api/actions?limit=200"));
      setQueue(await api("/api/queue"));
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    api<any[]>("/api/claims").then(setClaims).catch(() => {});
    const sock = new WebSocket(WS);
    ws.current = sock;
    sock.onopen = () => setConnected(true);
    sock.onclose = () => setConnected(false);
    sock.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "state") setState(m.state);
      if (m.type === "action_started")
        setRunning((r) => [{ claim_id: m.claim_id, checks: 0 }, ...r.filter((x) => x.claim_id !== m.claim_id)]);
      if (m.type === "check_done")
        setRunning((r) => r.map((x) => ({ ...x, checks: x.checks + 1 })));
      if (m.type === "verdict") {
        const a = m.action;
        setActions((prev) => [a, ...prev.filter((x) => x.id !== a.id)]);
        setRunning((r) => r.filter((x) => x.claim_id !== a.claim_id));
        const stopped = a.lane === "BLOCK" || a.lane === "HUMAN";
        push(
          `${a.claim_id} → ${a.lane.replace("_", "-")} · risk ${a.overall_risk.toFixed(2)}` +
            (stopped && a.intent_amount ? "" : a.money_moved ? ` · paid ${Math.round(a.money_moved)}` : ""),
          a.lane === "BLOCK" ? "bad" : a.lane === "HUMAN" ? "warn" : "ok",
        );
        refresh();
      }
      if (m.type === "review_decided") { push("Decision recorded in the ledger", "ok"); refresh(); }
      if (m.type === "recalibrated") {
        push(`Recalibrated · τ ${m.result?.after?.tau ?? "—"}`, "ok"); refresh();
      }
      if (m.type === "eval_started") push("Evaluation started over the full claim set…");
      if (m.type === "eval_done") { push("Evaluation complete — see Trust report", "ok"); refresh(); }
      if (m.type === "batch_started") push(`Batch of ${m.n} started${m.surge ? " · surge 3x" : ""}`);
      if (m.type === "batch_done") push(`Batch complete · ${m.n} actions governed`, "ok");
      if (m.type === "reset") { setActions([]); setQueue([]); setVerdict(null); refresh(); }
    };
    return () => sock.close();
  }, [refresh]);

  async function open(id: string) {
    setVerdict(await api<Verdict>(`/api/actions/${id}`));
  }

  async function run(claimId: string) {
    const v = await api<Verdict>("/api/run", {
      method: "POST",
      body: JSON.stringify({ claim_id: claimId, use_case: useCase, jurisdiction: jur }),
    });
    setVerdict(v);
    refresh();
  }

  const traps = useMemo(() => claims.filter((c) => c.trap), [claims]);
  const clean = useMemo(() => claims.filter((c) => !c.trap), [claims]);

  const commands: Command[] = useMemo(() => {
    const cs: Command[] = [
      { id: "t1", group: "Navigate", label: "Action stream", keys: "1", run: () => setTab("stream") },
      { id: "t2", group: "Navigate", label: "Flight recorder", keys: "2", run: () => setTab("recorder") },
      { id: "t3", group: "Navigate", label: "Review queue", keys: "3", run: () => setTab("queue") },
      { id: "t4", group: "Navigate", label: "Trust report", keys: "4", run: () => setTab("trust") },
      { id: "b8", group: "Run", label: "Run a batch of 8 claims", keys: "B",
        run: () => api("/api/run/batch", { method: "POST", body: JSON.stringify({ n: 8, use_case: useCase, jurisdiction: jur, concurrency: 3 }) }) },
      { id: "surge", group: "Run", label: "Surge — 3x volume over the whole claim set", keys: "S",
        run: () => api("/api/run/batch", { method: "POST", body: JSON.stringify({ n: 22, use_case: useCase, jurisdiction: jur, concurrency: 3, surge: true }) }) },
      { id: "eval", group: "Run", label: "Run the full evaluation (precision / recall / FP / FN)",
        run: () => api("/api/report/run", { method: "POST" }) },
      { id: "recal", group: "Learn", label: "Recalibrate τ from labelled verdicts",
        hint: "split-conformal", run: () => api("/api/learning/recalibrate", { method: "POST" }) },
      { id: "verify", group: "Audit", label: "Verify the ledger chain",
        run: async () => { const v: any = await api("/api/ledger/verify");
          push(v.ok ? `Chain verified · ${v.entries} entries` : `CHAIN BROKEN at #${v.first_bad_seq}`, v.ok ? "ok" : "bad"); } },
      { id: "reset", group: "Audit", label: "Reset the demo", hint: "reseeds the insurer, clears the ledger",
        run: async () => { await api("/api/demo/reset", { method: "POST" }); push("Demo reset"); refresh(); } },
    ];
    (state?.use_cases ?? []).forEach((u: string) =>
      cs.push({ id: `uc-${u}`, group: "Autonomy dial", label: `Use case → ${u}`, run: () => { setUseCase(u); push(`Use case: ${u}`); } }));
    ["EU", "IN"].forEach((j) =>
      cs.push({ id: `j-${j}`, group: "Autonomy dial", label: `Jurisdiction → ${j === "EU" ? "EU · AI Act" : "India · DPDP"}`,
                run: () => { setJur(j); push(`Jurisdiction: ${j}`); } }));
    claims.forEach((c: any) =>
      cs.push({ id: `c-${c.id}`, group: c.trap ? "Govern a planted failure" : "Govern a clean claim",
                label: `${c.id} — ${c.trap ? c.trap.replace(/_/g, " ") : c.description?.slice(0, 46)}`,
                hint: `${Math.round(c.amount_claimed)} ${c.currency}`, run: () => run(c.id) }));
    return cs;
  }, [claims, state, useCase, jur, push, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setPaletteOpen((o) => !o); return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const list = tab === "queue" ? queue : actions;
      if (e.key === "1") setTab("stream");
      if (e.key === "2") setTab("recorder");
      if (e.key === "3") setTab("queue");
      if (e.key === "4") setTab("trust");
      if (e.key.toLowerCase() === "b") commands.find((c) => c.id === "b8")?.run();
      if (e.key.toLowerCase() === "s") commands.find((c) => c.id === "surge")?.run();
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((n) => { const v = Math.min(list.length - 1, n + 1); if (list[v]) open(list[v].id); return v; });
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((n) => { const v = Math.max(0, n - 1); if (list[v]) open(list[v].id); return v; });
      }
      if (e.key === "Enter" && list[cursor]) { open(list[cursor].id); setTab(tab === "queue" ? "queue" : "recorder"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, actions, queue, cursor, commands]);

  return (
    <div className="h-screen flex flex-col" style={{ background: "var(--ground)" }}>
      <StatusBar state={state} tab={tab} setTab={setTab} connected={connected}
                 onCommand={() => setPaletteOpen(true)} />
      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} commands={commands} />
      <Toasts toasts={toasts} dismiss={dismiss} />

      <main className="flex-1 min-h-0">
        {tab === "stream" && (
          <div className="h-full grid gap-2 p-2 min-h-0" style={{ gridTemplateColumns: "268px 1fr 300px" }}>
            <div className="flex flex-col gap-2 min-h-0">
              <Panel title="Autonomy dial">
                <div style={{ fontSize: 11, color: "var(--ink-2)", marginBottom: 8 }}>
                  The same action is governed differently depending on which system asked
                  and which regulator is watching.
                </div>
                <Label className="mb-1">use case</Label>
                {(state?.use_cases ?? []).map((u: string) => (
                  <button key={u} onClick={() => setUseCase(u)}
                          className="w-full text-left px-2 py-1 mb-1"
                          style={{
                            border: `1px solid ${useCase === u ? "var(--brand)" : "var(--rule)"}`,
                            borderRadius: 2, fontSize: 11,
                            background: useCase === u ? "var(--panel-2)" : "transparent",
                          }}>
                    {u}
                  </button>
                ))}
                <Label className="mb-1 mt-2">jurisdiction</Label>
                <div className="flex gap-1">
                  {["EU", "IN"].map((j) => (
                    <button key={j} onClick={() => setJur(j)}
                            className="flex-1 py-1 mono"
                            style={{
                              border: `1px solid ${jur === j ? "var(--brand)" : "var(--rule)"}`,
                              borderRadius: 2, fontSize: 11,
                              background: jur === j ? "var(--panel-2)" : "transparent",
                            }}>
                      {j === "EU" ? "EU · AI Act" : "IN · DPDP"}
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title="Planted failure modes" pad={false} className="min-h-0">
                {traps.map((c) => <ClaimRow key={c.id} c={c} onRun={run} />)}
              </Panel>

              <Panel title="Clean claims" pad={false} className="min-h-0">
                {clean.map((c) => <ClaimRow key={c.id} c={c} onRun={run} />)}
              </Panel>
            </div>

            <Panel
              title="Action stream"
              pad={false}
              right={
                <div className="flex gap-1.5">
                  <button onClick={() => api("/api/run/batch", {
                            method: "POST",
                            body: JSON.stringify({ n: 8, use_case: useCase, jurisdiction: jur, concurrency: 3 }),
                          })}
                          className="label px-2 py-0.5 border" style={{ borderColor: "var(--rule)" }}>
                    run batch · 8
                  </button>
                  <button onClick={() => api("/api/run/batch", {
                            method: "POST",
                            body: JSON.stringify({ n: 22, use_case: useCase, jurisdiction: jur, concurrency: 3, surge: true }),
                          })}
                          className="label px-2 py-0.5 border" style={{ borderColor: "var(--human)", color: "var(--human)" }}>
                    surge · 3×
                  </button>
                  <button onClick={async () => { await api("/api/demo/reset", { method: "POST" }); refresh(); }}
                          className="label px-2 py-0.5 border" style={{ borderColor: "var(--rule)", color: "var(--ink-3)" }}>
                    reset
                  </button>
                </div>
              }
            >
              <ActionStream actions={actions} selected={verdict?.id} running={running}
                            onSelect={(a) => { open(a.id); setTab("recorder"); }} />
            </Panel>

            <div className="flex flex-col gap-2 min-h-0 overflow-auto">
              <Panel title="Autonomy posture">
                <LaneGauge counts={state?.lane_counts ?? {}} total={state?.actions_today ?? 0} />
                <div className="mt-3 pt-2 border-t grid grid-cols-2 gap-2" style={{ borderColor: "var(--rule)" }}>
                  <Stat k="actions" v={state?.actions_today ?? 0} />
                  <Stat k="awaiting human" v={state?.queue_pending ?? 0}
                        color={(state?.queue_pending ?? 0) > 0 ? "var(--human)" : undefined} />
                  <Stat k="money moved" v={fmtMoney(state?.money_moved ?? 0, "EUR")} />
                  <Stat k="ledger entries" v={state?.ledger?.seq ?? 0} />
                </div>
              </Panel>

              <Panel title="Live checks">
                {running.length === 0 && (
                  <div className="label" style={{ color: "var(--ink-3)" }}>Idle. No action in flight.</div>
                )}
                {running.map((r) => (
                  <div key={r.claim_id} className="mb-2">
                    <div className="flex justify-between mono" style={{ fontSize: 11 }}>
                      <span>{r.claim_id}</span>
                      <span style={{ color: "var(--ink-3)" }}>{r.checks}/6</span>
                    </div>
                    <div className="mt-1 flex gap-[2px]">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <span key={i} style={{
                          flex: 1, height: 3,
                          background: i < r.checks ? "var(--pass)" : "var(--rule)",
                        }} />
                      ))}
                    </div>
                  </div>
                ))}
              </Panel>

              <Panel title="Model roster">
                {Object.entries(state?.models ?? {}).map(([role, m]: any) => (
                  <div key={role} className="flex items-baseline justify-between py-[3px]">
                    <span className="label">{role.replace(/_/g, " ")}</span>
                    <span className="mono text-right" style={{ fontSize: 10 }}>
                      {m.model.split("/").pop()}
                      <span style={{ color: "var(--ink-3)" }}> · {m.vendor}</span>
                    </span>
                  </div>
                ))}
              </Panel>
            </div>
          </div>
        )}

        {tab === "recorder" && <FlightRecorder v={verdict} />}
        {tab === "queue" && (
          <ReviewQueue queue={queue} verdict={verdict} onOpen={open}
                       onDecided={() => { refresh(); setVerdict(null); }} />
        )}
        {tab === "trust" && <TrustReport state={state} onReload={refresh} />}
      </main>
    </div>
  );
}

function ClaimRow({ c, onRun }: { c: any; onRun: (id: string) => void }) {
  return (
    <button onClick={() => onRun(c.id)}
            className="w-full text-left px-2.5 py-1.5 border-b block"
            style={{ borderColor: "var(--rule-soft)" }}>
      <div className="flex items-center justify-between">
        <span className="mono" style={{ fontSize: 11 }}>{c.id}</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
          {Math.round(c.amount_claimed)} {c.currency}
        </span>
      </div>
      <div className="label truncate" style={{ color: c.trap ? "var(--human)" : "var(--ink-3)" }}>
        {c.trap ? c.trap.replace(/_/g, " ") : c.product}
      </div>
    </button>
  );
}

function Stat({ k, v, color }: { k: string; v: React.ReactNode; color?: string }) {
  return (
    <div>
      <div className="label">{k}</div>
      <div className="mono" style={{ fontSize: 15, color: color ?? "var(--ink)" }}>{v}</div>
    </div>
  );
}
