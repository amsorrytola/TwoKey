"""Intent contract — the schema-pinned plan an agent must declare BEFORE acting.

This is the hinge of the whole design: the agent cannot reach a tool directly, it can
only emit a contract. Everything downstream verifies the contract, not the prose.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class Step(BaseModel):
    step: int
    text: str


class Citation(BaseModel):
    id: str
    source: str = "unknown"      # policy_db | internal_wiki | email_thread | unknown
    trust: float = 0.5           # filled in by the gateway from the source registry
    text: str = ""


class IntentContract(BaseModel):
    action: Literal["approve_payout", "deny_claim", "request_documents", "escalate"]
    params: dict[str, Any] = Field(default_factory=dict)
    rationale: list[Step] = Field(default_factory=list)
    cited_clauses: list[Citation] = Field(default_factory=list)
    confidence: float = 0.5
    latency_ms: int = 0
    raw: str = ""

    @field_validator("confidence")
    @classmethod
    def _clamp(cls, v: float) -> float:
        return min(max(float(v), 0.0), 1.0)

    @property
    def amount(self) -> float:
        try:
            return float(self.params.get("amount") or 0.0)
        except (TypeError, ValueError):
            return 0.0
