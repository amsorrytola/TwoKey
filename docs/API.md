# INTERLOCK API contract  (FastAPI backend at http://localhost:8000)

All JSON. Times ISO-8601 UTC. Money as number + `currency` ("EUR" | "INR"). Scores are RISK in [0,1] (0 = safe).
Lanes: `AUTO | EDIT | TWO_KEY | HUMAN | BLOCK`. Check status: `pass | warn | fail`.

## GET /api/state
{
  "use_cases": ["claims-settlement","customer-support","internal-copilot"],
  "jurisdictions": ["EU","IN"],
  "active": {"use_case":"claims-settlement","jurisdiction":"EU"},
  "tau": 0.02,
  "actions_today": 1240,
  "lane_split": {"AUTO":0.85,"EDIT":0.03,"TWO_KEY":0.08,"HUMAN":0.03,"BLOCK":0.01},
  "lane_counts": {"AUTO":1054,"EDIT":37,"TWO_KEY":99,"HUMAN":37,"BLOCK":13},
  "ledger": {"seq":1240,"head_hash":"a3f9…c21e","verified":true},
  "queue_pending": 3,
  "models": {"agent":"openai/gpt-oss-120b","judge":"qwen/qwen3.8-27b","second_key":"qwen/qwen3.6-27b","guard":"meta-llama/llama-prompt-guard-2-86m"}
}

## GET /api/actions?limit=50&use_case=&lane=
[ ActionSummary ]
ActionSummary = {
  "id":"act_000123","seq":123,"ts":"2026-09-01T10:22:31Z",
  "use_case":"claims-settlement","jurisdiction":"EU","agent_model":"openai/gpt-oss-120b",
  "claim_id":"CLM-2041","customer_masked":"R•••• S••••",
  "action":"approve_payout","amount":4200,"currency":"EUR",
  "lane":"HUMAN","overall_risk":0.71,
  "risk_vector":{"hallucination":0.2,"privacy":0.1,"bias":0.05,"blast_radius":0.8},
  "checks_failed":2,"checks_total":6,"total_latency_ms":1840,
  "execution_status":"pending_review",
  "ground_truth":{"should_execute":false,"trap":"policy_exclusion"}   // may be null
}

