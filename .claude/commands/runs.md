---
description: Plan the runs: which truck and driver does which job, with the licence, registration and EPA permission gates checked every time.
---

1. Run `node scripts/waste.mjs runs --json` (add `--date=`), and `today --date=tomorrow --json` for the jobs.
2. Move a job: `node scripts/waste.mjs run assign JOB RUN --json`. Change a driver: `run driver RUN "NAME" --json`.
3. A refusal lists every reason at once (wrong truck for the bin, licence class, lapsed rego, no Waste Tracker record, no EPA permission). Read them out and fix the record, never work around it. There is no force flag.
4. At the end of a front lift day: `run done RUN` marks the lifts done, then `/tip` for each stream's docket.
