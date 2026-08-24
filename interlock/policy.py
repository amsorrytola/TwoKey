"""Governance layer: policy packs per use case × jurisdiction.

The brief calls for behaviour that varies by use case, geography and risk appetite,
with a clear audit trail. Everything the router does is driven from these YAML packs —
no thresholds are hard-coded in the engine.
"""
from __future__ import annotations

import copy
from pathlib import Path

import yaml

DIR = Path(__file__).resolve().parents[1] / "policies"
_CACHE: dict[str, dict] = {}


def load_all(force: bool = False) -> dict[str, dict]:
    global _CACHE
    if _CACHE and not force:
        return _CACHE
    packs = {}
    for f in sorted(DIR.glob("*.yaml")):
        d = yaml.safe_load(f.read_text())
        packs[d["use_case"]] = d
    _CACHE = packs
    return packs


def get(use_case: str, jurisdiction: str = "EU") -> dict:
    """Returns the pack with the jurisdiction overrides merged in."""
    packs = load_all()
    if use_case not in packs:
        raise KeyError(f"unknown use case {use_case}; have {list(packs)}")
    p = copy.deepcopy(packs[use_case])
    ov = p.get("jurisdiction_overrides", {}).get(jurisdiction, {})
    p["jurisdiction"] = jurisdiction
    p["require_human_for"] = ov.get("require_human_for", [])
    p["pii_policy"] = ov.get("pii_policy", "strict")
    p["log_retention_months"] = ov.get("log_retention_months", 6)
    p["regulatory_basis"] = ov.get("basis", "")
    return p


def patch(use_case: str, changes: dict) -> dict:
    """Live edit of a pack (the Autonomy Dial in the UI). Persists to YAML."""
    packs = load_all()
    if use_case not in packs:
        raise KeyError(use_case)
    f = DIR / f"{use_case}.yaml"
    d = yaml.safe_load(f.read_text())

    def deep(a: dict, b: dict) -> dict:
        for k, v in b.items():
            if isinstance(v, dict) and isinstance(a.get(k), dict):
                deep(a[k], v)
            else:
                a[k] = v
        return a

    deep(d, changes)
    f.write_text(yaml.safe_dump(d, sort_keys=False))
    load_all(force=True)
    return d