## GET /api/actions/{id}
Verdict (full) = ActionSummary + {
  "claim": {"id","type":"motor","policy_id","incident_date","filed_date","amount_claimed","damage_estimate","description","prior_claims":2,"has_history":true},
  "intent": {
    "action":"approve_payout","params":{"amount":4200,"currency":"EUR","payee":"customer"},
    "rationale":[{"step":1,"text":"Policy MP-88 is active on incident date."},{"step":2,"text":"Clause 4.2 covers collision damage."}],
    "cited_clauses":[{"id":"MP-88/4.2","source":"policy_db","trust":1.0,"text":"..."}],
    "confidence":0.86,"latency_ms":910
  },
  "checks":[
    {"name":"static_policy","label":"Static policy","kind":"deterministic","status":"fail","score":0.9,"started_ms":0,"ended_ms":3,"latency_ms":3,"model":null,
     "summary":"2 rule violations","evidence":{"rules":[{"id":"R03","desc":"amount ≤ coverage limit","ok":false,"detail":"4200 > 3000"},{"id":"R01","desc":"policy active","ok":true}]}},
    {"name":"prompt_guard","label":"Injection guard","kind":"classifier","status":"pass","score":0.02,"started_ms":0,"ended_ms":140,"latency_ms":140,"model":"meta-llama/llama-prompt-guard-2-86m","summary":"benign","evidence":{"label":"BENIGN","p_injection":0.02}},
    {"name":"evidence_nli","label":"Evidence NLI","kind":"llm_judge","status":"fail","score":0.85,"started_ms":0,"ended_ms":1320,"latency_ms":1320,"model":"qwen/qwen3.8-27b","summary":"contradicted","evidence":{"verdict":"CONTRADICTED","confidence":0.88,"explanation":"Clause 4.2 excludes damage while vehicle used commercially."}},
    {"name":"trace_auditor","label":"Trace auditor","kind":"llm_judge","status":"warn","score":0.4,"started_ms":0,"ended_ms":1410,"latency_ms":1410,"model":"qwen/qwen3.8-27b","summary":"step 2 weak (0.35)","evidence":{"steps":[{"step":1,"score":0.95,"note":"..."},{"step":2,"score":0.35,"note":"..."}],"min":0.35,"mean":0.65}},
    {"name":"semantic_entropy","label":"Semantic entropy","kind":"statistical","status":"pass","score":0.15,"started_ms":0,"ended_ms":1780,"latency_ms":1780,"model":"openai/gpt-oss-120b","summary":"4/4 samples agree","evidence":{"k":4,"clusters":[{"decision":"approve_payout:4200","n":4}],"entropy":0.0,"normalized":0.0}},
    {"name":"consequence_sim","label":"Consequence sim","kind":"deterministic","status":"warn","score":0.8,"started_ms":0,"ended_ms":11,"latency_ms":11,"model":null,"summary":"irreversible · 4200 EUR · 2 systems","evidence":{"money_moved":4200,"reversible":false,"systems":["payments","claims"],"budget_before":50000,"budget_after":45800,"downstream_actions":["notify_customer","close_claim"]}}
  ],
  "risk":{"vector":{"hallucination":0.2,"privacy":0.1,"bias":0.05,"blast_radius":0.8},"overall":0.71,"tau":0.02,"p_value":0.004,"source_trust":1.0,
          "weights":{"static_policy":0.25,"evidence_nli":0.25,"trace_auditor":0.15,"semantic_entropy":0.15,"consequence_sim":0.15,"prompt_guard":0.05}},
  "route":{"lane":"HUMAN","reason":"static_policy hard-fail on irreversible action → human","edits":[]},
        // EDIT example: "edits":[{"field":"amount","from":4200,"to":3000,"rule":"R03 clamp to coverage limit"}]
  "two_key": null,   // or {"model":"qwen/qwen3.6-27b","key":"secondary","decision":"approve_payout","amount":4150,"concur":true,"tolerance":0.05,"latency_ms":760,"explanation":"..."}
  "execution":{"status":"pending_review","idempotency_key":"idem_…","money_moved":0,"saga":[{"name":"reserve_funds","status":"skipped"},{"name":"pay","status":"skipped"},{"name":"notify","status":"skipped"}],"budget_remaining":45800,"executed_at":null},
        // status ∈ executed | held | blocked | rolled_back | pending_review | overridden_executed | overridden_denied
  "review": null,    // or {"decision":"override_deny","reason":"...","reviewer":"R. Sidana","ts":"..."}
  "ledger":{"seq":123,"hash":"sha256…","prev_hash":"sha256…","signature":"ed25519…","signed_by":"interlock-dev-key"},
  "timeline":[{"t_ms":0,"event":"intent_received"},{"t_ms":3,"event":"static_policy done"},...,{"t_ms":1840,"event":"routed HUMAN"}]
}

## GET /api/claims?limit=
[{"id":"CLM-2041","type":"motor","customer_masked":"R•••• S••••","amount_claimed":4200,"currency":"EUR","trap":"policy_exclusion"|null,"has_history":true,"summary":"Rear collision, commercial use"}]

## POST /api/run   body {"claim_id":"CLM-2041","use_case":"claims-settlement","jurisdiction":"EU"}
→ Verdict (full). Also emits WS events during processing.

## POST /api/run/batch  body {"n":10,"use_case":"claims-settlement","jurisdiction":"EU","shuffle":true}
→ {"started":10,"batch_id":"…"}   (runs async, streams over WS)

