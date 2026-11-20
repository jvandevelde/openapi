# Language-neutral entry point for every tool in tools/.
#
# Each tool directory has its own Makefile with the targets `install`, `test`
# and `run`. This file just loops over them, so it works whatever language a
# tool is written in. Directories starting with "_" are ignored.
#
#   make list                      list tools
#   make install                   install every tool's dependencies
#   make test                      run every tool's tests
#   make test TOOL=operation-ids   run one tool's tests
#   make run TOOL=operation-ids ARGS="spec.yaml --dry-run"

TOOLS_ALL := $(sort $(patsubst tools/%/Makefile,%,$(wildcard tools/[!_]*/Makefile)))
TOOLS := $(if $(TOOL),$(TOOL),$(TOOLS_ALL))

.PHONY: list install test run

list:
	@printf '%s\n' $(TOOLS_ALL)

install test:
	@set -e; for t in $(TOOLS); do \
		echo "==> $$t: $@"; \
		$(MAKE) --no-print-directory -C tools/$$t $@; \
	done

run:
	@test -n "$(TOOL)" || { echo 'usage: make run TOOL=<name> ARGS="..."'; exit 2; }
	@$(MAKE) --no-print-directory -C tools/$(TOOL) run ARGS='$(ARGS)'
