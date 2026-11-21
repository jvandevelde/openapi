# A rule's policy severity doesn't replace its conditional severity

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-21 19:19 UTC |
| **Summary** | For rules whose default depends on the change (`response-header-removed`, `property-removed`, `format-changed`), a policy `severity` applies only to the other findings; the dependent case is set by its own option, and `off` turns off every finding. |
| **Milestone** | M6 |

## Background

Three rules pick their default from the change itself: `response-header-removed` is `error` when the header was required, `property-removed-in-request` is `error` when the object is closed (`additionalProperties: false`), and `format-changed-in-request` is `info` when the new format widens the old one (`int32` → `int64`). The first two also have a policy option for that case (`required-severity`, `closed-object-severity`). Building policy `rules` (M6) needed an answer to what `response-header-removed: info` means for a required header.

## Alternatives considered

- **✅ Chosen: `severity` sets the plain case, the option sets the dependent case, `off` turns off both.** Lowering a rule doesn't quietly lower its most serious case, and each case has exactly one setting.
- **Rejected: `severity` replaces everything, including the dependent case.** Simple, but `response-header-removed: info` (meant for optional headers) would also hide removed required headers, which break clients; the options would only matter when `severity` is unset.
- **Rejected: the stricter of `severity` and the dependent default.** Safe, but it makes `severity: error` on `format-changed` turn widening changes into errors, and it is harder to explain.

## Decision

In classify, after `off`: if the rule's conditional applies, its option (most specific rule ID first) sets the severity, else the built-in conditional default; otherwise the policy `severity`, then the profile, then the default. `format-changed` has no option, so widening formats stay `info`. `severitySource` names the option when it is used, e.g. `policy api-diff.yaml: rules.property-removed.closed-object-severity`.

## Impacts

- `RuleMeta.conditionalOption` links a conditional rule to its option.
- POLICY.md section 4 explains the split.
- A team that wants removed required headers lowered sets `required-severity`, not `severity`.

## References

- POLICY.md sections 3, 4 and 12; `src/classify/classify.ts`
- [Severity precedence and configurable rules](2026-11-21T0237-severity-precedence.md)
