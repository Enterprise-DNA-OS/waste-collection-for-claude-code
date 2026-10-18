---
description: Check the records against the rules a waste operator lives under (docs/compliance.md) and report every breach with its source.
---

1. Run `node scripts/waste.mjs compliance --json` (or one rule: `compliance road-permit`).
2. Report as a table: rule, PASS or BREACH, each breach (record, who, detail), the source. Breaches first.
3. For each breach, the fix the operator can approve: the record to complete, the collection to book, the notice to draft (to `drafts/`, never sent).
4. If a rule in `docs/compliance.md` is out of date for the operator's state or council, say so and stop. Do not guess at law. The operator confirms, then you update the doc and the check together.

Nothing here is legal advice.
