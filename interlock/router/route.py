"""Risk router — graduated autonomy.

Five lanes, thresholds read from the policy pack (never hard-coded):
  AUTO      execute now, under the conformal error ceiling
  EDIT      execute a SAFE-MODIFIED action (clamp to limit, redact PII)
  TWO_KEY   a second, independent model on a second API key must concur
  HUMAN     staged for a clinician-equivalent reviewer with evidence laid out
  BLOCK     fail-closed; never executes
"""
from __future__ import annotations

import re

from ..agent.contract import IntentContract
from ..mesh.checks import PII_PATTERNS


def _redact(text: str) -> tuple[str, list[str]]:
    hits = []
    out = text
    for name, rx in PII_PATTERNS:
        if rx.search(out):
            hits.append(name)
            out = rx.sub(f"[{name} redacted]", out)
    return out, hits


def route(ic: IntentContract, risk: dict, checks: list, pol: dict, ctx: dict) -> dict:
    th = pol["thresholds"]
    score = risk["overall"]
    claim = ctx["claim"]
    cur = claim["currency"]
    reasons: list[str] = []
    edits: list[dict] = []
    by = {c.name: c for c in checks}

    sp = by.get("static_policy")
    rules = sp.evidence.get("rules", []) if sp else []
    broken = {r["id"] for r in rules if not r["ok"]}

    # Entities that do not exist → never execute, no amount of confidence helps.
    if {"R01", "R02"} & broken:
        return {"lane": "BLOCK", "reason": "action references entities absent from the system of record",
                "edits": [], "policy_basis": pol.get("regulatory_basis", ""), "score": score}

    if by.get("prompt_guard") and by["prompt_guard"].score >= 0.6:
        return {"lane": "BLOCK", "reason": "prompt injection detected in source material; fail-closed",
                "edits": [], "policy_basis": pol.get("regulatory_basis", ""), "score": score}

    if "R06" in broken:
        return {"lane": "BLOCK", "reason": "duplicate settlement for an incident already paid",
                "edits": [], "policy_basis": pol.get("regulatory_basis", ""), "score": score}

    # ---- jurisdiction mandate: adverse/automated decisions needing a human ----
    # (EU AI Act Art.14, GDPR Art.22). Ranked AFTER fail-closed BLOCKs: an action that
    # must never execute should not be put in front of a reviewer as if it were viable.
    if ic.action in pol.get("require_human_for", []):
        return {"lane": "HUMAN", "mandated": True,
                "reason": f"jurisdiction {pol['jurisdiction']} requires human sign-off for {ic.action}",
                "edits": [], "policy_basis": pol.get("regulatory_basis", ""), "score": score}

    # ---- EDIT lane: a safe, mechanical repair makes the action compliant ------
    er = pol.get("edit_rules", {})
    repaired = dict(ic.params)
    if er.get("clamp_to_coverage_limit") and "R03" in broken and ctx["policy"]:
        lim = float(ctx["policy"]["coverage_limit"])
        edits.append({"field": "amount", "from": ic.amount, "to": lim,
                      "rule": "R03 clamp to coverage limit"})
        repaired["amount"] = lim
    if er.get("redact_pii_in_payload") and "R09" in broken:
        note = str(ic.params.get("note", ""))
        red, hits = _redact(note)
        if hits:
            edits.append({"field": "note", "from": note, "to": red,
                          "rule": f"R09 redact {', '.join(hits)}"})
            repaired["note"] = red

    residual = {"R03", "R09"} if edits else set()
    remaining = broken - residual
    hard_remaining = any(r["weight"] >= 1.0 for r in rules if r["id"] in remaining)

    if edits and not hard_remaining and score <= th["edit_max"]:
        return {"lane": "EDIT", "reason": "action repaired to comply with policy, then executed",
                "edits": edits, "repaired_params": repaired,
                "policy_basis": pol.get("regulatory_basis", ""), "score": score}

    # ---- amount ceiling for unattended execution ------------------------------
    cap = float(pol.get("max_auto_amount", {}).get(cur, 0) or 0)
    over_cap = ic.action == "approve_payout" and ic.amount > cap

    if score <= th["auto_max"] and not over_cap:
        return {"lane": "AUTO", "reason": f"risk {score:.2f} ≤ τ {th['auto_max']}", "edits": [],
                "policy_basis": pol.get("regulatory_basis", ""), "score": score}

    if over_cap and score <= th["two_key_max"]:
        reasons.append(f"amount {ic.amount:.0f} {cur} exceeds unattended cap {cap:.0f}")
    if score <= th["two_key_max"]:
        reasons.append(f"risk {score:.2f} in two-key band")
        return {"lane": "TWO_KEY", "reason": "; ".join(reasons), "edits": edits,
                "repaired_params": repaired if edits else None,
                "policy_basis": pol.get("regulatory_basis", ""), "score": score}

    if score <= th["human_max"]:
        return {"lane": "HUMAN", "reason": f"risk {score:.2f} above two-key band; evidence staged",
                "edits": edits, "policy_basis": pol.get("regulatory_basis", ""), "score": score}

    return {"lane": "BLOCK", "reason": f"risk {score:.2f} above block threshold {th['human_max']}",
            "edits": [], "policy_basis": pol.get("regulatory_basis", ""), "score": score}
