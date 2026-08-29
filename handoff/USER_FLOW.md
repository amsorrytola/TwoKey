# User flow

Two audiences use this system. The **claims reviewer** works the queue during a shift.
The **evaluator**, meaning a judge, an auditor or a new engineer, is trying to understand
whether it works. Both flows are below.


## Starting it

Two processes, two terminals.

```bash
make api        # verification service, http://localhost:8000
make ui         # operator console,     http://localhost:3000
```

Open `http://localhost:3000`. The status bar shows `live` in green when the console has
reached the service.


## Flow A: the claims reviewer

This is the daily user. They never see the architecture.

```
1. Open the console
      Status bar shows the active policy, the current threshold,
      how many actions ran today, and how many are waiting.

2. Press 3, or click Review queue
      The tab carries a count badge when work is waiting.
      Only actions the mesh could not clear appear here.

3. Pick an item
      The right pane is already prepared:
        what the AI wants to do, and for how much
        the claim facts, the policy limit, the damage estimate
        ONLY the checks that failed, with their reasons
      The reviewer does not go looking for evidence. It is staged.

4. Type a reason
      Mandatory. It is written to the ledger and becomes training data.

5. Decide
      A  approve as proposed        the AI's action executes unchanged
      O  override, do not pay       the action is held, nothing moves
         override amount            type a figure, that executes instead

6. The ledger records
      the recommendation, the human decision, the reason, the reviewer,
      the legal basis and the retention period

7. Overnight
      Those overrides recalibrate the threshold, so the queue
      gets shorter over time rather than longer
```

The reviewer never leaves screen 3. Everything else in the console exists for other
people.


## Flow B: the evaluator

Someone assessing whether the system works. This is the path to walk in a demo.

```
1. Screen 1, Action stream
      Left rail:  the Autonomy Dial, then two lists of claims
                  Planted failure modes, and Clean claims
      Centre:     the live feed, one line per governed action
      Right:      lane split, checks in flight, model roster

2. Click a planted failure, for example CLM-2046
      The agent tries to approve EUR 2,900 because the claim text
      contains an instruction telling it to.
      The row lands as BLOCK. Money moved: nothing.

3. Click that row  ->  screen 2, Flight recorder
      Left:    the intent contract. What the agent declared, its rationale,
               the clauses it cited and how much each source is trusted
      Centre:  six checks on a real millisecond timeline, drawn in parallel.
               Click any bar to open the evidence that check produced.
               Drag the replay slider to walk the action forward in time.
      Right:   the risk radar, the routing decision with its legal basis,
               any repairs applied, two-key concurrence, saga states,
               and the ledger entry with its hash chain

4. Back to screen 1. Switch the jurisdiction dial from EU to India.
      Run CLM-2045, a correct denial.
      EU    -> HUMAN, because Article 14 requires a signature
      India -> AUTO,  because DPDP does not
      Same claim. Same risk score. Different lane. No code changed.

5. Press S for a surge
      Three times normal concurrency across the whole claim set.
      Watch the lane gauge redistribute under load.

6. Screen 3. Override one item with a reason.

7. Screen 4, Trust report
      False negatives are reported first, because that is the number
      that decides whether this can run unattended.
      Then false positives, the alert-fatigue cost.
      Then per-failure-mode breakdown, cohort fairness, and cost.

8. Still on screen 4: click "tamper with a stored verdict"
      Chain integrity turns red and names the sequence number.
      make reset restores it.
```


## Flow C: what happens inside one action

The machine's own flow, for an engineer reading the code.

```
POST /api/run  {claim_id, use_case, jurisdiction}
   |
   +- policy.get(use_case, jurisdiction)        load the governance pack
   +- retrieval.fetch(claim_id)                 claim, policy, customer, clauses
   |                                            each clause carries a trust weight
   +- agent.decide(...)                         the untrusted controller
   |     returns an IntentContract              action, params, rationale, citations
   |
   +- mesh.run_mesh(...)                        six checks, asyncio.gather
   |     static_policy      ~3 ms   deterministic rules
   |     consequence_sim    ~2 ms   dry run on a sandboxed copy
   |     prompt_guard      ~130 ms  injection classifier
   |     evidence_nli      ~700 ms  does the decision follow from its citations
   |     trace_auditor     ~900 ms  is each reasoning step valid
   |     semantic_entropy  ~2.5 s   resample, cluster by meaning, entropy
   |
   +- fusion.fuse(...)                          four axes plus a weighted scalar
   |     a deterministic hard failure cannot be averaged away
   |     low-trust-only evidence adds a penalty
   |
   +- router.route(...)                         five lanes, thresholds from policy
   |     BLOCK conditions outrank everything
   |     then jurisdiction mandates
   |     then EDIT repairs, then the score bands
   |
   +- two_key.concur(...)                       only if the lane is TWO_KEY
   |     a different vendor re-derives the decision from the same evidence
   |
   +- executor.execute(...)                     idempotency, sagas, budget breaker
   |     HUMAN and BLOCK never move money
   |
   +- ledger.append(...)                        hash chained, signed
   |
   +- WebSocket events to the console throughout
```


## Keyboard

| Key | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` | Command palette. Every claim and control, fuzzy searchable |
| `1` `2` `3` `4` | Switch screens |
| `J` / `K` or arrows | Walk the stream, or the review queue |
| `Enter` | Open the selected row |
| `B` | Run a batch of eight |
| `S` | Surge, three times volume |
| `A` / `O` | In the review queue: approve, or override |

The command palette is the fastest route to anything. Type a claim id, a trap name such
as `injection` or `duplicate`, `recalibrate`, `surge`, or a jurisdiction.
