"""Tests for the parts that must never be wrong: policy, ledger, executor, routing."""
import pytest

from interlock import policy
from interlock.ledger import chain
from interlock.router import executor


def test_policy_packs_load():
    packs = policy.load_all()
    assert {"claims-settlement", "customer-support", "internal-copilot"} <= set(packs)


def test_jurisdiction_overrides_change_behaviour():
    eu = policy.get("claims-settlement", "EU")
    inn = policy.get("claims-settlement", "IN")
    assert "deny_claim" in eu["require_human_for"]
    assert "deny_claim" not in inn["require_human_for"]
    assert eu["log_retention_months"] == 6      # EU AI Act Art.12 minimum
    assert inn["pii_policy"] == "dpdp"


def test_use_cases_have_different_risk_appetite():
    claims = policy.get("claims-settlement")
    support = policy.get("customer-support")
    assert claims["thresholds"]["auto_max"] < support["thresholds"]["auto_max"]
    assert claims["latency_budget_ms"] > support["latency_budget_ms"]


def test_ledger_chain_detects_tampering(tmp_path, monkeypatch):
    monkeypatch.setattr(chain, "ROOT", tmp_path)
    monkeypatch.setattr(chain, "LOG", tmp_path / "v.jsonl")
    monkeypatch.setattr(chain, "KEY", tmp_path / "k.key")
    for i in range(4):
        chain.append("verdict", {"action_id": f"a{i}", "amount": 100 * i})
    assert chain.verify()["ok"] is True
    chain.tamper(2, "amount", 999999)
    v = chain.verify()
    assert v["ok"] is False and v["first_bad_seq"] == 2


def test_executor_is_idempotent():
    from interlock.sim.world import seed
    seed()
    ctx = {"claim": {"id": "CLM-2005", "currency": "EUR"}}
    a = executor.execute("act_1", "approve_payout", {"amount": 640}, ctx, "AUTO")
    b = executor.execute("act_2", "approve_payout", {"amount": 640}, ctx, "AUTO")
    assert a["money_moved"] == 640
    assert b["money_moved"] == 0          # same idempotency key — no double payment
    assert "idempotency" in b.get("note", "")


def test_budget_breaker_blocks_oversized_payout():
    from interlock.sim.world import seed
    seed()
    ctx = {"claim": {"id": "CLM-2003", "currency": "EUR"}}
    r = executor.execute("act_x", "approve_payout", {"amount": 10_000_000}, ctx, "AUTO")
    assert r["status"] == "blocked"
    assert r["money_moved"] == 0


def test_human_and_block_lanes_never_move_money():
    from interlock.sim.world import seed
    seed()
    ctx = {"claim": {"id": "CLM-2003", "currency": "EUR"}}
    for lane in ("HUMAN", "BLOCK"):
        r = executor.execute("act_y", "approve_payout", {"amount": 1000}, ctx, lane)
        assert r["money_moved"] == 0
        assert r["status"] in ("pending_review", "blocked")


def test_saga_rollback_reverses_money():
    from interlock.sim.world import seed
    seed()
    ctx = {"claim": {"id": "CLM-2005", "currency": "EUR"}}
    ex = executor.execute("act_z", "approve_payout", {"amount": 640}, ctx, "AUTO")
    assert ex["money_moved"] == 640
    rb = executor.rollback("act_z", ex, ctx)
    assert rb["status"] == "rolled_back"
    assert rb["money_moved"] == 0
    assert any(s["status"] == "compensated" for s in rb["saga"])
