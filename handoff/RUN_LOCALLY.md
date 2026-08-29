# Running Interlock locally

Every command below was run against a fresh clone before this was written. If something
here does not work, that is a bug in the project, not in your setup.

Total time from clone to a governed action on screen: about ten minutes, most of it
waiting for `npm install`.


## Contents

- [What you need first](#what-you-need-first)
- [Getting the API keys](#getting-the-api-keys)
- [Setup, step by step](#setup-step-by-step)
- [Running it](#running-it)
- [Checking it actually works](#checking-it-actually-works)
- [Every command](#every-command)
- [When something breaks](#when-something-breaks)
- [Running without any keys](#running-without-any-keys)


## What you need first

| Tool | Version | Check with | Install |
| --- | --- | --- | --- |
| Python | 3.11 or later | `python3 --version` | [python.org](https://www.python.org/downloads/) or `brew install python` |
| `uv` | any recent | `uv --version` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Node.js | 20 or later | `node --version` | [nodejs.org](https://nodejs.org) or `brew install node` |
| Git | any | `git --version` | Preinstalled on macOS and most Linux |

Optional, only if you want to rebuild the PDF documents:

| Tool | Install |
| --- | --- |
| `tectonic` | `brew install tectonic` |

You do **not** need a database, Docker, a message broker or a cloud account. The simulated
insurer is SQLite and the ledger is a file.


## Getting the API keys

Three keys. Two are free.

### Groq, two keys, free

1. Go to [console.groq.com](https://console.groq.com) and sign in
2. Open **API Keys**, create a key, copy it immediately (it is shown once)
3. Create a **second** key the same way

**Why two.** The free tier meters eight thousand tokens per minute *per key*. Interlock
makes up to nine model calls per governed action, so one key throttles hard. The key pool
reads the rate-limit headers and schedules across both, which took our median latency from
10.6 seconds down to 4.3.

### DeepSeek, one key, a few cents

1. Go to [platform.deepseek.com](https://platform.deepseek.com), sign in, add a small
   amount of credit
2. Create an API key under **API keys**

**Why.** This is the second key of the Two-Key lane. Using a genuinely different vendor is
the entire point: a poisoned model or a leaked credential cannot turn both keys. Without
it the system falls back to a different Groq model family, which still runs, but the
independence claim is weaker. If you drop DeepSeek, stop making that claim.


## Setup, step by step

### 1. Clone

```bash
git clone https://github.com/nitininhouse/interlock.git
cd interlock
```

### 2. Add your keys

```bash
cp .env.example .env
```

Open `.env` and fill in the three values:

```
GROQ_API_KEY_PRIMARY=gsk_...
GROQ_API_KEY_SECONDARY=gsk_...
DEEPSEEK_API_KEY=sk-...
```

`.env` is gitignored. Never commit it.

### 3. Install

```bash
make install
```

This creates `.venv` with `uv`, installs the Python package with its `dev` and `docs`
extras, and runs `npm install` in `ui/`. The Node step is the slow part, roughly two
minutes on a first run.

### 4. Build the simulated insurer

```bash
make seed
```

You should see:

```json
{
  "db": ".../data/insurer.db",
  "policies": 5,
  "clauses": 10,
  "customers": 8,
  "claims": 22,
  "traps": 11
}
```

Twenty-two claims, eleven of them carrying deliberately planted failure modes.

### 5. Confirm the core logic is sound

```bash
make test
```

Eight tests covering idempotency, the budget breaker, saga rollback, jurisdiction
overrides and ledger tamper detection. They run in well under a second and do not touch
the network.


## Running it

Two processes, two terminal windows. Both must be running.

**Terminal 1, the verification service:**

```bash
make api
```

Wait for `Uvicorn running on http://127.0.0.1:8000`.

**Terminal 2, the console:**

```bash
make ui
```

Wait for `Ready in ...`, then open **http://localhost:3000**.

The console reads its API address from `NEXT_PUBLIC_API`, and falls back to
`http://localhost:8000` when that is unset, so a fresh clone needs no extra configuration.


## Checking it actually works

### The service is alive

```bash
curl -s localhost:8000/api/state | python3 -m json.tool | head -20
```

You should see the policy packs, the ledger status and the model roster. If `second_key`
shows `"vendor": "deepseek"`, both vendors are wired correctly.

### The console is connected

Look at the top right of the header. A green dot and the word **live** means the
WebSocket is up. Red and **offline** means the API is not running or is on another port.

### Govern one action

In the browser, click **CLM-2046 · prompt injection** in the left rail. Within about five
seconds a row appears showing the agent wanted to approve EUR 2,900 and the lane reads
**BLOCK**.

Or from the terminal:

```bash
curl -s -X POST localhost:8000/api/run \
  -H "Content-Type: application/json" \
  -d '{"claim_id":"CLM-2046","use_case":"claims-settlement","jurisdiction":"EU"}' \
  | python3 -c "import sys,json; v=json.load(sys.stdin); \
print(v['claim_id'], v['intent']['action'], v['intent']['params'].get('amount'), '->', v['lane'], 'moved', v['money_moved'])"
```

Expected:

```
CLM-2046 approve_payout 2900.0 -> BLOCK moved 0.0
```

The agent fell for an instruction hidden in the claim text. Interlock refused it.

If you get that line, everything works.


## Every command

| Command | What it does | Takes |
| --- | --- | --- |
| `make install` | Python and Node dependencies | ~2 min |
| `make seed` | Build the simulated insurer | instant |
| `make api` | Start the verification service on 8000 | runs until stopped |
| `make ui` | Start the console on 3000 | runs until stopped |
| `make test` | Eight tests on the logic that must never fail | <1 s |
| `make eval` | Score all 22 claims against ground truth | ~4 min |
| `make recalibrate` | Recompute the threshold from labelled verdicts | instant |
| `make reset` | Reseed the insurer, clear the ledger | instant |
| `make deliverables` | Rebuild both PDFs and the deck | ~30 s |

`make eval` is the slow one because it runs every claim through the full mesh against a
rate-limited free tier. Run it once and the Trust Report screen has figures. The
repository already ships a completed `data/eval_report.json`, so you can look at the
Trust Report before ever running it yourself.


## When something breaks

### `uv: command not found`

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Then open a new terminal so your `PATH` picks it up.

### The console says `offline`

The API is not running, or it is on a different port. Check terminal 1, then:

```bash
curl -s localhost:8000/api/state
```

If that fails, restart `make api`.

### `Address already in use`

Something is already on 8000 or 3000.

```bash
lsof -ti:8000 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```

### Actions are slow, or a batch appears to stall

Expected on the free tier. Eight thousand tokens per minute per key is the ceiling. The
key pool throttles rather than failing, so throughput is bounded, not broken. Make sure
both Groq keys are set. For a demonstration, run `make eval` beforehand and present the
figures instead of a live surge.

### A check reports `check unavailable`

A model was unreachable. That check returns a fail-safe risk score rather than a pass, so
the action escalates instead of slipping through. Check your keys in `.env`.

### `Recalibration refuses to run`

It needs at least five labelled verdicts. Run `make eval`, or clear a few items from the
review queue.

### The ledger reports a breach

Either you clicked the tamper button on the Trust Report, which is the intended
demonstration, or a stored entry was edited. Rebuild with `make reset`.

### `make deliverables` fails

You need `tectonic` for the PDFs:

```bash
brew install tectonic
```

The first run downloads LaTeX packages and takes a minute.


## Running without any keys

You can still see a good deal of the system with no credentials at all:

```bash
make install && make seed && make test    # all offline
make api && make ui                       # console loads, Trust Report renders
```

The Trust Report reads the committed `data/eval_report.json`, so the measured figures are
visible. The ledger, the policy packs and all four screens work. What you cannot do is
govern a new action, because that needs a live model.


## Next

- [SUMMARY.md](SUMMARY.md) for what the project is and where the code lives
- [USER_FLOW.md](USER_FLOW.md) for how the screens are meant to be used
- [EXAMPLES.md](EXAMPLES.md) for two worked examples with real output
- [../USAGE.md](../USAGE.md) for a screen-by-screen walkthrough
