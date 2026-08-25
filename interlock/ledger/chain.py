"""Verdict ledger — hash-chained, Ed25519-signed, append-only.

EU AI Act Art.12 requires automatic event logging over the system lifetime, retained by
deployers for at least six months. Art.14 requires that human oversight be effective and
recorded. This ledger is the evidence for both: every verdict, every override, every
recalibration is an entry whose hash commits to the entry before it.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

ROOT = Path(__file__).resolve().parents[2] / "data" / "ledger"
LOG = ROOT / "verdicts.jsonl"
KEY = ROOT / "signing.key"
GENESIS = "0" * 64


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _key() -> ed25519.Ed25519PrivateKey:
    ROOT.mkdir(parents=True, exist_ok=True)
    if KEY.exists():
        return serialization.load_pem_private_key(KEY.read_bytes(), password=None)
    k = ed25519.Ed25519PrivateKey.generate()
    KEY.write_bytes(k.private_bytes(serialization.Encoding.PEM,
                                    serialization.PrivateFormat.PKCS8,
                                    serialization.NoEncryption()))
    KEY.chmod(0o600)
    return k


def _canon(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def _entries() -> list[dict]:
    if not LOG.exists():
        return []
    return [json.loads(l) for l in LOG.read_text().splitlines() if l.strip()]


def head() -> dict:
    es = _entries()
    return es[-1] if es else {"seq": 0, "hash": GENESIS}


def append(kind: str, payload: dict) -> dict:
    ROOT.mkdir(parents=True, exist_ok=True)
    prev = head()
    seq = prev["seq"] + 1
    body = {"seq": seq, "ts": _now(), "kind": kind, "prev_hash": prev["hash"], "payload": payload}
    h = hashlib.sha256(_canon(body).encode()).hexdigest()
    sig = _key().sign(h.encode()).hex()
    entry = {**body, "hash": h, "signature": sig, "signed_by": "interlock-dev-key"}
    with LOG.open("a") as f:
        f.write(json.dumps(entry, default=str) + "\n")
    return entry


def verify() -> dict:
    es = _entries()
    prev = GENESIS
    for e in es:
        body = {k: e[k] for k in ("seq", "ts", "kind", "prev_hash", "payload")}
        if e["prev_hash"] != prev:
            return {"ok": False, "entries": len(es), "first_bad_seq": e["seq"],
                    "reason": "broken chain link", "head_hash": es[-1]["hash"] if es else GENESIS}
        if hashlib.sha256(_canon(body).encode()).hexdigest() != e["hash"]:
            return {"ok": False, "entries": len(es), "first_bad_seq": e["seq"],
                    "reason": "payload does not match its hash", "head_hash": es[-1]["hash"]}
        prev = e["hash"]
    return {"ok": True, "entries": len(es), "first_bad_seq": None,
            "head_hash": es[-1]["hash"] if es else GENESIS}


def entries(limit: int = 200, kind: str | None = None) -> list[dict]:
    es = _entries()
    if kind:
        es = [e for e in es if e["kind"] == kind]
    return es[-limit:][::-1]


def find(action_id: str) -> list[dict]:
    return [e for e in _entries() if e["payload"].get("action_id") == action_id]


def tamper(seq: int, path: str, value) -> dict:
    """DEMO ONLY — edit a stored entry in place so verify() catches it."""
    es = _entries()
    for e in es:
        if e["seq"] == seq:
            tgt = e["payload"]
            parts = path.split(".")
            for p in parts[:-1]:
                tgt = tgt.setdefault(p, {})
            old = tgt.get(parts[-1])
            tgt[parts[-1]] = value
            LOG.write_text("\n".join(json.dumps(x, default=str) for x in es) + "\n")
            return {"tampered_seq": seq, "field": path, "from": old, "to": value}
    return {"error": f"seq {seq} not found"}


def reset() -> None:
    if LOG.exists():
        LOG.unlink()
