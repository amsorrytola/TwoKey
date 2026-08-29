# Interlock: project summary

A one-page orientation for whoever picks this up next. Read this first, then
[HANDOFF.md](HANDOFF.md) for what you need to get it running.


## What it is

Interlock is an action firewall for AI agents. It sits between an agent and the systems
that agent acts on. Nothing reaches a payment rail, a policy database or a customer until
Interlock has verified it and assigned it to an autonomy lane.

Built for the Accenture Innovation Challenge 2026, Round 2, Problem Track 1
(ControlPlane.ai), by Team TwoKey.


## Why it exists

Every mainstream AI safety tool inspects the text a model produces. The damage does not
happen in the text. It happens at the tool call, and that layer is ungoverned. A claims
agent that writes a fluent, well-toned settlement for a claim the policy never covered
passes every output check ever built, and the money is still gone.


## How it works, in one pass

1. The agent cannot call a tool. It can only emit an **intent contract**: a validated
   object stating the action, parameters, numbered rationale, cited policy clauses and
   its own confidence.
2. Six **verification checks** run concurrently against that contract. Two are
   deterministic and return in single-digit milliseconds, one is a classifier, two are
   language model judges and one is statistical.
3. Results fuse into a **four-axis risk vector**: hallucination, privacy, bias, blast
   radius, plus a policy-weighted scalar used for routing.
4. A **router** picks one of five lanes using thresholds read from a YAML policy pack.
   No threshold lives in code.
5. An **executor** applies idempotency keys, saga compensation and a daily budget breaker.
6. Every decision is appended to a **hash-chained, Ed25519-signed ledger**.
7. Human overrides feed a **split-conformal recalibration** that re-derives the routing
   threshold from the error rate the business is willing to accept.


## The five lanes

| Lane | Glyph | What happens |
| --- | --- | --- |
| AUTO | `›` | Executes immediately |
| EDIT | `⊘` | Repaired, then executed. Clamped to the coverage limit, PII redacted |
| TWO-KEY | `‖` | A model from a different vendor must independently agree |
| HUMAN | `△` | Staged for a person with the evidence already prepared |
| BLOCK | `✕` | Fails closed. Never executes |


## Results, measured

Twenty-two simulated claims, eleven carrying planted failure modes with recorded ground
truth. Reproducible with `make eval`.

| Metric | Value |
| --- | --- |
| False negatives, unsafe actions executed | 0 |
| False positive rate | 14.3 percent, down from 41.2 |
| Recall / precision | 1.000 / 0.750 |
| Accuracy, ungoverned then governed | 77.3 then 86.4 percent |
| Straight through, no human involved | 54.5 percent |
| Latency, p50 / p95 | 6.5 s / 10.2 s |
| Cost per governed action | 0.16 US cents |
| Leakage prevented on the run | EUR 5,280 |


## Repository map

| Path | What lives there |
| --- | --- |
| `interlock/sim/world.py` | Simulated insurer. 22 claims, 11 planted failures, ground truth |
| `interlock/retrieval.py` | Evidence retrieval with source-trust weighting |
| `interlock/agent/` | The untrusted controller and the intent contract schema |
| `interlock/mesh/checks.py` | The six verification checks |
| `interlock/mesh/fusion.py` | Four-axis risk vector |
| `interlock/router/route.py` | Five lanes. Thresholds read from policy |
| `interlock/router/two_key.py` | Cross-vendor concurrence |
| `interlock/router/executor.py` | Idempotency, sagas, budget breaker |
| `interlock/ledger/chain.py` | Hash chain, signing, tamper detection |
| `interlock/learning/recalibrate.py` | Split-conformal calibration, drift sentinel |
| `interlock/eval/harness.py` | Precision, recall, false positives, cost, latency |
| `interlock/engine.py` | Orchestration. Start here to read the flow |
| `interlock/api.py` | FastAPI service and WebSocket stream |
| `policies/*.yaml` | All governance. Three use cases, two jurisdictions |
| `ui/` | Next.js operator console, four screens |
| `deliverables/` | LaTeX sources, PDFs, the deck, submission checklist |
| `handoff/` | This directory |


## Where to start reading

`interlock/engine.py`, function `run_action`. It is roughly one hundred lines and calls
every other component in order. Once that reads clearly, everything else is a detail.


## The three things most likely to confuse a newcomer

1. **The agent is meant to fail.** It runs on a throughput-oriented profile because that
   is how insurers actually tune settlement agents. It fails seven of eleven traps by
   design. That is the demonstration, not a bug.
2. **Alpha and tau are different things.** Alpha is the error rate the business accepts.
   Tau is the routing threshold, derived from alpha by conformal calibration. Nobody
   sets tau by hand.
3. **A mandated review is not a false positive.** Under the EU pack an adverse automated
   decision requires a human signature. The evaluation counts those separately so they
   do not distort the false positive rate.
