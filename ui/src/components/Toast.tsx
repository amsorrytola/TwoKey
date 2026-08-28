"use client";

import { useEffect, useState } from "react";

export type Toast = { id: number; text: string; tone?: "ok" | "warn" | "bad" };

/** Confirmation that an action landed. Terse, corner-anchored, self-dismissing. */
export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-3 right-3 z-40 flex flex-col gap-1.5 items-end">
      {toasts.map((t) => (
        <Item key={t.id} t={t} dismiss={dismiss} />
      ))}
    </div>
  );
}

function Item({ t, dismiss }: { t: Toast; dismiss: (id: number) => void }) {
  useEffect(() => {
    const h = setTimeout(() => dismiss(t.id), 4000);
    return () => clearTimeout(h);
  }, [t.id, dismiss]);
  const c = t.tone === "bad" ? "var(--fail)" : t.tone === "warn" ? "var(--warn)" : "var(--brand)";
  return (
    <button
      onClick={() => dismiss(t.id)}
      className="panel px-3 py-1.5 land text-left"
      style={{ borderLeft: `2px solid ${c}`, maxWidth: 380 }}
    >
      <span style={{ fontSize: 11 }}>{t.text}</span>
    </button>
  );
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (text: string, tone?: Toast["tone"]) =>
    setToasts((ts) => [...ts.slice(-3), { id: Date.now() + Math.random(), text, tone }]);
  const dismiss = (id: number) => setToasts((ts) => ts.filter((x) => x.id !== id));
  return { toasts, push, dismiss };
}
