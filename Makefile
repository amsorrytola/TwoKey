.PHONY: install seed api ui demo eval reset test deliverables

install:
	uv venv .venv && uv pip install -e ".[dev,docs]"
	cd ui && npm install
	@echo ""
	@echo "Installed. Next: cp .env.example .env, add your keys, then 'make seed'."

seed:
	.venv/bin/python -m interlock.sim.world

api:
	.venv/bin/uvicorn interlock.api:app --host 127.0.0.1 --port 8000 --reload

ui:
	cd ui && npm run dev

demo:
	@echo "Run 'make api' and 'make ui' in two terminals, then open http://localhost:3000"

eval:
	.venv/bin/python -m interlock.eval.harness

recalibrate:
	.venv/bin/python -c "from interlock.learning.recalibrate import recalibrate; import json; print(json.dumps(recalibrate(), indent=2))"

reset:
	.venv/bin/python -c "from interlock.sim.world import seed; from interlock.ledger import chain; seed(); chain.reset(); print('reset')"

test:
	.venv/bin/pytest -q

deliverables:
	cd deliverables && tectonic -X compile README.tex --outdir .
	cd deliverables && tectonic -X compile Business_Proposal.tex --outdir .
	cd deliverables && mv -f README.pdf Interlock_README.pdf
	cd deliverables && mv -f Business_Proposal.pdf Interlock_Business_Proposal.pdf
	cd deliverables && ../.venv/bin/python build_deck.py
	@ls -lh deliverables/*.pdf deliverables/*.pptx
