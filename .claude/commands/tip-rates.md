---
description: The tip rates in force at every facility, what changed, and recording a new rate the day a facility announces it.
---

1. Run `node scripts/waste.mjs tip-rates --json`.
2. A facility notice: `tip-rate set FACILITY STREAM --rate=DOLLARS --from=DATE --source="the notice"`. It names every price the rise pushes under target.
3. Follow with `/price-check`.
