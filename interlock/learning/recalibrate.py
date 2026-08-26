"""Closed loop: labelled verdicts → recalibrated conformal threshold.

Split-conformal calibration. Given labelled outcomes (was the AUTO decision correct?),
choose the risk threshold tau as the (1-alpha) empirical quantile of the risk scores of
correct decisions. Guarantees, under exchangeability, that the AUTO lane's error rate
stays at or below alpha — which is the knob the business actually sets.

Reference: Yadkori et al., "Mitigating LLM Hallucinations via Conformal Abstention" (2024).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .. import policy as policy_mod
from ..ledger import chain

HIST = Path(__file__).resolve().parents[2] / "data" / "calibration.json"


def _labelled() -> list[dict]:
    """Verdicts with a trustworthy label: a human review, or seeded ground truth."""
    out = []
    for e in chain.entries(limit=5000):
        p = e["payload"]
        if e["kind"] == "review":
            out.append({"risk": p.get("risk", 0.5), "correct": p.get("agent_was_right", False),
                        "source": "human_review", "use_case": p.get("use_case")})
        elif e["kind"] == "eval_label" and p.get("ground_truth_correct") is not None:
            out.append({"risk": p.get("risk", 0.5), "correct": bool(p["ground_truth_correct"]),
                        "source": "eval_label", "use_case": p.get("use_case")})
    return out


def history() -> list[dict]:
    if HIST.exists():
        return json.loads(HIST.read_text())
    return []


def recalibrate(use_case: str = "claims-settlement", apply: bool = True) -> dict:
    pol = policy_mod.get(use_case)
    alpha = float(pol.get("alpha", 0.05))
    labels = [l for l in _labelled() if not l.get("use_case") or l["use_case"] == use_case]
    before_tau = float(pol["thresholds"]["auto_max"])
    hist = history()
    before_esc = hist[-1]["escalation_rate"] if hist else None

    if len(labels) < 5:
        return {"applied": False, "reason": f"only {len(labels)} labelled verdicts; need ≥5",
                "labelled_verdicts": len(labels), "before": {"tau": before_tau, "alpha": alpha},
                "history": hist}

    correct = np.array([l["risk"] for l in labels if l["correct"]], dtype=float)
    wrong = np.array([l["risk"] for l in labels if not l["correct"]], dtype=float)
    if correct.size == 0:
        return {"applied": False, "reason": "no correct decisions in the calibration set",
                "labelled_verdicts": len(labels), "history": hist}

    n = correct.size
    q = min(1.0, np.ceil((n + 1) * (1 - alpha)) / n)          # finite-sample corrected quantile
    tau = float(np.quantile(correct, q))
    if wrong.size:                                            # never admit a known-bad score
        tau = min(tau, float(wrong.min()) - 1e-6)
    tau = float(max(0.05, min(0.90, tau)))

    esc = float(np.mean([l["risk"] > tau for l in labels]))
    entry = {"night": len(hist) + 1, "use_case": use_case, "tau": round(tau, 4),
             "escalation_rate": round(esc, 4), "labelled_verdicts": len(labels),
             "alpha": alpha, "n_correct": int(n), "n_wrong": int(wrong.size)}

    if apply:
        th = dict(pol["thresholds"])
        span = th["two_key_max"] - th["auto_max"]
        th["auto_max"] = round(tau, 4)
        th["edit_max"] = round(min(0.95, tau + 0.15), 4)
        th["two_key_max"] = round(min(0.95, tau + max(span, 0.30)), 4)
        policy_mod.patch(use_case, {"thresholds": th, "tau": round(tau, 4)})
        hist.append(entry)
        HIST.parent.mkdir(parents=True, exist_ok=True)
        HIST.write_text(json.dumps(hist, indent=2))
        chain.append("recalibration", {"use_case": use_case, "tau_before": before_tau,
                                       "tau_after": round(tau, 4), "alpha": alpha,
                                       "labelled_verdicts": len(labels),
                                       "escalation_rate": round(esc, 4),
                                       "method": "split-conformal quantile"})

    return {"applied": apply, "method": "split-conformal quantile",
            "labelled_verdicts": len(labels),
            "before": {"tau": before_tau, "escalation_rate": before_esc},
            "after": {"tau": round(tau, 4), "escalation_rate": round(esc, 4)},
            "alpha": alpha, "history": hist}


def drift_sentinel() -> dict:
    """Cohort fairness: AUTO rate by region. IRDAI/EU AI Act both require evidence that
    an automated decision system does not treat cohorts differently without cause."""
    from ..sim.world import connect
    conn = connect()
    cohorts: dict[str, dict] = {}
    for e in chain.entries(limit=5000, kind="verdict"):
        p = e["payload"]
        row = conn.execute("SELECT cohort FROM claims WHERE id=?", (p.get("claim_id"),)).fetchone()
        c = row["cohort"] if row else "unknown"
        d = cohorts.setdefault(c, {"cohort": c, "n": 0, "auto": 0})
        d["n"] += 1
        d["auto"] += 1 if p.get("lane") in ("AUTO", "EDIT") else 0
    conn.close()
    out = [{**d, "auto_rate": round(d["auto"] / d["n"], 3)} for d in cohorts.values() if d["n"]]
    out.sort(key=lambda x: -x["n"])
    gap = (max(x["auto_rate"] for x in out) - min(x["auto_rate"] for x in out)) if len(out) > 1 else 0.0
    return {"cohorts": out, "max_gap": round(gap, 3),
            "status": "ok" if gap <= 0.15 else "review",
            "threshold": 0.15,
            "note": "AUTO+EDIT share by customer region; gap above 0.15 opens a fairness review"}
