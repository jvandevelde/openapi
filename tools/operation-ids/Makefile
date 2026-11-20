# Standard tool targets: install, test, run (see the repo root README).
.PHONY: install test run

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

install: node_modules

test: node_modules
	npm test

# Paths in ARGS are resolved relative to this directory.
run: node_modules
	@node bin/cli.js $(ARGS)
