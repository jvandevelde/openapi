# Working in this repository

## Asking the user questions

When a reply needs the user's input on one or more decisions (accepting a proposed decision record, picking between options, whether to continue), ask them with the AskUserQuestion tool (the pop-up with options), not as questions in the prose of the reply.

- One question per decision, each with 2–4 concrete answers and a short description of what each answer means. Put the recommended answer first and mark it "(Recommended)".
- Each question must stand on its own: name the thing being decided (e.g. the decision record's title), since the user may not see the summary text while the pop-up is open.
- Still give the summary in the reply first; ask the questions after it, all in one AskUserQuestion call (up to 4 questions; split into several calls only if there are more).
- Don't end a reply with open questions in the text that the pop-up didn't ask.
