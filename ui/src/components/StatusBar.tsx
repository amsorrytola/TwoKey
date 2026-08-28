"use client";

import { useEffect, useState } from "react";

/**
 * Persistent instrument strip. Reads like an aircraft status line: what is being
 * governed, under which policy, how much is queued, and whether the flight recorder
 * still verifies.
 *
 * Spacing here is set with explicit inline styles rather than utility classes, because
 * this bar must never collapse into a run-on string if a reset or a utility ordering
 * changes underneath it.
 */
export function StatusBar({
  state, tab, setTab, connected, onCommand,
}: {
  state: any; tab: string; setTab: (t: string) => void; connected: boolean;
  onCommand: () => void;
}) {
  const [theme, setTheme] = useState("dark");
  const [big, setBig] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", big ? "1.2" : "1");
  }, [big]);

  const tabs: [string, string, string][] = [
    ["stream", "Action stream", "1"],
    ["recorder", "Flight recorder", "2"],
    ["queue", "Review queue", "3"],
    ["trust", "Trust report", "4"],
  ];
  const led = state?.ledger;

  return (
    <header
      style={{
        flexShrink: 0,
        borderBottom: "1px solid var(--rule)",
        background: "var(--panel)",
        display: "flex",
        alignItems: "stretch",
        height: 40,
      }}
    >
      {/* mark — Accenture's ">" carried over the wordmark, purple on black */}
      <div
        style={{
          display: "flex", alignItems: "baseline", gap: 7,
          padding: "0 16px", borderRight: "1px solid var(--rule)", flexShrink: 0,
        }}
      >
        <span className="mono" style={{ color: "var(--brand)", fontSize: 17, fontWeight: 700, lineHeight: 1 }}>
          &gt;
        </span>
        <span style={{ fontWeight: 600, letterSpacing: "0.16em", fontSize: 14 }}>INTERLOCK</span>
        <span style={{
          fontSize: 11, textTransform: "uppercase", letterSpacing: "0.09em",
          color: "var(--ink-3)", fontWeight: 500,
        }}>
          runtime assurance
        </span>
      </div>

      {/* tabs */}
      <nav style={{ display: "flex", alignItems: "stretch", gap: 2, paddingLeft: 8, flexShrink: 0 }}>
        {tabs.map(([k, label, key]) => {
          const on = tab === k;
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              title={`${label}  (press ${key})`}
              style={{
                position: "relative",
                display: "flex", alignItems: "center", gap: 7,
                padding: "0 14px",
                fontSize: 13.5,
                whiteSpace: "nowrap",
                color: on ? "var(--ink)" : "var(--ink-2)",
                fontWeight: on ? 500 : 400,
              }}
            >
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)",
                border: "1px solid var(--rule)", borderRadius: 2, padding: "0 4px", lineHeight: 1.6,
              }}>
                {key}
              </span>
              {label}
              {k === "queue" && (state?.queue_pending ?? 0) > 0 && (
                <span className="mono" style={{
                  fontSize: 10, padding: "0 5px", borderRadius: 2,
                  background: "var(--human)", color: "#08080A", fontWeight: 700,
                }}>
                  {state.queue_pending}
                </span>
              )}
              {on && (
                <span style={{
                  position: "absolute", left: 0, right: 0, bottom: 0,
                  height: 2, background: "var(--brand)",
                }} />
              )}
            </button>
          );
        })}
      </nav>

      {/* telemetry */}
      <div
        className="mono"
        style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end",
          gap: 18, padding: "0 14px", fontSize: 11.5, color: "var(--ink-2)",
          overflowX: "auto", whiteSpace: "nowrap",
        }}
      >
        <Item k="policy" v={`${state?.active?.use_case ?? "—"} · ${state?.active?.jurisdiction ?? "—"}`} />
        <Item k="τ" v={(state?.tau ?? 0).toFixed(3)} />
        <Item k="α" v={(state?.alpha ?? 0).toFixed(2)} />
        <Item k="actions" v={state?.actions_today ?? 0} />
        <Item k="queue" v={state?.queue_pending ?? 0} warn={(state?.queue_pending ?? 0) > 0} />

        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Cap>ledger</Cap>
          <span style={{ color: led?.verified ? "var(--pass)" : "var(--fail)" }}>
            {led?.verified ? "✓" : "✕ BREACH"} #{led?.head_hash ?? "—"}
          </span>
        </span>

        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: 1, display: "block",
            background: connected ? "var(--pass)" : "var(--fail)",
          }} />
          <span style={{ color: "var(--ink-3)" }}>{connected ? "live" : "offline"}</span>
        </span>

        <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <Ctl onClick={onCommand} title="Command palette">
            <span style={{ color: "var(--brand)" }}>&gt;</span> ⌘K
          </Ctl>
          <Ctl onClick={() => setBig(!big)} title="Enlarge everything for screen recording"
               active={big}>
            {big ? "PRESENT" : "COMPACT"}
          </Ctl>
          <Ctl onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
            {theme === "dark" ? "LIGHT" : "DARK"}
          </Ctl>
        </span>
      </div>
    </header>
  );
}

function Cap({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em",
      color: "var(--ink-3)", fontWeight: 500,
    }}>
      {children}
    </span>
  );
}

function Item({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Cap>{k}</Cap>
      <span style={{ color: warn ? "var(--human)" : "var(--ink)" }}>{v}</span>
    </span>
  );
}

function Ctl({
  children, onClick, title, active,
}: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: "2px 7px",
        border: `1px solid ${active ? "var(--brand)" : "var(--rule)"}`,
        borderRadius: 2,
        color: active ? "var(--brand)" : "var(--ink-3)",
        fontSize: 11,
        display: "flex", alignItems: "center", gap: 4,
      }}
    >
      {children}
    </button>
  );
}