## GET /api/queue      → [ ActionSummary ] where lane=HUMAN and review==null
## POST /api/queue/{id}/decide  body {"decision":"approve"|"override_deny"|"override_amount","amount"?:number,"reason":"…","reviewer":"…"}
→ Verdict (updated: execution.status, review, new ledger entry seq)

## GET /api/policies  → { "claims-settlement": PolicyPack, ... }
PolicyPack = {"use_case","description","latency_budget_ms":2000,"alpha":0.02,"tau":0.02,
  "thresholds":{"auto_max":0.20,"two_key_max":0.55,"human_max":0.85},   // > human_max → BLOCK
  "max_auto_amount":{"EUR":2500,"INR":200000},"irreversible_actions":["approve_payout","deny_claim"],
  "allowed_actions":[...],"jurisdiction_overrides":{"EU":{"require_human_for":["deny_claim"],"pii_policy":"strict","log_retention_months":6},"IN":{"require_human_for":[],"pii_policy":"dpdp","log_retention_months":12}},
  "weights":{...}}
## PATCH /api/policies/{use_case}  body partial PolicyPack (e.g. {"alpha":0.05}) → PolicyPack

## POST /api/learning/recalibrate  → {"before":{"tau":0.02,"escalation_rate":0.15},"after":{"tau":0.031,"escalation_rate":0.11},"labelled_verdicts":42,"method":"split-conformal quantile","history":[{"night":1,"tau":0.02,"escalation_rate":0.15},...]}
## GET /api/learning/history → history array

## GET /api/report
{
 "generated_at":"…","cases":60,
 "per_use_case":[{"use_case":"claims-settlement","n":40,"precision":0.93,"recall":0.97,"fp":2,"fn":1,"tp":29,"tn":8,"fp_rate":0.2,"fn_rate":0.03,"p50_ms":640,"p95_ms":2100,"cost_per_action_usd":0.0009,"escalation_rate":0.12}],
 "overall":{...same fields...},
 "leakage_prevented":{"amount":48200,"currency":"EUR","actions":7},
 "straight_through_rate":0.85,
 "llm_vs_non_llm":{"llm_checks":3,"deterministic_checks":3,"llm_share_of_latency":0.97},
 "owasp_mapping":[{"id":"ASI01","name":"Agent Goal Hijack","control":"prompt_guard + intent contract"},...],
 "regulatory":[{"reg":"EU AI Act Art.12","control":"hash-chained ledger, 6-month retention"},{"reg":"EU AI Act Art.14","control":"HUMAN lane + override with reason"},{"reg":"India DPDP 2023 / Rules 2025","control":"PII masking, purpose-bound access, IN pack"},{"reg":"IRDAI","control":"cohort-fairness drift sentinel"}],
 "fairness":{"cohorts":[{"cohort":"region:north","n":20,"auto_rate":0.86},{"cohort":"region:south","n":20,"auto_rate":0.84}],"max_gap":0.02,"status":"ok"}
}

## GET /api/ledger/verify → {"ok":true,"entries":1240,"first_bad_seq":null,"head_hash":"…"}
## POST /api/ledger/tamper (demo) body {"seq":117,"field":"amount","value":9999} → {"tampered_seq":117}
## POST /api/ledger/restore (demo) → {"ok":true}
## GET /api/ledger?limit=100 → [{"seq","ts","action_id","hash","prev_hash","signature","lane","ok":true|false}]

## WS /ws   server → client JSON events
{"type":"action_started","action_id","claim_id","use_case","ts"}
{"type":"check_done","action_id","check":{...check object...}}
{"type":"verdict","action":ActionSummary}
{"type":"two_key","action_id","two_key":{...}}
{"type":"executed","action_id","execution":{...}}
{"type":"ledger_appended","entry":{"seq","hash","action_id","lane"}}
{"type":"state","state":{...GET /api/state...}}
{"type":"review_decided","action":ActionSummary}
{"type":"recalibrated","result":{...}}
