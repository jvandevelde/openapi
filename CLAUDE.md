# Working in this repository

## Asking the user questions

When a reply needs the user's input on one or more decisions (accepting a proposed decision record, picking between options, whether to continue), ask them with the AskUserQuestion tool (the pop-up with options), not as questions in the prose of the reply.

- One question per decision, each with 2–4 concrete answers and a short description of what each answer means. Put the recommended answer first and mark it "(Recommended)".
- Each question must stand on its own: name the thing being decided (e.g. the decision record's title), since the user may not see the summary text while the pop-up is open.
- Still give the summary in the reply first; ask the questions after it, all in one AskUserQuestion call (up to 4 questions; split into several calls only if there are more).
- Don't end a reply with open questions in the text that the pop-up didn't ask.

## Feature proposals and designs

A new feature proposal or design for a tool (a brainstorm write-up, a backlog idea worked out in detail) goes in its own file, `tools/<tool>/feature-backlog/<slug>.md`, not in the tool's PLAN.md.

- Give the file a header table (**Status**, **Summary**, **Value / effort**, **Plan entry**) and list it in `tools/<tool>/feature-backlog/README.md`. Create both if the tool has no `feature-backlog/` yet.
- Add a short entry to the tool's PLAN.md backlog (in api-diff: section 8, in the table for its area): what it does, why it's worth having, value/effort and a link to the file. Keep the details out of PLAN.md.
- A proposal isn't a decision. When work on it starts, ask about its choices again and record them as decision records; then link them from the proposal.
- See `tools/api-diff/decision-records/2026-11-23T0157-feature-proposals-in-feature-backlog.md`.
