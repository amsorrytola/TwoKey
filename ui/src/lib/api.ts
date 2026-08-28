export const API = process.env.NEXT_PUBLIC_API ?? "http://localhost:8000";
export const WS = API.replace(/^http/, "ws") + "/ws";

export type Lane = "AUTO" | "EDIT" | "TWO_KEY" | "HUMAN" | "BLOCK";

export const LANES: Lane[] = ["AUTO", "EDIT", "TWO_KEY", "HUMAN", "BLOCK"];

export const laneColor: Record<Lane, string> = {
  AUTO: "var(--auto)",
  EDIT: "var(--edit)",
  TWO_KEY: "var(--two-key)",
  HUMAN: "var(--human)",
  BLOCK: "var(--block)",
};

export const laneLabel: Record<Lane, string> = {
  AUTO: "AUTO",
  EDIT: "EDIT",
  TWO_KEY: "TWO-KEY",
  HUMAN: "HUMAN",
  BLOCK: "BLOCK",
};

export const statusColor: Record<string, string> = {
  pass: "var(--pass)",
  warn: "var(--warn)",
  fail: "var(--fail)",
};

export type RiskVector = {
  hallucination: number;
  privacy: number;
  bias: number;
  blast_radius: number;
};

export type ActionSummary = {
  id: string; seq: number; ts: string;
  use_case: string; jurisdiction: string;
  agent_model: string; agent_profile: string;
  claim_id: string; customer_masked: string; cohort: string;
  action: string; amount: number; currency: string;
  lane: Lane; overall_risk: number; risk_vector: RiskVector;
  checks_failed: number; checks_warned: number; checks_total: number;
  agent_latency_ms: number; mesh_latency_ms: number; total_latency_ms: number;
  latency_budget_ms: number; within_budget: boolean;
  execution_status: string; money_moved: number;
  ground_truth: { should_action: string; should_amount: number; trap: string | null; note: string };
  cost_usd: number; llm_calls: number; ledger_seq: number;
  route_reason?: string; edits?: number; two_key_concur?: boolean | null;
  review?: Record<string, unknown> | null;
};

export type Check = {
  name: string; label: string; kind: string;
  status: "pass" | "warn" | "fail";
  score: number; summary: string;
  evidence: Record<string, any>;
  model: string | null;
  started_ms: number; ended_ms: number; latency_ms: number;
  error: string | null;
};

export type Verdict = ActionSummary & {
  claim: any; policy: any; customer_present: boolean;
  source_trust: { mean: number; min: number; clauses: { id: string; source: string; trust: number }[] };
  intent: {
    action: string; params: Record<string, any>;
    rationale: { step: number; text: string }[];
    cited_clauses: { id: string; source: string; trust: number; text: string }[];
    confidence: number; latency_ms: number;
  };
  checks: Check[];
  risk: any; route: any; two_key: any; execution: any; review: any;
  timeline: { t_ms: number; event: string; detail: string }[];
  usage: any; policy_snapshot: any; ledger: any;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export const fmtMoney = (n: number, cur: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n ?? 0);

export const fmtMs = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

export const fmtTime = (iso: string) => (iso ?? "").slice(11, 19);
