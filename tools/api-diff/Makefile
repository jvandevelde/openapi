# Standard tool targets: install, test, run (see the repo root README).
.PHONY: install test run typecheck bench bundle

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

install: node_modules

typecheck: node_modules
	npx tsc --noEmit -p .

test: node_modules typecheck
	npm test

bench: node_modules
	node test/bench/bench.ts

# Paths in ARGS are resolved relative to this directory.
run: node_modules
	@node bin/api-diff.ts $(ARGS)

# The release file: dist/api-diff.mjs and dist/api-diff.mjs.sha256.
bundle: node_modules
	node scripts/bundle.ts
