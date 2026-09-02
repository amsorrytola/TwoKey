"""Groq LLM client. Two API keys → two independent 'keys' for the Two-Key lane.

Model roles (heterogeneous on purpose — different families, different vendors):
  agent       openai/gpt-oss-120b   the untrusted controller that decides
  judge       qwen/qwen3.8-27b      evidence-NLI + trace auditor (different family from agent)
  second_key  qwen/qwen3.6-27b      independent concurrence, on the SECOND api key
  guard       meta-llama/llama-prompt-guard-2-86m  injection classifier
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

BASE = "https://api.groq.com/openai/v1"
DEEPSEEK_BASE = "https://api.deepseek.com"

KEY_PRIMARY = os.getenv("GROQ_API_KEY_PRIMARY", "")
KEY_SECONDARY = os.getenv("GROQ_API_KEY_SECONDARY", "") or KEY_PRIMARY
KEY_DEEPSEEK = os.getenv("DEEPSEEK_API_KEY", "")

# Heterogeneity is a safety property, not a detail. The second key runs a model from a
# DIFFERENT VENDOR on DIFFERENT INFRASTRUCTURE under a SEPARATE CREDENTIAL, so a shared
# failure mode — a bad deploy, a poisoned fine-tune, a leaked key, a correlated blind
# spot in one model family — cannot turn both keys at once.
MODELS = {
    "agent": "openai/gpt-oss-120b",                        # Groq · untrusted controller
    "judge": "qwen/qwen3.8-27b",                           # Groq · Alibaba family
    "second_key": ("deepseek-v4-flash" if KEY_DEEPSEEK      # DeepSeek · separate vendor
                   else "qwen/qwen3.6-27b"),
    "guard": "meta-llama/llama-prompt-guard-2-86m",        # Groq · Meta classifier
}

VENDOR = {
    "openai/gpt-oss-120b": "groq", "qwen/qwen3.8-27b": "groq",
    "qwen/qwen3.6-27b": "groq", "meta-llama/llama-prompt-guard-2-86m": "groq",
    "deepseek-v4-flash": "deepseek", "deepseek-v4-pro": "deepseek",
}

# Key pool. Groq's free tier meters TOKENS PER MINUTE per key (8k TPM), which the mesh
# would exhaust on its own — six checks plus k resamples per action. We therefore run a
# token-aware pool: each request goes to the key with the most remaining budget, and the
# pool self-throttles from the x-ratelimit-remaining-tokens header instead of discovering
# the limit through 429s. The Two-Key lane is pinned to the SECOND key so independent
# concurrence is genuinely independent of the primary credential, not just the model.
KEYS = [k for k in (KEY_PRIMARY, KEY_SECONDARY) if k]
PINNED = {"second_key": 1}          # role -> index into KEYS (independence requirement)


class _KeyPool:
    def __init__(self, keys: list[str]) -> None:
        self.keys = keys or [""]
        self.remaining = [8000.0] * len(self.keys)
        self.reset_at = [0.0] * len(self.keys)
        self.lock = asyncio.Lock()

    def _refresh(self, i: int) -> None:
        if time.monotonic() >= self.reset_at[i]:
            self.remaining[i] = 8000.0

    async def acquire(self, role: str, est_tokens: int) -> int:
        """Pick a key with budget; wait only if every key is genuinely exhausted."""
        if role in PINNED and PINNED[role] < len(self.keys):
            i = PINNED[role]
            for _ in range(40):
                async with self.lock:
                    self._refresh(i)
                    if self.remaining[i] >= est_tokens:
                        self.remaining[i] -= est_tokens
                        return i
                    wait = max(0.25, self.reset_at[i] - time.monotonic())
                await asyncio.sleep(min(wait, 2.0))
            return i
        for _ in range(60):
            async with self.lock:
                for i in range(len(self.keys)):
                    self._refresh(i)
                best = max(range(len(self.keys)), key=lambda j: self.remaining[j])
                if self.remaining[best] >= est_tokens:
                    self.remaining[best] -= est_tokens
                    return best
                wait = max(0.25, min(self.reset_at) - time.monotonic())
            await asyncio.sleep(min(max(wait, 0.25), 2.0))
        return 0

    async def force_exhausted(self, i: int, retry_after_s: float | None) -> None:
        """A 429 got through despite our tracked budget looking fine — that means the
        real constraint isn't the per-minute figure we track (e.g. Groq's separate,
        unheadered tokens-per-day cap). Zero this key out so acquire() actually rotates
        to another key instead of blindly retrying the same exhausted one."""
        async with self.lock:
            self.remaining[i] = 0.0
            self.reset_at[i] = time.monotonic() + (retry_after_s or 60.0)

    async def observe(self, i: int, headers) -> None:
        async with self.lock:
            try:
                rem = headers.get("x-ratelimit-remaining-tokens")
                rst = headers.get("x-ratelimit-reset-tokens", "")
                if rem is not None:
                    self.remaining[i] = float(rem)
                if rst:
                    secs = 0.0
                    m = re.match(r"(?:(\d+)h)?(?:(\d+)m)?([\d.]+)s", rst)
                    if m:
                        h, mi, se = m.groups()
                        secs = int(h or 0) * 3600 + int(mi or 0) * 60 + float(se or 0)
                    self.reset_at[i] = time.monotonic() + secs
            except Exception:  # noqa: BLE001
                pass

    def snapshot(self) -> list[dict]:
        return [{"key": f"key{i+1}", "remaining_tokens": int(self.remaining[i]),
                 "resets_in_s": max(0, round(self.reset_at[i] - time.monotonic(), 1))}
                for i in range(len(self.keys))]


POOL = _KeyPool(KEYS)

# Groq accepts different reasoning_effort vocabularies per model family.
REASONING_EFFORT = {
    "openai/gpt-oss-120b": "low",     # accepts low|medium|high only
    "qwen/qwen3.8-27b": "none",
    "qwen/qwen3.6-27b": "none",       # accepts none|default only
}

# USD per 1M tokens. Groq's free tier is $0; these are published paid rates used
# purely so the Trust Report can show an honest cost-per-governed-action figure.
PRICE = {
    "openai/gpt-oss-120b": (0.15, 0.75),
    "qwen/qwen3.8-27b": (0.29, 0.59),
    "qwen/qwen3.6-27b": (0.29, 0.59),
    "meta-llama/llama-prompt-guard-2-86m": (0.04, 0.04),
    "deepseek-v4-flash": (0.28, 0.42),
    "deepseek-v4-pro": (0.55, 2.19),
}


@dataclass
class Usage:
    calls: int = 0
    in_tok: int = 0
    out_tok: int = 0
    cost_usd: float = 0.0
    by_model: dict = field(default_factory=dict)

    def add(self, model: str, i: int, o: int) -> None:
        pi, po = PRICE.get(model, (0.0, 0.0))
        c = (i / 1e6) * pi + (o / 1e6) * po
        self.calls += 1
        self.in_tok += i
        self.out_tok += o
        self.cost_usd += c
        m = self.by_model.setdefault(model, {"calls": 0, "in": 0, "out": 0, "cost": 0.0})
        m["calls"] += 1
        m["in"] += i
        m["out"] += o
        m["cost"] += c


class LLMError(RuntimeError):
    pass


_client: httpx.AsyncClient | None = None


async def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))
    return _client


async def chat(
    role: str,
    messages: list[dict],
    *,
    temperature: float = 0.0,
    max_tokens: int = 900,
    usage: Usage | None = None,
    retries: int = 3,
) -> tuple[str, dict]:
    """Returns (text, meta). meta = {model, latency_ms, in_tok, out_tok, cost_usd}."""
    model = MODELS[role]
    vendor = VENDOR.get(model, "groq")
    if vendor == "deepseek":
        # Separate vendor, separate credential, separate rate-limit budget.
        return await _chat_deepseek(model, messages, temperature=temperature,
                                    max_tokens=max_tokens, usage=usage, retries=retries)
    if not KEYS:
        raise LLMError("no Groq API key configured")
    est = sum(len(m.get("content", "")) for m in messages) // 3 + max_tokens
    ki = await POOL.acquire(role, est)
    key = KEYS[ki]
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    # These models emit chain-of-thought. Minimise it so JSON parsing is
    # deterministic and we do not pay for stray reasoning tokens. Groq accepts a
    # different vocabulary per family, hence the lookup.
    if model in REASONING_EFFORT:
        payload["reasoning_effort"] = REASONING_EFFORT[model]
    cl = await _http()
    t0 = time.perf_counter()
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = await cl.post(
                f"{BASE}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json=payload,
            )
            await POOL.observe(ki, r.headers)
            if r.status_code == 429:
                ra = r.headers.get("retry-after")
                ra_s = float(ra) if ra else None
                # The per-minute header POOL tracks can read as fully available while a
                # separate daily cap is what's actually rejecting us — trust the 429 itself
                # over the header so we rotate to another key instead of retrying this one.
                await POOL.force_exhausted(ki, ra_s)
                await asyncio.sleep(min(ra_s if ra_s else 1.5 * (attempt + 1), 8.0))
                ki = await POOL.acquire(role, est)
                key = KEYS[ki]
                continue
            r.raise_for_status()
            d = r.json()
            text = d["choices"][0]["message"]["content"] or ""
            u = d.get("usage", {})
            i, o = u.get("prompt_tokens", 0), u.get("completion_tokens", 0)
            pi, po = PRICE.get(model, (0.0, 0.0))
            cost = (i / 1e6) * pi + (o / 1e6) * po
            if usage is not None:
                usage.add(model, i, o)
            return text, {
                "model": model,
                "api_key": f"key{ki+1}",
                "api_key": f"key{ki+1}",
                "latency_ms": int((time.perf_counter() - t0) * 1000),
                "in_tok": i,
                "out_tok": o,
                "cost_usd": cost,
            }
        except Exception as e:  # noqa: BLE001
            last = e
            await asyncio.sleep(0.6 * (attempt + 1))
    raise LLMError(f"{model}: {last}")


async def _chat_deepseek(model: str, messages: list[dict], *, temperature: float,
                         max_tokens: int, usage: Usage | None, retries: int) -> tuple[str, dict]:
    cl = await _http()
    t0 = time.perf_counter()
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = await cl.post(
                f"{DEEPSEEK_BASE}/chat/completions",
                headers={"Authorization": f"Bearer {KEY_DEEPSEEK}"},
                json={"model": model, "messages": messages, "temperature": temperature,
                      "max_tokens": max_tokens},
            )
            if r.status_code == 429:
                await asyncio.sleep(1.5 * (attempt + 1))
                continue
            r.raise_for_status()
            d = r.json()
            text = d["choices"][0]["message"]["content"] or ""
            u = d.get("usage", {})
            i, o = u.get("prompt_tokens", 0), u.get("completion_tokens", 0)
            pi, po = PRICE.get(model, (0.0, 0.0))
            if usage is not None:
                usage.add(model, i, o)
            return text, {"model": model, "api_key": "deepseek", "vendor": "deepseek",
                          "latency_ms": int((time.perf_counter() - t0) * 1000),
                          "in_tok": i, "out_tok": o,
                          "cost_usd": (i / 1e6) * pi + (o / 1e6) * po}
        except Exception as e:  # noqa: BLE001
            last = e
            await asyncio.sleep(0.6 * (attempt + 1))
    raise LLMError(f"{model}: {last}")


async def classify_injection(text: str, usage: Usage | None = None) -> tuple[float, dict]:
    """Llama Prompt Guard 2 returns a score/label rather than chat prose."""
    model = MODELS["guard"]
    cl = await _http()
    t0 = time.perf_counter()
    ki = await POOL.acquire("guard", 600)
    try:
        r = await cl.post(
            f"{BASE}/chat/completions",
            headers={"Authorization": f"Bearer {KEYS[ki]}"},
            json={"model": model, "messages": [{"role": "user", "content": text[:1800]}], "max_tokens": 8},
        )
        await POOL.observe(ki, r.headers)
        await POOL.observe(ki, r.headers)
        r.raise_for_status()
        d = r.json()
        out = (d["choices"][0]["message"]["content"] or "").strip()
        u = d.get("usage", {})
        if usage is not None:
            usage.add(model, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
        m = re.search(r"[01](?:\.\d+)?", out)
        p = float(m.group()) if m else (1.0 if "inject" in out.lower() or "jailbreak" in out.lower() else 0.0)
        return min(max(p, 0.0), 1.0), {"model": model, "raw": out, "latency_ms": int((time.perf_counter() - t0) * 1000)}
    except Exception as e:  # noqa: BLE001
        return 0.0, {"model": model, "error": str(e), "latency_ms": int((time.perf_counter() - t0) * 1000)}


_JSON_RE = re.compile(r"\{.*\}", re.S)


def parse_json(text: str) -> dict:
    """Tolerant JSON extraction — strips ``` fences, <think> blocks, prose."""
    t = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    t = re.sub(r"<think>.*$", "", t, flags=re.S).strip()  # unterminated (truncated) reasoning
    t = re.sub(r"^```(?:json)?|```$", "", t, flags=re.M).strip()
    try:
        return json.loads(t)
    except Exception:  # noqa: BLE001
        m = _JSON_RE.search(t)
        if m:
            try:
                return json.loads(m.group())
            except Exception:  # noqa: BLE001
                pass
    raise LLMError(f"unparseable JSON: {text[:300]}")


async def aclose() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
