"""FastAPI service — the control plane the UI talks to."""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import policy as policy_mod
from .engine import run_action
from .eval import harness
from .ledger import chain
from .learning.recalibrate import drift_sentinel, history, recalibrate
from .llm import MODELS, POOL, VENDOR, aclose
from .router import executor
from .sim.world import connect, seed

ROOT = Path(__file__).resolve().parents[1]
STORE: dict[str, dict] = {}          # action_id -> full verdict (in-memory, demo scope)
ORDER: list[str] = []
_BACKGROUND_TASKS: set[asyncio.Task] = set()  # hold strong refs so fire-and-forget tasks aren't GC'd mid-flight


class Hub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def join(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def leave(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def send(self, msg: dict) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(json.dumps(msg, default=str))
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


HUB = Hub()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not (ROOT / "data" / "insurer.db").exists():
        seed()
    yield
    await aclose()


app = FastAPI(title="Interlock", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _summary(v: dict) -> dict:
    keys = ("id", "seq", "ts", "use_case", "jurisdiction", "agent_model", "agent_profile",
            "claim_id", "customer_masked", "cohort", "action", "amount", "currency", "lane",
            "overall_risk", "risk_vector", "checks_failed", "checks_warned", "checks_total",
            "agent_latency_ms", "mesh_latency_ms", "total_latency_ms", "latency_budget_ms",
            "within_budget", "execution_status", "money_moved", "ground_truth", "cost_usd",
            "llm_calls", "ledger_seq")
    s = {k: v.get(k) for k in keys}
    s["review"] = v.get("review")
    s["route_reason"] = v.get("route", {}).get("reason")
    s["edits"] = len(v.get("route", {}).get("edits") or [])
    s["two_key_concur"] = (v.get("two_key") or {}).get("concur")
    return s


def _state() -> dict:
    acts = [STORE[a] for a in ORDER]
    lanes: dict[str, int] = {}
    for a in acts:
        lanes[a["lane"]] = lanes.get(a["lane"], 0) + 1
    n = len(acts) or 1
    packs = policy_mod.load_all()
    active = policy_mod.get("claims-settlement", "EU")
    lv = chain.verify()
    return {
        "use_cases": list(packs),
        "jurisdictions": ["EU", "IN"],
        "active": {"use_case": "claims-settlement", "jurisdiction": "EU"},
        "tau": active["thresholds"]["auto_max"],
        "alpha": active.get("alpha"),
        "actions_today": len(acts),
        "lane_counts": lanes,
        "lane_split": {k: round(v / n, 3) for k, v in lanes.items()},
        "money_moved": round(sum(a.get("money_moved") or 0 for a in acts if a.get("currency") == "EUR"), 2),
        "queue_pending": sum(1 for a in acts if a["lane"] == "HUMAN" and not a.get("review")),
        "ledger": {"seq": lv["entries"], "head_hash": lv["head_hash"][:12], "verified": lv["ok"],
                   "first_bad_seq": lv["first_bad_seq"]},
        "models": {k: {"model": v, "vendor": VENDOR.get(v, "groq")} for k, v in MODELS.items()},
        "key_pool": POOL.snapshot(),
        "ts": _now(),
    }


@app.get("/api/state")
async def get_state():
    return _state()


@app.get("/api/policies")
async def get_policies():
    return {u: policy_mod.get(u, "EU") for u in policy_mod.load_all()}


class PolicyPatch(BaseModel):
    changes: dict


@app.patch("/api/policies/{use_case}")
async def patch_policy(use_case: str, body: PolicyPatch):
    try:
        d = policy_mod.patch(use_case, body.changes)
    except KeyError:
        raise HTTPException(404, f"unknown use case {use_case}")
    chain.append("policy_change", {"use_case": use_case, "changes": body.changes})
    await HUB.send({"type": "state", "state": _state()})
    return d


@app.get("/api/claims")
async def get_claims():
    conn = connect()
    rows = [dict(r) for r in conn.execute(
        "SELECT c.*, cu.name FROM claims c LEFT JOIN customers cu ON cu.id=c.customer_id ORDER BY c.id").fetchall()]
    paid = {r["claim_id"] for r in conn.execute(
        "SELECT claim_id FROM payments WHERE status='settled'").fetchall()}
    conn.close()
    out = []
    for r in rows:
        nm = r.pop("name", None)
        r["customer_masked"] = " ".join(p[0] + "•" * max(0, len(p) - 1) for p in (nm or "").split()) or "—"
        r["already_settled"] = r["id"] in paid
        out.append(r)
    return out


@app.get("/api/actions")
async def get_actions(limit: int = 100, use_case: str | None = None, lane: str | None = None):
    acts = [STORE[a] for a in reversed(ORDER)]
    if use_case:
        acts = [a for a in acts if a["use_case"] == use_case]
    if lane:
        acts = [a for a in acts if a["lane"] == lane]
    return [_summary(a) for a in acts[:limit]]


@app.get("/api/actions/{action_id}")
async def get_action(action_id: str):
    v = STORE.get(action_id)
    if not v:
        raise HTTPException(404, "unknown action")
    return v


class RunBody(BaseModel):
    claim_id: str
    use_case: str = "claims-settlement"
    jurisdiction: str = "EU"
    agent_profile: str = "throughput"


async def _emit(msg: dict):
    await HUB.send(msg)


@app.post("/api/run")
async def post_run(body: RunBody):
    try:
        v = await run_action(body.claim_id, body.use_case, body.jurisdiction,
                             emit=_emit, agent_profile=body.agent_profile)
    except KeyError:
        raise HTTPException(404, f"unknown claim {body.claim_id}")
    STORE[v["id"]] = v
    ORDER.append(v["id"])
    await HUB.send({"type": "state", "state": _state()})
    return v


class BatchBody(BaseModel):
    claim_ids: list[str] | None = None
    n: int = 10
    use_case: str = "claims-settlement"
    jurisdiction: str = "EU"
    concurrency: int = 3
    surge: bool = False


@app.post("/api/run/batch")
async def post_batch(body: BatchBody):
    ids = body.claim_ids
    if not ids:
        conn = connect()
        ids = [r["id"] for r in conn.execute("SELECT id FROM claims ORDER BY RANDOM() LIMIT ?",
                                             (body.n,)).fetchall()]
        conn.close()
    sem = asyncio.Semaphore(body.concurrency if not body.surge else body.concurrency * 3)

    async def one(cid: str):
        async with sem:
            try:
                v = await run_action(cid, body.use_case, body.jurisdiction, emit=_emit)
                STORE[v["id"]] = v
                ORDER.append(v["id"])
            except Exception as e:  # noqa: BLE001
                await HUB.send({"type": "error", "claim_id": cid, "detail": str(e)})

    async def runner():
        await HUB.send({"type": "batch_started", "n": len(ids), "surge": body.surge})
        await asyncio.gather(*[one(c) for c in ids])
        await HUB.send({"type": "batch_done", "n": len(ids)})
        await HUB.send({"type": "state", "state": _state()})

    task = asyncio.create_task(runner())
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    return {"started": len(ids), "claim_ids": ids, "surge": body.surge,
            "concurrency": body.concurrency * (3 if body.surge else 1)}


@app.get("/api/queue")
async def get_queue():
    return [_summary(STORE[a]) for a in reversed(ORDER)
            if STORE[a]["lane"] == "HUMAN" and not STORE[a].get("review")]


class Decision(BaseModel):
    decision: str                 # approve | override_deny | override_amount
    amount: float | None = None
    reason: str
    reviewer: str = "R. Sidana"


@app.post("/api/queue/{action_id}/decide")
async def decide(action_id: str, body: Decision):
    v = STORE.get(action_id)
    if not v:
        raise HTTPException(404, "unknown action")
    if v.get("review"):
        raise HTTPException(409, "already reviewed")
    ctx = {"claim": v["claim"]}
    if body.decision == "approve":
        params = dict(v["intent"]["params"])
        ex = executor.execute(action_id, v["intent"]["action"], params, ctx, "AUTO")
        status = "overridden_executed"
        agent_was_right = True
    elif body.decision == "override_amount":
        params = dict(v["intent"]["params"]); params["amount"] = body.amount or 0
        ex = executor.execute(action_id, "approve_payout", params, ctx, "AUTO")
        status = "overridden_executed"
        agent_was_right = False
    else:
        ex = {**v["execution"], "status": "held", "money_moved": 0.0}
        status = "overridden_denied"
        agent_was_right = False

    review = {"decision": body.decision, "amount": body.amount, "reason": body.reason,
              "reviewer": body.reviewer, "ts": _now(),
              "time_to_decision_s": None}
    v["review"] = review
    v["execution"] = {**ex, "status": status if body.decision != "override_deny" else "held"}
    v["execution_status"] = v["execution"]["status"]
    v["money_moved"] = ex.get("money_moved", 0.0)

    e = chain.append("review", {
        "action_id": action_id, "claim_id": v["claim_id"], "use_case": v["use_case"],
        "jurisdiction": v["jurisdiction"], "risk": v["overall_risk"],
        "lane_recommended": v["lane"], "human_decision": body.decision,
        "amount": body.amount, "reason": body.reason, "reviewer": body.reviewer,
        "agent_was_right": agent_was_right,
        "agent_proposed": {"action": v["intent"]["action"],
                           "amount": v["intent"]["params"].get("amount")},
        "execution_status": v["execution_status"], "money_moved": v["money_moved"],
        "legal_basis": v["policy_snapshot"]["regulatory_basis"],
        "retention_months": v["policy_snapshot"]["retention_months"],
    })
    v["review"]["ledger_seq"] = e["seq"]
    await HUB.send({"type": "review_decided", "action": _summary(v)})
    await HUB.send({"type": "state", "state": _state()})
    return v


@app.post("/api/learning/recalibrate")
async def post_recal(use_case: str = "claims-settlement"):
    r = recalibrate(use_case)
    await HUB.send({"type": "recalibrated", "result": r})
    await HUB.send({"type": "state", "state": _state()})
    return r


@app.get("/api/learning/history")
async def get_hist():
    return {"history": history(), "fairness": drift_sentinel()}


@app.get("/api/report")
async def get_report():
    r = harness.last()
    if not r:
        raise HTTPException(404, "no evaluation has been run yet — POST /api/report/run")
    return r


@app.post("/api/report/run")
async def run_report(use_case: str = "claims-settlement"):
    async def go():
        await HUB.send({"type": "eval_started"})
        r = await harness.run(use_case, emit=_emit)
        await HUB.send({"type": "eval_done", "overall": r["overall"]})
    task = asyncio.create_task(go())
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    return {"started": True}


@app.get("/api/ledger")
async def get_ledger(limit: int = 200, kind: str | None = None):
    return {"entries": chain.entries(limit, kind), "verify": chain.verify()}


@app.get("/api/ledger/verify")
async def verify_ledger():
    return chain.verify()


@app.get("/api/ledger/action/{action_id}")
async def ledger_for(action_id: str):
    return chain.find(action_id)


class Tamper(BaseModel):
    seq: int
    field: str = "amount"
    value: float = 999999


@app.post("/api/ledger/tamper")
async def do_tamper(body: Tamper):
    r = chain.tamper(body.seq, body.field, body.value)
    await HUB.send({"type": "state", "state": _state()})
    return {**r, "verify": chain.verify()}


@app.post("/api/demo/reset")
async def reset():
    seed()
    chain.reset()
    STORE.clear()
    ORDER.clear()
    await HUB.send({"type": "reset"})
    await HUB.send({"type": "state", "state": _state()})
    return {"ok": True, "ts": _now()}


@app.websocket("/ws")
async def ws(sock: WebSocket):
    await HUB.join(sock)
    try:
        await sock.send_text(json.dumps({"type": "state", "state": _state()}, default=str))
        while True:
            await sock.receive_text()
    except WebSocketDisconnect:
        HUB.leave(sock)
    except Exception:  # noqa: BLE001
        HUB.leave(sock)
