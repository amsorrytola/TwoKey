"""Risk fusion — checks → a 4-axis risk VECTOR, not a single opaque number.

The brief notes that bias, hallucination and privacy risks overlap in practice. A scalar
hides that. Interlock reports four axes plus a policy-weighted scalar used for routing:
  hallucination  fabricated facts / unsupported reasoning
  privacy        PII exposure in the outbound action
  bias           cohort-level disparity signal (drift sentinel feeds this)
  blast_radius   how much and how irreversibly the world changes
"""
from __future__ import annotations

from .checks import CheckResult


def fuse(checks: list[CheckResult], pol: dict, ctx: dict, cohort_gap: float = 0.0) -> dict:
    by = {c.name: c for c in checks}
    g = lambda n: by[n].score if n in by else 0.0  # noqa: E731

    hallucination = max(0.55 * g("evidence_nli") + 0.45 * g("semantic_entropy"),
                        0.9 if by.get("static_policy") and not next(
                            (r["ok"] for r in by["static_policy"].evidence.get("rules", [])
                             if r["id"] in ("R01", "R02")), True) else 0.0)
    hallucination = max(hallucination, g("trace_auditor") * 0.7)

    sp = by.get("static_policy")
    pii = bool(sp and sp.evidence.get("pii_found"))
    privacy = max(0.75 if pii else 0.0, 0.4 * g("prompt_guard"))

    bias = min(1.0, cohort_gap * 4.0)  # 0.25 cohort gap saturates

    blast = g("consequence_sim")

    w = pol.get("weights", {})
    overall = sum(w.get(c.name, 0.0) * c.score for c in checks)
    denom = sum(w.get(c.name, 0.0) for c in checks) or 1.0
    overall = overall / denom

    # A deterministic hard fail cannot be averaged away by soft checks passing.
    hard = bool(sp and sp.evidence.get("hard_fail"))
    if hard:
        overall = max(overall, 0.88)
    if g("prompt_guard") >= 0.6:
        overall = max(overall, 0.80)

    # Low-trust evidence inflates risk proportionally (governed vs loose sources).
    mean_trust = ctx.get("mean_trust", 1.0)
    trust_penalty = max(0.0, (1.0 - mean_trust)) * 0.25
    overall = min(1.0, overall + trust_penalty)

    return {
        "vector": {"hallucination": round(min(1.0, hallucination), 3),
                   "privacy": round(min(1.0, privacy), 3),
                   "bias": round(min(1.0, bias), 3),
                   "blast_radius": round(min(1.0, blast), 3)},
        "overall": round(overall, 3),
        "hard_fail": hard,
        "tau": pol.get("tau"),
        "alpha": pol.get("alpha"),
        "source_trust": {"mean": mean_trust, "min": ctx.get("min_trust", 1.0),
                         "penalty_applied": round(trust_penalty, 3)},
        "weights": w,
        "contributions": {c.name: round(w.get(c.name, 0.0) * c.score / denom, 4) for c in checks},
    }
