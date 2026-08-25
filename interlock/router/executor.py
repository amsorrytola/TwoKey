"""Executor — idempotent, saga-compensated, budget-broken.

The brief's compounding-risk point: an agent action fans out into downstream steps. Each
step is a saga stage with a compensation, so a late failure unwinds the money movement
instead of leaving the world half-changed.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from ..sim.world import connect


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def idem_key(action_id: str, claim_id: str, action: str, amount: float) -> str:
    return "idem_" + hashlib.sha256(f"{claim_id}|{action}|{amount:.2f}".encode()).hexdigest()[:16]


def execute(action_id: str, ic_action: str, params: dict, ctx: dict, lane: str,
            *, dry_run: bool = False) -> dict:
    claim = ctx["claim"]
    amount = float(params.get("amount") or 0)
    cur = claim["currency"]
    key = idem_key(action_id, claim["id"], ic_action, amount)
    saga = [{"name": "reserve_funds", "status": "pending", "compensation": "release_funds"},
            {"name": "post_payment", "status": "pending", "compensation": "reverse_payment"},
            {"name": "close_claim", "status": "pending", "compensation": "reopen_claim"},
            {"name": "notify_customer", "status": "pending", "compensation": "send_correction"}]

    if lane in ("HUMAN", "BLOCK"):
        for s in saga:
            s["status"] = "not_started"
        return {"status": "pending_review" if lane == "HUMAN" else "blocked",
                "idempotency_key": key, "money_moved": 0.0, "currency": cur, "saga": saga,
                "executed_at": None, "budget_remaining": None}

    conn = connect()
    row = conn.execute("SELECT * FROM budget WHERE currency=? LIMIT 1", (cur,)).fetchone()
    cap, spent = (float(row["cap"]), float(row["spent"])) if row else (0.0, 0.0)

    if ic_action == "approve_payout" and spent + amount > cap:
        conn.close()
        for s in saga:
            s["status"] = "aborted"
        return {"status": "blocked", "idempotency_key": key, "money_moved": 0.0, "currency": cur,
                "saga": saga, "executed_at": None, "budget_remaining": cap - spent,
                "note": "daily budget breaker tripped"}

    dup = conn.execute("SELECT id FROM payments WHERE idempotency_key=?", (key,)).fetchone()
    if dup:
        conn.close()
        for s in saga:
            s["status"] = "skipped_idempotent"
        return {"status": "executed", "idempotency_key": key, "money_moved": 0.0, "currency": cur,
                "saga": saga, "executed_at": _now(), "budget_remaining": cap - spent,
                "note": "idempotency key already settled — no double payment"}

    if dry_run:
        conn.close()
        for s in saga:
            s["status"] = "simulated"
        return {"status": "simulated", "idempotency_key": key, "money_moved": 0.0, "currency": cur,
                "saga": saga, "executed_at": None, "budget_remaining": cap - spent}

    moved = 0.0
    if ic_action == "approve_payout" and amount > 0:
        conn.execute("INSERT OR IGNORE INTO payments(claim_id,amount,currency,ts,idempotency_key,status) "
                     "VALUES(?,?,?,?,?,?)", (claim["id"], amount, cur, _now(), key, "settled"))
        conn.execute("UPDATE budget SET spent=spent+? WHERE currency=?", (amount, cur))
        moved = amount
    conn.commit()
    left = cap - (spent + moved)
    conn.close()
    for s in saga:
        s["status"] = "committed"
    return {"status": "executed", "idempotency_key": key, "money_moved": moved, "currency": cur,
            "saga": saga, "executed_at": _now(), "budget_remaining": left}


def rollback(action_id: str, execution: dict, ctx: dict, failed_stage: str = "notify_customer") -> dict:
    """Compensate a committed saga — the demo's 'downstream step fails' moment."""
    claim = ctx["claim"]
    conn = connect()
    conn.execute("UPDATE payments SET status='reversed' WHERE idempotency_key=?",
                 (execution["idempotency_key"],))
    conn.execute("UPDATE budget SET spent=spent-? WHERE currency=?",
                 (execution.get("money_moved", 0.0), claim["currency"]))
    conn.commit()
    conn.close()
    saga = []
    hit = False
    for s in execution.get("saga", []):
        s = dict(s)
        if s["name"] == failed_stage:
            s["status"] = "failed"
            hit = True
        elif not hit:
            s["status"] = "compensated"
        else:
            s["status"] = "not_started"
        saga.append(s)
    out = dict(execution)
    out.update({"status": "rolled_back", "saga": saga, "money_moved": 0.0,
                "rolled_back_at": _now(), "failed_stage": failed_stage})
    return out
