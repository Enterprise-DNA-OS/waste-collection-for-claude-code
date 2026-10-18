---
description: Book a collection for a bin that is out. Warns when the council permit ends before the day you picked.
---

1. Run `node scripts/waste.mjs collect H-... --on=DATE --json`.
2. Report the job, the day and the run. Read the warning if the permit ends first and offer an earlier day.
3. When the driver is back: `/deliver` to mark it done, then `/tip` with the docket.
