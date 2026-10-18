---
description: The run sheets for a day: each truck, its driver, every job in order with the site notes, and the paper each job needs (Waste Tracker, road permit).
---

1. Run `node scripts/waste.mjs today --json` (or `--date=tomorrow` when the operator is planning).
2. One block per run with jobs: the truck, the driver and whether their licence covers it, then the jobs as a short table: job, kind, customer, site, bin, stream.
3. Say every check out loud: NO TRACKER means do not lift it; NO PERMIT means it cannot go on the road; a road skip shows its permit end. Jobs on no run are the first thing to fix: `run assign JOB RUN`.
4. To print them for the drivers: `npm run docs -- run-sheet`.
