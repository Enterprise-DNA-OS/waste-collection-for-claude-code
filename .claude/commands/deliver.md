---
description: Mark a delivery, swap or collection done, with the bin that went out. The road permit and Waste Tracker gates are checked at this step.
---

1. Run `node scripts/waste.mjs done JOB [--bin=B-...] [--on=DATE] [--contamination="what the driver saw"] --json`.
2. A delivery picks the first bin of the right type in the yard unless the operator names one. A road delivery is refused until the permit covering the day is on record: `permit H-... --ref= --until=`.
3. A swap or collection needs its tip docket next: say so and go to `/tip`.
4. A driver's note about contamination goes on with `--contamination`; price it with `charge JOB --amount=` before billing.
