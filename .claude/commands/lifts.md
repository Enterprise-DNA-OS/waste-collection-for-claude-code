---
description: The scheduled front lift services: what is due, what was missed, and rebooking a missed lift.
---

1. Services: `node scripts/waste.mjs services --json`. Missed lifts are on `attention`.
2. A driver could not lift: `miss L-... --why="gate locked"`. Rebook it: `rebook L-... --on=DATE`. The original stops showing once rebooked.
3. The end of the round: `run done R-...` marks the run's lifts done, then one `/tip` per stream.
4. A site that keeps getting missed for the same reason (a locked gate) is a call to the customer: log it with `/log`.
