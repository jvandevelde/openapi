# One entry per change in requests and responses

| | |
|---|---|
| **Status** | Built (see the [decision record](../decision-records/2026-11-23T0348-merge-request-response-entries.md)) |
| **Summary** | Show a schema change judged for both requests and responses (`…-in-request` and `…-in-response`) once, in the `review` report and the `explore` page, with each direction's severity and finding ID. |
| **Value / effort** | high / low |
| **Plan entry** | [PLAN.md section 8, *Large specs and noise*](../PLAN.md#large-specs-and-noise) |

## What it does

A change to a schema used both in requests and in responses produces two findings, one per direction, because the direction decides the severity: a shorter `maxLength` is `max-length-decreased-in-request` (`error`, clients sending longer values are rejected) and `max-length-decreased-in-response` (`info`). Both have the same subject, message and place. Reports listed them as two rows, so a reviewer read every schema change twice. In a generated 80-operation PR, 12 of the 27 API-change rows were the second half of such a pair.

This proposal shows each such pair as **one entry**:

- **`review` (text and HTML):** the change once, with its worst severity and the rule ID without the direction, and a second line with each direction's severity and finding ID:

  ```
  ERROR  #/components/schemas/NewPet  affects 3 operations: GET /pets, GET /pets/{petId}, POST /pets
         -  maxLength decreased (100 → 50) at /properties/name/maxLength  openapi.yaml:94 · max-length-decreased
                request ERROR · id 8b48ac001f7e   response INFO · id c6a8e0868a08
  ```

- **`explore`:** one row, badged with the worst severity and labelled `request error · response info`. Opened, it shows the shared rule and kind, then a section per direction (rule, severity source, finding ID, affected operations, acknowledgement), then the source side by side once. A row stays visible while any of its findings matches the filters, and its badge shows the worst severity among those that match. The count reads `61 of 61 changes (73 of 73 findings)`.

The `history` timeline (text and HTML) does the same since [a later decision](../decision-records/2026-11-23T0410-timeline-per-step-findings-and-directions.md).

Only the display is merged. The JSON result, finding IDs, acknowledgements, overrides and the exit code stay per finding, so existing `api-diff.ack.yaml` files keep working and each direction can still be accepted on its own.

## Options considered

- **Merge in the reports only** (chosen): no change to the result or IDs.
- **Merge in the engine**: one finding with a severity per direction. It would fix every report and the JSON at once, but changes finding IDs (every existing acknowledgement would go stale), the result schema, overrides and the severity-source model. Not chosen.
- **The `ci` report**: left as is. It lists only findings at the gate threshold (`warn` and above by default), so the `info` half of a pair is rarely shown, and one line per finding is easier to grep.

Related ideas raised at the same time, not part of this proposal:

- **Group `explore` rows under their schema or operation**, and **fold docs-only changes in `explore`** into one group per rule: built next, see [Explore page: sections, grouping and folded documentation changes](explore-sections-and-grouping.md).
- **Collapse the same edit made in several schemas** ("in 7 schemas"): still an idea.

## Open questions

- Should collapsing the same edit across schemas become a proposal of its own?
