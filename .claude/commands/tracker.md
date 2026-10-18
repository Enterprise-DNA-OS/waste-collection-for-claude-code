---
description: Record the EPA Waste Tracker record for a reportable priority waste hire (asbestos, contaminated soil). Nothing moves without it.
---

1. The producer (the customer, or an accredited consigner) creates the Waste Tracker record with EPA Victoria and gives you its number. Never invent one.
2. Run `node scripts/waste.mjs tracker H-... --ref=RECORD_NO --json`. Any job waiting on it goes onto its run, if the truck holds a current EPA permission.
3. Report what moved. If a job is still refused, read the reason: usually a truck without a permission.
