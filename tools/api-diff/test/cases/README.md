# Test cases

Each folder is one rule or scenario. The runner (`test/cases.test.ts`) compares the two documents and checks that the findings match `expected.yaml` exactly (same rules, severities and subjects; order doesn't matter).

```
<name>/
  base.yaml | base.json | base/openapi.yaml           the base document (a folder for multi-file specs)
  revision.yaml | revision/openapi.yaml               the revision
  expected.yaml
```

```yaml
description: Why this case exists, and what the expected result means.
milestone: M3            # cases for later milestones run as "todo" until then
options:
  profile: sdk           # optional
  check-versions: true   # optional: run version-unchanged and version-bump-too-small (off otherwise)
  as-of: 2026-11-21      # optional reference date for deprecation and sunsets (this is the default for cases)
  policy:                # optional, from M6: a policy file's contents
    rules:
      documents-unrelated: off
findings:
  - rule: query-parameter-removed   # most specific rule ID
    severity: warn
    subject: GET /pets
```

- `findings: []` means no changes are expected (e.g. cosmetic differences).
- Every implemented rule must appear in at least one case, or the test suite fails.
- `UPDATE_CASES=1 npm test` rewrites `findings` from the actual results. Only use it after a deliberate change, and review the diff: the expected results are the definition of what each rule should do.
