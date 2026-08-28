"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type Command = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  keys?: string;
  run: () => void | Promise<void>;
};

/**
 * ⌘K palette. An operator console is judged on how fast a practised user moves
 * through it, and every command here is also reachable by mouse — the palette
 * accelerates the workflow, it never hides it.
 */
export function CommandPalette({
  open, setOpen, commands,
}: { open: boolean; setOpen: (b: boolean) => void; commands: Command[] }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return commands;
    return commands.filter((c) =>
      (c.label + " " + c.group + " " + (c.hint ?? "")).toLowerCase().includes(t));
  }, [q, commands]);

  useEffect(() => { if (open) { setQ(""); setI(0); setTimeout(() => inputRef.current?.focus(), 10); } }, [open]);
  useEffect(() => { setI(0); }, [q]);

  if (!open) return null;

  const grouped: Record<string, Command[]> = {};
  hits.forEach((c) => { (grouped[c.group] ||= []).push(c); });
  const flat = Object.values(grouped).flat();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={() => setOpen(false)}
    >
      <div
        className="panel w-[560px] max-h-[62vh] flex flex-col"
        style={{ borderColor: "var(--brand)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 h-10 border-b shrink-0" style={{ borderColor: "var(--rule)" }}>
          <span className="mono" style={{ color: "var(--brand)", fontSize: 13 }}>&gt;</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowDown") { e.preventDefault(); setI((n) => Math.min(flat.length - 1, n + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
              if (e.key === "Enter" && flat[i]) { setOpen(false); flat[i].run(); }
            }}
            placeholder="Run a command — govern a claim, switch jurisdiction, recalibrate…"
            className="flex-1 bg-transparent"
            style={{ fontSize: 13 }}
          />
          <span className="kbd">esc</span>
        </div>

        <div className="overflow-auto flex-1">
          {flat.length === 0 && (
            <div className="p-4 label" style={{ color: "var(--ink-3)" }}>
              No command matches “{q}”.
            </div>
          )}
          {Object.entries(grouped).map(([group, cs]) => (
            <div key={group}>
              <div className="label px-3 pt-2 pb-1">{group}</div>
              {cs.map((c) => {
                const idx = flat.indexOf(c);
                const on = idx === i;
                return (
                  <button
                    key={c.id}
                    onMouseEnter={() => setI(idx)}
                    onClick={() => { setOpen(false); c.run(); }}
                    className="w-full text-left px-3 py-1.5 flex items-center gap-3"
                    style={{
                      background: on ? "var(--brand-dim)" : undefined,
                      boxShadow: on ? "inset 2px 0 0 var(--brand)" : undefined,
                    }}
                  >
                    <span style={{ fontSize: 12, flex: 1 }}>{c.label}</span>
                    {c.hint && <span className="label" style={{ color: "var(--ink-3)" }}>{c.hint}</span>}
                    {c.keys && <span className="kbd">{c.keys}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 px-3 h-7 border-t shrink-0 label"
             style={{ borderColor: "var(--rule)" }}>
          <span><span className="kbd">↑↓</span> navigate</span>
          <span><span className="kbd">↵</span> run</span>
          <span className="ml-auto">{flat.length} commands</span>
        </div>
      </div>
    </div>
  );
}
