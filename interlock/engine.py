"""Interlock engine — one governed action, end to end.

  intent contract → verification mesh (parallel) → risk fusion → router
  → [two-key] → executor → ledger

Emits events through an optional async callback so the UI can watch it happen live.
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from . import policy as policy_mod
from .agent.claims_agent import decide
from .ledger import chain
from .llm import MODELS, Usage
from .mesh.checks import run_mesh
from .mesh.fusion import fuse
from .retrieval import fetch
from .router import executor, two_key
from .router.route import route

_SEQ = 0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _mask(name: str) -> str:
    return " ".join((p[0] + "•" * max(0, len(p) - 1)) for p in (name or "").split()) or "—"


async def run_action(claim_id: str, use_case: str = "claims-settlement", jurisdiction: str = "EU",
                     *, emit=None, agent_profile: str = "throughput", cohort_gap: float = 0.0,
                     dry_run: bool = False) -> dict:
    global _SEQ
    _SEQ += 1
    aid = f"act_{uuid.uuid4().hex[:8]}"
    t_start = time.perf_counter()
    usage = Usage()
    pol = policy_mod.get(use_case, jurisdiction)
    ctx = fetch(claim_id)
    claim, customer = ctx["claim"], ctx["customer"]
    timeline = [{"t_ms": 0, "event": "action_received", "detail": claim_id}]

    async def ev(kind, **kw):
        if emit:
            await emit({"type": kind, "action_id": aid, **kw})

    await ev("action_started", claim_id=claim_id, use_case=use_case,
             jurisdiction=jurisdiction, ts=_now())

    # 1 — the untrusted controller declares its plan
    ic = await decide(claim, ctx["policy"], ctx["clauses"], customer,
                      usage=usage, profile=agent_profile)
    timeline.append({"t_ms": ic.latency_ms, "event": "intent_contract_declared",
                     "detail": f"{ic.action} {ic.amount:.0f}"})
    await ev("intent", intent=_intent_dict(ic))

    # 2 — verification mesh, all checks concurrent
    t_mesh = time.perf_counter()

    async def on_check(c):
        timeline.append({"t_ms": ic.latency_ms + c.ended_ms, "event": f"check:{c.name}",
                         "detail": f"{c.status} {c.score:.2f}"})
        await ev("check_done", check=c.dict())

    checks = await run_mesh(ic, ctx, pol, usage, on_check=on_check)
    mesh_ms = int((time.perf_counter() - t_mesh) * 1000)

    # 3 — fusion
    risk = fuse(checks, pol, ctx, cohort_gap=cohort_gap)

    # 4 — route
    r = route(ic, risk, checks, pol, ctx)
    timeline.append({"t_ms": int((time.perf_counter() - t_start) * 1000),
                     "event": f"routed:{r['lane']}", "detail": r["reason"]})

    # 5 — two key
    tk = None
    if r["lane"] == "TWO_KEY":
        tk = await two_key.concur(ic, ctx, pol, usage)
        timeline.append({"t_ms": int((time.perf_counter() - t_start) * 1000),
                         "event": "two_key", "detail": "concur" if tk["concur"] else "disagree"})
        await ev("two_key", two_key=tk)
        if not tk["concur"]:
            if tk.get("same_action") and ic.action == "approve_payout" and tk.get("amount", 0) > 0:
                # Both keys turned; they differ only on how much. Settling on the LOWER
                # figure is strictly safer than either escalating (alert fatigue) or
                # taking the higher one (leakage), and the disagreement is on the record.
                lo = min(ic.amount, float(tk["amount"]))
                r = {**r, "lane": "EDIT",
                     "reason": r["reason"] + f"; keys concur on action, differ on amount "
                                             f"({ic.amount:.0f} vs {tk['amount']:.0f}) → "
                                             f"settled at the more conservative {lo:.0f}",
                     "edits": (r.get("edits") or []) + [{
                         "field": "amount", "from": ic.amount, "to": lo,
                         "rule": "two-key conservative reconciliation"}],
                     "repaired_params": {**ic.params, "amount": lo}}
                tk["reconciled_to"] = lo
            else:
                r = {**r, "lane": "HUMAN",
                     "reason": r["reason"] + f"; second key proposed a different action "
                                             f"({tk.get('decision')}) → escalated"}

    # 6 — execute
    exec_action, exec_params = ic.action, dict(ic.params)
    if r["lane"] == "EDIT" and r.get("repaired_params"):
        exec_params = r["repaired_params"]
    exec_lane = "AUTO" if r["lane"] in ("AUTO", "EDIT", "TWO_KEY") else r["lane"]
    execution = executor.execute(aid, exec_action, exec_params, ctx, exec_lane, dry_run=dry_run)
    timeline.append({"t_ms": int((time.perf_counter() - t_start) * 1000),
                     "event": f"execution:{execution['status']}",
                     "detail": f"{execution['money_moved']:.0f} {execution['currency']}"})

    total_ms = int((time.perf_counter() - t_start) * 1000)
    within_budget = total_ms <= pol["latency_budget_ms"]

    action = {
        "id": aid, "seq": _SEQ, "ts": _now(), "use_case": use_case, "jurisdiction": jurisdiction,
        "agent_model": MODELS["agent"], "agent_profile": agent_profile,
        "claim_id": claim_id, "customer_masked": _mask(customer["name"] if customer else ""),
        "cohort": claim.get("cohort"), "action": ic.action,
        "amount": exec_params.get("amount", ic.amount), "currency": claim["currency"],
        "lane": r["lane"], "overall_risk": risk["overall"], "risk_vector": risk["vector"],
        "checks_failed": sum(1 for c in checks if c.status == "fail"),
        "checks_warned": sum(1 for c in checks if c.status == "warn"),
        "checks_total": len(checks),
        "agent_latency_ms": ic.latency_ms, "mesh_latency_ms": mesh_ms, "total_latency_ms": total_ms,
        "latency_budget_ms": pol["latency_budget_ms"], "within_budget": within_budget,
        "execution_status": execution["status"], "money_moved": execution["money_moved"],
        "ground_truth": {"should_action": claim["truth_action"], "should_amount": claim["truth_amount"],
                         "trap": claim["trap"], "note": claim["truth_note"]},
        "cost_usd": round(usage.cost_usd, 6), "llm_calls": usage.calls,
        "tokens": {"in": usage.in_tok, "out": usage.out_tok},
    }

    verdict = {
        **action,
        "claim": claim, "policy": ctx["policy"], "customer_present": customer is not None,
        "source_trust": {"mean": ctx["mean_trust"], "min": ctx["min_trust"],
                         "clauses": [{"id": c["id"], "source": c["source"], "trust": c["trust"]}
                                     for c in ctx["clauses"]]},
        "intent": _intent_dict(ic), "checks": [c.dict() for c in checks], "risk": risk,
        "route": r, "two_key": tk, "execution": execution, "review": None,
        "timeline": timeline, "usage": {"calls": usage.calls, "in_tok": usage.in_tok,
                                        "out_tok": usage.out_tok, "cost_usd": round(usage.cost_usd, 6),
                                        "by_model": usage.by_model},
        "policy_snapshot": {"use_case": use_case, "jurisdiction": jurisdiction,
                            "thresholds": pol["thresholds"], "tau": pol.get("tau"),
                            "alpha": pol.get("alpha"), "weights": pol.get("weights"),
                            "retention_months": pol["log_retention_months"],
                            "regulatory_basis": pol.get("regulatory_basis", "")},
    }

    entry = chain.append("verdict", {
        "action_id": aid, "claim_id": claim_id, "use_case": use_case, "jurisdiction": jurisdiction,
        "action": ic.action, "amount": action["amount"], "currency": claim["currency"],
        "lane": r["lane"], "risk": risk["overall"], "risk_vector": risk["vector"],
        "checks": [{"name": c.name, "status": c.status, "score": c.score, "latency_ms": c.latency_ms}
                   for c in checks],
        "route_reason": r["reason"], "two_key": tk, "execution_status": execution["status"],
        "money_moved": execution["money_moved"], "models": MODELS,
        "policy": {"thresholds": pol["thresholds"], "tau": pol.get("tau")},
        "total_latency_ms": total_ms, "cost_usd": round(usage.cost_usd, 6),
    })
    verdict["ledger"] = {"seq": entry["seq"], "hash": entry["hash"], "prev_hash": entry["prev_hash"],
                         "signature": entry["signature"][:32] + "…", "signed_by": entry["signed_by"]}
    action["ledger_seq"] = entry["seq"]
    await ev("ledger_appended", entry={"seq": entry["seq"], "hash": entry["hash"][:12],
                                       "lane": r["lane"], "kind": "verdict"})
    await ev("verdict", action=action)
    return verdict


def _intent_dict(ic) -> dict:
    return {"action": ic.action, "params": ic.params,
            "rationale": [{"step": s.step, "text": s.text} for s in ic.rationale],
            "cited_clauses": [{"id": c.id, "source": c.source, "trust": c.trust, "text": c.text}
                              for c in ic.cited_clauses],
            "confidence": ic.confidence, "latency_ms": ic.latency_ms}
