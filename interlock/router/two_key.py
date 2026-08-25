"""Two-Key concurrence.

A second model, from a different family, on a SECOND API key, re-derives the decision
from the same evidence — without seeing what the first agent chose. Both keys must turn
or the action does not execute. This is the team's namesake control.
"""
from __future__ import annotations

import time

from ..agent.contract import IntentContract
from ..llm import MODELS, Usage, chat, parse_json

SYS = """You are an independent claims verifier. You have NOT seen any prior decision.
Decide this claim yourself from the facts and clauses given.
Return ONLY JSON: {"action":"approve_payout"|"deny_claim"|"request_documents"|"escalate",
"amount":<number>,"confidence":0..1,"explanation":"one sentence"}"""


async def concur(ic: IntentContract, ctx: dict, pol: dict, usage: Usage,
                 tolerance: float = 0.10) -> dict:
    claim, policy = ctx["claim"], ctx["policy"]
    cl = "\n".join(f"[{c['id']}] ({c['source']}) {c['text']}" for c in ctx["clauses"])
    user = (f"CLAIM {claim['id']} ({claim['product']})\n"
            f"  incident {claim['incident_date']}, filed {claim['filed_date']}\n"
            f"  claimed {claim['amount_claimed']} {claim['currency']}, "
            f"damage estimate {claim['damage_estimate']}\n"
            f"  description: {claim['description']}\n"
            f"POLICY: {policy['id'] + ' limit ' + str(policy['coverage_limit']) if policy else 'NOT FOUND'}\n"
            f"CLAUSES:\n{cl}\n\nDecide and return the JSON.")
    t0 = time.perf_counter()
    try:
        txt, meta = await chat("second_key", [{"role": "system", "content": SYS},
                                              {"role": "user", "content": user}],
                               temperature=0.0, max_tokens=400, usage=usage)
        d = parse_json(txt)
        action = str(d.get("action", "escalate"))
        amount = float(d.get("amount", 0) or 0)
        same_action = action == ic.action
        amt_ok = True
        if ic.action == "approve_payout":
            base = max(ic.amount, 1.0)
            amt_ok = abs(amount - ic.amount) / base <= tolerance
        return {"model": meta["model"], "vendor": meta.get("vendor", "groq"),
                "key": "secondary", "decision": action, "amount": amount,
                "concur": bool(same_action and amt_ok), "same_action": same_action,
                "amount_within_tolerance": amt_ok, "tolerance": tolerance,
                "confidence": float(d.get("confidence", 0.5)),
                "explanation": d.get("explanation", ""),
                "latency_ms": int((time.perf_counter() - t0) * 1000)}
    except Exception as e:  # noqa: BLE001
        return {"model": MODELS["second_key"], "key": "secondary", "decision": None, "amount": 0.0,
                "concur": False, "error": str(e), "tolerance": tolerance,
                "latency_ms": int((time.perf_counter() - t0) * 1000),
                "explanation": "second key unavailable — fail-closed"}
