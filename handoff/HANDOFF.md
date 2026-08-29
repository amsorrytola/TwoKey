# Handoff

Everything the next person needs. Work through it in order.


## 1. Credentials

The repository contains no secrets. `.env` is gitignored and `data/ledger/signing.key`
is generated on first run. You must supply your own credentials.

Copy the template and fill it in:

```bash
cp .env.example .env
```

| Variable | Where to get it | Cost | Required |
| --- | --- | --- | --- |
| `GROQ_API_KEY_PRIMARY` | [console.groq.com](https://console.groq.com) | Free tier | Yes |
| `GROQ_API_KEY_SECONDARY` | Same, a second key on the same or a different account | Free tier | Strongly recommended |
| `DEEPSEEK_API_KEY` | [platform.deepseek.com](https://platform.deepseek.com) | Paid, pennies | Recommended |

**Why two Groq keys.** The free tier meters eight thousand tokens per minute per
credential. One key is not enough for the mesh, which makes up to nine model calls per
governed action. The key pool reads the rate-limit headers and schedules across both,
which cut our median latency from 10.6 seconds to 4.3.

**Why DeepSeek.** It is the second key of the Two-Key lane. Using a different vendor on
separate infrastructure is the point: a poisoned model or a leaked credential cannot turn
both keys. Without it the system falls back to a different Groq model family, which still
works but weakens the independence claim. If you drop it, say so rather than leaving the
claim standing.

> **Rotate the keys.** The credentials used during development were shared over chat and
> should be considered compromised. Generate new ones before any public deployment.


## 2. Local setup

Full step-by-step instructions, tested against a fresh clone, are in
[RUN_LOCALLY.md](RUN_LOCALLY.md). The short version:

```bash
git clone https://github.com/nitininhouse/interlock.git && cd interlock
cp .env.example .env          # add your keys
make install                  # Python via uv, Node via npm
make seed                     # build the simulated insurer
make test                     # 8 tests, under a second, no network
```

Then two terminals:

```bash
make api                      # http://localhost:8000
make ui                       # http://localhost:3000
```


## 3. Toolchain

| Tool | Version | Notes |
| --- | --- | --- |
| Python | 3.11+ | `uv` manages the environment |
| `uv` | any recent | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Node.js | 20+ | For the console |
| `tectonic` | any | Only to rebuild the PDFs. `brew install tectonic` |

No database, broker or cloud account. The insurer and the ledger are file backed.


## 4. What is deliberate and must not be "fixed"

New engineers reliably try to correct these. Do not.

1. **The agent fails on purpose.** It runs the `throughput` profile, prompted for cycle
   time and customer satisfaction, because that is how insurers actually tune settlement
   agents. It fails seven of eleven traps. Switching it to `careful` makes the
   demonstration weaker, not better. See `interlock/agent/claims_agent.py`.
2. **A failed check returns risk, not a pass.** If a judge is unreachable it returns 0.5
   and the action escalates. Degradation must never open the gate.
3. **Mandated reviews are counted separately.** A denial routed to a human under the EU
   pack is required by regulation, not a detection failure. The evaluation tracks it as
   `MANDATED` so it does not distort the false positive rate.
4. **Tau is derived, never set.** Alpha is the business input. Tau comes from conformal
   calibration. If you find yourself hand-tuning a threshold, something has gone wrong.
5. **Latency is reported honestly.** Our Round 1 concept said twelve milliseconds. That
   is true only for the deterministic checks. The README states the real p50 of 6.5
   seconds and explains why. Do not restore the old number.


## 5. Known limitations

| Limitation | Detail |
| --- | --- |
| Throughput | Sixteen thousand tokens per minute across both Groq keys bounds sustained load. A surge demonstration is slow on the free tier |
| Judge correlation | Two of the three model judges share the Qwen family. A third vendor is a roadmap item |
| Calibration sample | Conformal guarantees are asymptotic. Twenty-two labelled verdicts demonstrate the mechanism, not a production bound |
| In-memory action store | `interlock/api.py` keeps verdicts in a dict. Restarting the service clears the stream, though the ledger on disk survives |
| Synthetic data only | No real customer, policy or payment data anywhere |


## 6. Where to start reading

`interlock/engine.py`, function `run_action`. About a hundred lines, calls every component
in order. Once that is clear, the rest is detail.

Then `interlock/mesh/checks.py` for the six checks, and `interlock/router/route.py` for
the lane logic. Both are heavily commented on *why*, not just what.


## 7. Rebuilding the documents

```bash
make deliverables     # both PDFs and the deck
```

LaTeX sources are `deliverables/README.tex` and `deliverables/Business_Proposal.tex`,
sharing `deliverables/interlock.sty`. Fonts are vendored in `deliverables/fonts/` so the
build is reproducible on any machine with `tectonic`. The deck is generated by
`deliverables/build_deck.py` using python-pptx.


## 8. Outstanding work

| Item | Status | Notes |
| --- | --- | --- |
| Prototype video | Not recorded | Script in [VIDEO_SCRIPT.md](VIDEO_SCRIPT.md) |
| PPTX visual check | Not done | Generated programmatically and bounds-checked, but never opened in PowerPoint. Verify before submitting |
| Third judge vendor | Not started | Removes the Qwen correlation |
| OPA policy compilation | Not started | Roadmap Phase 3 |
| Persistent action store | Not started | Currently in memory |


## 9. Handoff checklist

- [ ] New Groq keys generated, old ones revoked
- [ ] New DeepSeek key generated, old one revoked
- [ ] `.env` created locally, confirmed not tracked: `git ls-files | grep -i env`
- [ ] `make install && make seed && make test` passes
- [ ] Both processes start, console shows `live`
- [ ] One governed action runs end to end from the UI
- [ ] `make eval` completes and writes `data/eval_report.json`
- [ ] Read [SUMMARY.md](SUMMARY.md), then [USER_FLOW.md](USER_FLOW.md), then [EXAMPLES.md](EXAMPLES.md)
- [ ] Repository access transferred


## 10. Documents in this directory

| File | Purpose |
| --- | --- |
| [SUMMARY.md](SUMMARY.md) | What the project is, how it works, the repository map |
| [USER_FLOW.md](USER_FLOW.md) | Reviewer flow, evaluator flow, and the internal flow of one action |
| [EXAMPLES.md](EXAMPLES.md) | Two worked examples with real captured output |
| [RUN_LOCALLY.md](RUN_LOCALLY.md) | Step-by-step setup, tested against a fresh clone, with troubleshooting |
| [VIDEO_SCRIPT.md](VIDEO_SCRIPT.md) | Narration script for the demonstration video |
| HANDOFF.md | This file |

Elsewhere: [USAGE.md](../USAGE.md) walks the console screen by screen,
[DESIGN.md](../DESIGN.md) is the locked design system, [docs/API.md](../docs/API.md) is
the API contract, and [deliverables/SUBMISSION_CHECKLIST.md](../deliverables/SUBMISSION_CHECKLIST.md)
tracks the competition submission.
